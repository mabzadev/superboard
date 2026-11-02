import { clampScopes } from "@emdash-cms/auth";
import type { RoleLevel } from "@emdash-cms/auth";
import { generateCodeVerifier } from "arctic";
import type { Kysely } from "kysely";

import {
	generatePrefixedToken,
	hashApiToken,
	isValidScope,
	TOKEN_PREFIXES,
} from "../../auth/api-tokens.js";
import { withTransaction } from "../../database/transaction.js";
import type { Database } from "../../database/types.js";
import type { ApiResult } from "../types.js";
import { lookupOAuthClient } from "./oauth-clients.js";
import { lookupUserRoleAndStatus } from "./oauth-user-lookup.js";

const DEVICE_CODE_TTL_SECONDS = 15 * 60;

const DEFAULT_INTERVAL = 5;

const SLOW_DOWN_INCREMENT = 5;

const MAX_SLOW_DOWN_INTERVAL = 60;

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

const DEFAULT_SCOPES = [
	"content:read",
	"content:write",
	"media:read",
	"media:write",
	"schema:read",
] as const;

const HYPHEN_PATTERN = /-/g;

const USER_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
}

export interface TokenResponse {
	access_token: string;
	refresh_token: string;
	token_type: "Bearer";
	expires_in: number;
	scope: string;
}

export type DeviceFlowError =
	| "authorization_pending"
	| "slow_down"
	| "expired_token"
	| "access_denied";

function generateUserCode(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	const chars = Array.from(bytes, (b) => USER_CODE_CHARS[b % USER_CODE_CHARS.length]).join("");
	return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

function expiresAt(seconds: number): string {
	return new Date(Date.now() + seconds * 1000).toISOString();
}

function normalizeScopes(requested?: string[]): string[] {
	if (!requested || requested.length === 0) {
		return [...DEFAULT_SCOPES];
	}
	return requested.filter(isValidScope);
}

export async function handleDeviceCodeRequest(
	db: Kysely<Database>,
	input: {
		client_id?: string;
		scope?: string;
	},
	verificationUri: string,
): Promise<ApiResult<DeviceCodeResponse>> {
	try {
		const requestedScopes = input.scope ? input.scope.split(" ").filter(Boolean) : [];
		const scopes = normalizeScopes(requestedScopes);

		if (scopes.length === 0) {
			return {
				success: false,
				error: { code: "INVALID_SCOPE", message: "No valid scopes requested" },
			};
		}

		const deviceCode = generateCodeVerifier();
		const userCode = generateUserCode();
		const expires = expiresAt(DEVICE_CODE_TTL_SECONDS);

		await db
			.insertInto("_emdash_device_codes")
			.values({
				device_code: deviceCode,
				user_code: userCode,
				scopes: JSON.stringify(scopes),
				status: "pending",
				expires_at: expires,
				interval: DEFAULT_INTERVAL,
			})
			.execute();

		return {
			success: true,
			data: {
				device_code: deviceCode,
				user_code: userCode,
				verification_uri: verificationUri,
				expires_in: DEVICE_CODE_TTL_SECONDS,
				interval: DEFAULT_INTERVAL,
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "DEVICE_CODE_ERROR",
				message: "Failed to create device code",
			},
		};
	}
}

export async function handleDeviceTokenExchange(
	db: Kysely<Database>,
	input: {
		device_code: string;
		grant_type: string;
	},
): Promise<
	ApiResult<TokenResponse> & { deviceFlowError?: DeviceFlowError; deviceFlowInterval?: number }
> {
	try {
		if (input.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") {
			return {
				success: false,
				error: { code: "UNSUPPORTED_GRANT_TYPE", message: "Invalid grant_type" },
			};
		}

		const row = await db
			.selectFrom("_emdash_device_codes")
			.selectAll()
			.where("device_code", "=", input.device_code)
			.executeTakeFirst();

		if (!row) {
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Invalid device code" },
			};
		}

		const now = new Date();

		if (new Date(row.expires_at) < now) {
			await db
				.deleteFrom("_emdash_device_codes")
				.where("device_code", "=", input.device_code)
				.execute();

			return {
				success: false,
				deviceFlowError: "expired_token",
				error: { code: "expired_token", message: "The device code has expired" },
			};
		}

		if (row.status === "denied") {
			await db
				.deleteFrom("_emdash_device_codes")
				.where("device_code", "=", input.device_code)
				.execute();

			return {
				success: false,
				deviceFlowError: "access_denied",
				error: { code: "access_denied", message: "The user denied the request" },
			};
		}

		if (row.status === "pending") {
			if (row.last_polled_at) {
				const lastPolled = new Date(row.last_polled_at);
				const elapsedSeconds = (now.getTime() - lastPolled.getTime()) / 1000;

				if (elapsedSeconds < row.interval) {
					const newInterval = Math.min(row.interval + SLOW_DOWN_INCREMENT, MAX_SLOW_DOWN_INTERVAL);
					await db
						.updateTable("_emdash_device_codes")
						.set({
							interval: newInterval,
							last_polled_at: now.toISOString(),
						})
						.where("device_code", "=", input.device_code)
						.execute();

					return {
						success: false,
						deviceFlowError: "slow_down",
						deviceFlowInterval: newInterval,
						error: { code: "slow_down", message: "Polling too fast" },
					};
				}
			}

			await db
				.updateTable("_emdash_device_codes")
				.set({ last_polled_at: now.toISOString() })
				.where("device_code", "=", input.device_code)
				.execute();

			return {
				success: false,
				deviceFlowError: "authorization_pending",
				error: { code: "authorization_pending", message: "Authorization pending" },
			};
		}

		if (row.status !== "authorized" || !row.user_id) {
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Invalid device code state" },
			};
		}

		const accessToken = generatePrefixedToken(TOKEN_PREFIXES.OAUTH_ACCESS);
		const accessExpires = expiresAt(ACCESS_TOKEN_TTL_SECONDS);
		const refreshToken = generatePrefixedToken(TOKEN_PREFIXES.OAUTH_REFRESH);
		const refreshExpires = expiresAt(REFRESH_TOKEN_TTL_SECONDS);

		const result = await withTransaction(db, async (trx) => {
			const consumed = await trx
				.deleteFrom("_emdash_device_codes")
				.where("device_code", "=", input.device_code)
				.where("status", "=", "authorized")
				.returningAll()
				.executeTakeFirst();

			if (!consumed) return null;

			if (!consumed.user_id) return null;

			const scopes = JSON.parse(consumed.scopes) as string[];

			await trx
				.insertInto("_emdash_oauth_tokens")
				.values({
					token_hash: accessToken.hash,
					token_type: "access",
					user_id: consumed.user_id,
					scopes: JSON.stringify(scopes),
					client_type: "cli",
					expires_at: accessExpires,
					refresh_token_hash: refreshToken.hash,
				})
				.execute();

			await trx
				.insertInto("_emdash_oauth_tokens")
				.values({
					token_hash: refreshToken.hash,
					token_type: "refresh",
					user_id: consumed.user_id,
					scopes: JSON.stringify(scopes),
					client_type: "cli",
					expires_at: refreshExpires,
					refresh_token_hash: null,
				})
				.execute();

			return { scopes };
		});

		if (!result) {
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Device code already consumed" },
			};
		}

		return {
			success: true,
			data: {
				access_token: accessToken.raw,
				refresh_token: refreshToken.raw,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_TTL_SECONDS,
				scope: result.scopes.join(" "),
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "TOKEN_EXCHANGE_ERROR",
				message: "Failed to exchange device code",
			},
		};
	}
}

