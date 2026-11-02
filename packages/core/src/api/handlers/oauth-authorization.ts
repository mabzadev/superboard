import { clampScopes, computeS256Challenge, secureCompare } from "@emdash-cms/auth";
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
import { validateRedirectUri } from "../oauth/redirect-uri.js";
import type { ApiResult } from "../types.js";
import { lookupOAuthClient, validateClientRedirectUri } from "./oauth-clients.js";
import { lookupUserRoleAndStatus } from "./oauth-user-lookup.js";

const AUTH_CODE_TTL_SECONDS = 10 * 60;

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

const REFRESH_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface AuthorizationParams {
	response_type: string;
	client_id: string;
	redirect_uri: string;
	scope?: string;
	state?: string;
	code_challenge: string;
	code_challenge_method: string;
	resource?: string;
}

export interface TokenExchangeParams {
	grant_type: string;
	code: string;
	redirect_uri: string;
	client_id: string;
	code_verifier: string;
	resource?: string;
}

export interface TokenResponse {
	access_token: string;
	refresh_token: string;
	token_type: "Bearer";
	expires_in: number;
	scope: string;
}

function expiresAt(seconds: number): string {
	return new Date(Date.now() + seconds * 1000).toISOString();
}

export { validateRedirectUri };

function normalizeScopes(requested?: string): string[] {
	if (!requested) return [];

	const scopes = requested.split(" ").filter(Boolean).filter(isValidScope);

	return scopes;
}

export async function handleAuthorizationApproval(
	db: Kysely<Database>,
	userId: string,
	userRole: RoleLevel,
	params: AuthorizationParams,
): Promise<ApiResult<{ redirect_url: string }>> {
	try {
		if (params.response_type !== "code") {
			return {
				success: false,
				error: {
					code: "UNSUPPORTED_RESPONSE_TYPE",
					message: "Only response_type=code is supported",
				},
			};
		}

		const uriError = validateRedirectUri(params.redirect_uri);
		if (uriError) {
			return {
				success: false,
				error: { code: "INVALID_REDIRECT_URI", message: uriError },
			};
		}

		const client = await lookupOAuthClient(db, params.client_id);
		if (!client) {
			return {
				success: false,
				error: {
					code: "INVALID_CLIENT",
					message: "Unknown client_id",
				},
			};
		}

		const clientUriError = validateClientRedirectUri(params.redirect_uri, client.redirectUris);
		if (clientUriError) {
			return {
				success: false,
				error: { code: "INVALID_REDIRECT_URI", message: clientUriError },
			};
		}

		if (params.code_challenge_method !== "S256") {
			return {
				success: false,
				error: {
					code: "INVALID_REQUEST",
					message: "Only S256 code_challenge_method is supported",
				},
			};
		}

		if (!params.code_challenge) {
			return {
				success: false,
				error: { code: "INVALID_REQUEST", message: "code_challenge is required" },
			};
		}

		const userScopes = clampScopes(normalizeScopes(params.scope), userRole);

		const clientScopes = client.scopes;
		const scopes = clientScopes?.length
			? userScopes.filter((s: string) => clientScopes.includes(s))
			: userScopes;

		if (scopes.length === 0) {
			return {
				success: false,
				error: { code: "INVALID_SCOPE", message: "No valid scopes requested" },
			};
		}

		const code = generateCodeVerifier();
		const codeHash = hashApiToken(code);

		await db
			.insertInto("_emdash_authorization_codes")
			.values({
				code_hash: codeHash,
				client_id: params.client_id,
				redirect_uri: params.redirect_uri,
				user_id: userId,
				scopes: JSON.stringify(scopes),
				code_challenge: params.code_challenge,
				code_challenge_method: params.code_challenge_method,
				resource: params.resource ?? null,
				expires_at: expiresAt(AUTH_CODE_TTL_SECONDS),
			})
			.execute();

		const redirectUrl = new URL(params.redirect_uri);
		redirectUrl.searchParams.set("code", code);
		if (params.state) {
			redirectUrl.searchParams.set("state", params.state);
		}

		return {
			success: true,
			data: { redirect_url: redirectUrl.toString() },
		};
	} catch (error) {
		console.error("Authorization error:", error);
		return {
			success: false,
			error: {
				code: "AUTHORIZATION_ERROR",
				message: "Failed to process authorization",
			},
		};
	}
}

