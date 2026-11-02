import type { Kysely } from "kysely";

import type { Database } from "../../database/types.js";
import { validateRedirectUri } from "../oauth/redirect-uri.js";
import type { ApiResult } from "../types.js";

function parseJsonColumn<T>(value: string): T {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- JSON.parse returns unknown, callers provide the expected shape
	return JSON.parse(value) as T;
}

function validateRegisteredRedirectUris(redirectUris: string[]): string | null {
	for (const redirectUri of redirectUris) {
		const error = validateRedirectUri(redirectUri);
		if (error) {
			return `Invalid redirect URI: ${error}`;
		}
	}
	return null;
}

export interface OAuthClientInfo {
	id: string;
	name: string;
	redirectUris: string[];
	scopes: string[] | null;
	createdAt: string;
	updatedAt: string;
}

export async function handleOAuthClientCreate(
	db: Kysely<Database>,
	input: {
		id: string;
		name: string;
		redirectUris: string[];
		scopes?: string[] | null;
	},
): Promise<ApiResult<OAuthClientInfo>> {
	try {
		if (input.redirectUris.length === 0) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "At least one redirect URI is required",
				},
			};
		}

		const redirectUriError = validateRegisteredRedirectUris(input.redirectUris);
		if (redirectUriError) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: redirectUriError,
				},
			};
		}

		const existing = await db
			.selectFrom("_emdash_oauth_clients")
			.select("id")
			.where("id", "=", input.id)
			.executeTakeFirst();

		if (existing) {
			return {
				success: false,
				error: { code: "CONFLICT", message: "OAuth client with this ID already exists" },
			};
		}

		const now = new Date().toISOString();

		await db
			.insertInto("_emdash_oauth_clients")
			.values({
				id: input.id,
				name: input.name,
				redirect_uris: JSON.stringify(input.redirectUris),
				scopes: input.scopes && input.scopes.length > 0 ? JSON.stringify(input.scopes) : null,
			})
			.execute();

		return {
			success: true,
			data: {
				id: input.id,
				name: input.name,
				redirectUris: input.redirectUris,
				scopes: input.scopes && input.scopes.length > 0 ? input.scopes : null,
				createdAt: now,
				updatedAt: now,
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "CLIENT_CREATE_ERROR",
				message: "Failed to create OAuth client",
			},
		};
	}
}

export async function handleOAuthClientList(
	db: Kysely<Database>,
): Promise<ApiResult<{ items: OAuthClientInfo[] }>> {
	try {
		const rows = await db
			.selectFrom("_emdash_oauth_clients")
			.selectAll()
			.orderBy("created_at", "desc")
			.execute();

		const items: OAuthClientInfo[] = rows.map((row) => ({
			id: row.id,
			name: row.name,
			redirectUris: parseJsonColumn<string[]>(row.redirect_uris),
			scopes: row.scopes ? parseJsonColumn<string[]>(row.scopes) : null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		return { success: true, data: { items } };
	} catch {
		return {
			success: false,
			error: {
				code: "CLIENT_LIST_ERROR",
				message: "Failed to list OAuth clients",
			},
		};
	}
}

export async function handleOAuthClientGet(
	db: Kysely<Database>,
	clientId: string,
): Promise<ApiResult<OAuthClientInfo>> {
	try {
		const row = await db
			.selectFrom("_emdash_oauth_clients")
			.selectAll()
			.where("id", "=", clientId)
			.executeTakeFirst();

		if (!row) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "OAuth client not found" },
			};
		}

		return {
			success: true,
			data: {
				id: row.id,
				name: row.name,
				redirectUris: parseJsonColumn<string[]>(row.redirect_uris),
				scopes: row.scopes ? parseJsonColumn<string[]>(row.scopes) : null,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "CLIENT_GET_ERROR",
				message: "Failed to get OAuth client",
			},
		};
	}
}

export async function handleOAuthClientUpdate(
	db: Kysely<Database>,
	clientId: string,
	input: {
		name?: string;
		redirectUris?: string[];
		scopes?: string[] | null;
	},
): Promise<ApiResult<OAuthClientInfo>> {
	try {
		const existing = await db
			.selectFrom("_emdash_oauth_clients")
			.selectAll()
			.where("id", "=", clientId)
			.executeTakeFirst();

		if (!existing) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "OAuth client not found" },
			};
		}

		if (input.redirectUris !== undefined && input.redirectUris.length === 0) {
			return {
				success: false,
				error: {
					code: "VALIDATION_ERROR",
					message: "At least one redirect URI is required",
				},
			};
		}

		if (input.redirectUris !== undefined) {
			const redirectUriError = validateRegisteredRedirectUris(input.redirectUris);
			if (redirectUriError) {
				return {
					success: false,
					error: {
						code: "VALIDATION_ERROR",
						message: redirectUriError,
					},
				};
			}
		}

		const updates: Record<string, string | null> = {
			updated_at: new Date().toISOString(),
		};

		if (input.name !== undefined) {
			updates.name = input.name;
		}
		if (input.redirectUris !== undefined) {
			updates.redirect_uris = JSON.stringify(input.redirectUris);
		}
		if (input.scopes !== undefined) {
			updates.scopes =
				input.scopes && input.scopes.length > 0 ? JSON.stringify(input.scopes) : null;
		}

		await db.updateTable("_emdash_oauth_clients").set(updates).where("id", "=", clientId).execute();

		const updated = await db
			.selectFrom("_emdash_oauth_clients")
			.selectAll()
			.where("id", "=", clientId)
			.executeTakeFirst();

		if (!updated) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "OAuth client not found after update" },
			};
		}

		return {
			success: true,
			data: {
				id: updated.id,
				name: updated.name,
				redirectUris: parseJsonColumn<string[]>(updated.redirect_uris),
				scopes: updated.scopes ? parseJsonColumn<string[]>(updated.scopes) : null,
				createdAt: updated.created_at,
				updatedAt: updated.updated_at,
			},
		};
	} catch {
		return {
			success: false,
			error: {
				code: "CLIENT_UPDATE_ERROR",
				message: "Failed to update OAuth client",
			},
		};
	}
}

export async function handleOAuthClientDelete(
	db: Kysely<Database>,
	clientId: string,
): Promise<ApiResult<{ deleted: true }>> {
	try {
		const result = await db
			.deleteFrom("_emdash_oauth_clients")
			.where("id", "=", clientId)
			.executeTakeFirst();

		if (result.numDeletedRows === 0n) {
			return {
				success: false,
				error: { code: "NOT_FOUND", message: "OAuth client not found" },
			};
		}

		return { success: true, data: { deleted: true } };
	} catch {
		return {
			success: false,
			error: {
				code: "CLIENT_DELETE_ERROR",
				message: "Failed to delete OAuth client",
			},
		};
	}
}

export async function lookupOAuthClient(
	db: Kysely<Database>,
	clientId: string,
): Promise<{ redirectUris: string[]; scopes: string[] | null } | null> {
	const row = await db
		.selectFrom("_emdash_oauth_clients")
		.select(["redirect_uris", "scopes"])
		.where("id", "=", clientId)
		.executeTakeFirst();

	if (!row) return null;

	return {
		redirectUris: parseJsonColumn<string[]>(row.redirect_uris),
		scopes: row.scopes ? parseJsonColumn<string[]>(row.scopes) : null,
	};
}

export function validateClientRedirectUri(
	redirectUri: string,
	allowedUris: string[],
): string | null {
	if (allowedUris.includes(redirectUri)) {
		return null;
	}
	return "redirect_uri is not registered for this client";
}