export async function handleDeviceAuthorize(
	db: Kysely<Database>,
	userId: string,
	userRole: RoleLevel,
	input: {
		user_code: string;
		action?: "approve" | "deny";
	},
): Promise<ApiResult<{ authorized: boolean }>> {
	try {
		const normalizedCode = input.user_code.replace(HYPHEN_PATTERN, "").toUpperCase();

		const row = await db
			.selectFrom("_emdash_device_codes")
			.selectAll()
			.where("status", "=", "pending")
			.execute();

		const match = row.find(
			(r) => r.user_code.replace(HYPHEN_PATTERN, "").toUpperCase() === normalizedCode,
		);

		if (!match) {
			return {
				success: false,
				error: { code: "INVALID_CODE", message: "Invalid or expired code" },
			};
		}

		if (new Date(match.expires_at) < new Date()) {
			await db
				.deleteFrom("_emdash_device_codes")
				.where("device_code", "=", match.device_code)
				.execute();

			return {
				success: false,
				error: { code: "EXPIRED_CODE", message: "This code has expired" },
			};
		}

		const action = input.action ?? "approve";

		if (action === "deny") {
			await db
				.updateTable("_emdash_device_codes")
				.set({ status: "denied" })
				.where("device_code", "=", match.device_code)
				.execute();

			return { success: true, data: { authorized: false } };
		}

		const requestedScopes = JSON.parse(match.scopes) as string[];
		const effectiveScopes = clampScopes(requestedScopes, userRole);

		if (effectiveScopes.length === 0) {
			return {
				success: false,
				error: {
					code: "INSUFFICIENT_ROLE",
					message: "Your role does not permit any of the requested scopes",
				},
			};
		}

		await db
			.updateTable("_emdash_device_codes")
			.set({
				status: "authorized",
				user_id: userId,
				scopes: JSON.stringify(effectiveScopes),
			})
			.where("device_code", "=", match.device_code)
			.execute();

		return { success: true, data: { authorized: true } };
	} catch {
		return {
			success: false,
			error: {
				code: "AUTHORIZE_ERROR",
				message: "Failed to authorize device",
			},
		};
	}
}