export async function handleAuthorizationCodeExchange(
	db: Kysely<Database>,
	params: TokenExchangeParams,
): Promise<ApiResult<TokenResponse>> {
	try {
		if (params.grant_type !== "authorization_code") {
			return {
				success: false,
				error: { code: "unsupported_grant_type", message: "Invalid grant_type" },
			};
		}

		const codeHash = hashApiToken(params.code);

		const row = await db
			.deleteFrom("_emdash_authorization_codes")
			.where("code_hash", "=", codeHash)
			.returningAll()
			.executeTakeFirst();

		if (!row) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "Invalid authorization code" },
			};
		}

		if (new Date(row.expires_at) < new Date()) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "Authorization code expired" },
			};
		}

		if (row.redirect_uri !== params.redirect_uri) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "redirect_uri mismatch" },
			};
		}

		if (row.client_id !== params.client_id) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "client_id mismatch" },
			};
		}

		const derivedChallenge = computeS256Challenge(params.code_verifier);
		if (!secureCompare(derivedChallenge, row.code_challenge)) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "PKCE verification failed" },
			};
		}

		if (row.resource && params.resource && row.resource !== params.resource) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "resource mismatch" },
			};
		}

		const userInfo = await lookupUserRoleAndStatus(db, row.user_id);
		if (!userInfo) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "User not found" },
			};
		}

		if (userInfo.disabled) {
			return {
				success: false,
				error: { code: "invalid_grant", message: "User account is disabled" },
			};
		}

		const storedScopes = JSON.parse(row.scopes) as string[];
		let scopes = clampScopes(storedScopes, userInfo.role);

		const client = await lookupOAuthClient(db, row.client_id);
		if (client?.scopes?.length) {
			scopes = scopes.filter((s: string) => client.scopes!.includes(s));
		}

		if (scopes.length === 0) {
			return {
				success: false,
				error: {
					code: "invalid_grant",
					message: "User role no longer supports any of the requested scopes",
				},
			};
		}

		const accessToken = generatePrefixedToken(TOKEN_PREFIXES.OAUTH_ACCESS);
		const accessExpires = expiresAt(ACCESS_TOKEN_TTL_SECONDS);

		const refreshToken = generatePrefixedToken(TOKEN_PREFIXES.OAUTH_REFRESH);
		const refreshExpires = expiresAt(REFRESH_TOKEN_TTL_SECONDS);

		await withTransaction(db, async (trx) => {
			await trx
				.insertInto("_emdash_oauth_tokens")
				.values({
					token_hash: accessToken.hash,
					token_type: "access",
					user_id: row.user_id,
					scopes: JSON.stringify(scopes),
					client_type: "mcp",
					expires_at: accessExpires,
					refresh_token_hash: refreshToken.hash,
					client_id: row.client_id,
				})
				.execute();

			await trx
				.insertInto("_emdash_oauth_tokens")
				.values({
					token_hash: refreshToken.hash,
					token_type: "refresh",
					user_id: row.user_id,
					scopes: JSON.stringify(scopes),
					client_type: "mcp",
					expires_at: refreshExpires,
					refresh_token_hash: null,
					client_id: row.client_id,
				})
				.execute();
		});

		return {
			success: true,
			data: {
				access_token: accessToken.raw,
				refresh_token: refreshToken.raw,
				token_type: "Bearer",
				expires_in: ACCESS_TOKEN_TTL_SECONDS,
				scope: scopes.join(" "),
			},
		};
	} catch (error) {
		console.error("Token exchange error:", error);
		return {
			success: false,
			error: {
				code: "TOKEN_EXCHANGE_ERROR",
				message: "Failed to exchange authorization code",
			},
		};
	}
}

export function buildDeniedRedirect(redirectUri: string, state?: string): string {
	const url = new URL(redirectUri);
	url.searchParams.set("error", "access_denied");
	url.searchParams.set("error_description", "The user denied the authorization request");
	if (state) {
		url.searchParams.set("state", state);
	}
	return url.toString();
}

export async function cleanupExpiredAuthorizationCodes(db: Kysely<Database>): Promise<number> {
	const result = await db
		.deleteFrom("_emdash_authorization_codes")
		.where("expires_at", "<", new Date().toISOString())
		.executeTakeFirst();

	return Number(result.numDeletedRows);
}