export async function handleTokenRefresh(
	db: Kysely<Database>,
	input: {
		refresh_token: string;
		grant_type: string;
	},
): Promise<ApiResult<TokenResponse>> {
	try {
		if (input.grant_type !== "refresh_token") {
			return {
				success: false,
				error: { code: "UNSUPPORTED_GRANT_TYPE", message: "Invalid grant_type" },
			};
		}

		if (!input.refresh_token.startsWith(TOKEN_PREFIXES.OAUTH_REFRESH)) {
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Invalid refresh token format" },
			};
		}

		const refreshHash = hashApiToken(input.refresh_token);

		const row = await db
			.selectFrom("_emdash_oauth_tokens")
			.selectAll()
			.where("token_hash", "=", refreshHash)
			.where("token_type", "=", "refresh")
			.executeTakeFirst();

		if (!row) {
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Invalid refresh token" },
			};
		}

		if (new Date(row.expires_at) < new Date()) {
			await db.deleteFrom("_emdash_oauth_tokens").where("token_hash", "=", refreshHash).execute();
			await db
				.deleteFrom("_emdash_oauth_tokens")
				.where("refresh_token_hash", "=", refreshHash)
				.execute();

			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "Refresh token expired" },
			};
		}

		const userInfo = await lookupUserRoleAndStatus(db, row.user_id);
		if (!userInfo) {
			await db.deleteFrom("_emdash_oauth_tokens").where("user_id", "=", row.user_id).execute();
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "User not found" },
			};
		}

		if (userInfo.disabled) {
			await db.deleteFrom("_emdash_oauth_tokens").where("user_id", "=", row.user_id).execute();
			return {
				success: false,
				error: { code: "INVALID_GRANT", message: "User account is disabled" },
			};
		}

		const storedScopes = JSON.parse(row.scopes) as string[];
		let scopes = clampScopes(storedScopes, userInfo.role);

		if (row.client_id) {
			const client = await lookupOAuthClient(db, row.client_id);
			if (client?.scopes?.length) {
				scopes = scopes.filter((s: string) => client.scopes!.includes(s));
			}
		}

		if (scopes.length === 0) {
			await db.deleteFrom("_emdash_oauth_tokens").where("token_hash", "=", refreshHash).execute();
			await db
				.deleteFrom("_emdash_oauth_tokens")
				.where("refresh_token_hash", "=", refreshHash)
				.execute();
			return {
				success: false,
				error: {
					code: "INVALID_GRANT",
					message: "User role no longer supports any of the token's scopes",
				},
			};
		}

		await db
			.deleteFrom("_emdash_oauth_tokens")
			.where("refresh_token_hash", "=", refreshHash)
			.where("token_type", "=", "access")
			.execute();

		const accessToken = generatePrefixedToken(TOKEN_PREFIXES.OAUTH_ACCESS);
		const accessExpires = expiresAt(ACCESS_TOKEN_TTL_SECONDS);

		await db
			.insertInto("_emdash_oauth_tokens")
			.values({
				token_hash: accessToken.hash,
				token_type: "access",
				user_id: row.user_id,
				scopes: JSON.stringify(scopes),
				client_type: row.client_type,
				expires_at: accessExpires,
				refresh_token_hash: refreshHash,
			})
			.execute();

		return {
			success: true,
			data: {
				access_token: accessToken.raw,
				refresh_token: input.refresh_token,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_TTL_SECONDS,
				scope: scopes.join(" "),
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "TOKEN_REFRESH_ERROR",
				message: "Failed to refresh token",
			},
		};
	}
}

export async function handleTokenRevoke(
	db: Kysely<Database>,
	input: {
		token: string;
	},
): Promise<ApiResult<{ revoked: boolean }>> {
	try {
		const hash = hashApiToken(input.token);

		const row = await db
			.selectFrom("_emdash_oauth_tokens")
			.select(["token_hash", "token_type", "refresh_token_hash"])
			.where("token_hash", "=", hash)
			.executeTakeFirst();

		if (!row) {
			return { success: true, data: { revoked: true } };
		}

		if (row.token_type === "refresh") {
			await db.deleteFrom("_emdash_oauth_tokens").where("refresh_token_hash", "=", hash).execute();
			await db.deleteFrom("_emdash_oauth_tokens").where("token_hash", "=", hash).execute();
		} else {
			await db.deleteFrom("_emdash_oauth_tokens").where("token_hash", "=", hash).execute();
		}

		return { success: true, data: { revoked: true } };
	} catch {
		return {
			success: false,
			error: {
				code: "TOKEN_REVOKE_ERROR",
				message: "Failed to revoke token",
			},
		};
	}
}
