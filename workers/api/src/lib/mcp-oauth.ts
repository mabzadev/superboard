import type { SiteOperatorIdentity } from "@superboard/contracts/site-operator";

import { tokenDigest } from "./token-storage";
export { tokenDigest } from "./token-storage";

export const MCP_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

export interface McpClientRow {
	id: string;
	client_id: string;
	client_name?: string | null;
	name?: string | null;
	redirect_uris?: string | null;
	grant_types?: string | null;
	response_types?: string | null;
	token_endpoint_auth_method?: string | null;
	application_type?: string | null;
	client_uri?: string | null;
	logo_uri?: string | null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(prefix = "mcp_"): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `${prefix}${bytesToBase64Url(bytes)}`;
}

async function sha256Base64Url(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return bytesToBase64Url(new Uint8Array(digest));
}

export async function verifyPkce(
	verifier: unknown,
	challenge: string | null | undefined,
	method: string | null | undefined,
): Promise<boolean> {
	if (!verifier || !challenge || method !== "S256") return false;
	const computed = await sha256Base64Url(String(verifier));
	return computed === challenge;
}

export function normalizeStringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
		} catch {
			return value
				? value
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean)
				: [];
		}
	}
	return [];
}

export function redirectUriAllowed(client: McpClientRow, redirectUri: string): boolean {
	const allowed = normalizeStringArray(client.redirect_uris);
	return allowed.includes(redirectUri);
}

export function validRegistrationRedirectUri(uri: string): boolean {
	try {
		const parsed = new URL(uri);
		if (parsed.protocol === "https:") return true;
		if (parsed.protocol !== "http:") return false;
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
	} catch {
		return false;
	}
}

export function mcpClientResponse(client: McpClientRow) {
	return {
		client_id: client.client_id,
		client_name: client.client_name || client.name,
		redirect_uris: normalizeStringArray(client.redirect_uris),
		grant_types: normalizeStringArray(client.grant_types || "authorization_code"),
		response_types: normalizeStringArray(client.response_types || "code"),
		token_endpoint_auth_method: client.token_endpoint_auth_method || "none",
		application_type: client.application_type || "native",
	};
}

export async function findMcpClient(
	db: D1Database,
	clientId: string,
): Promise<McpClientRow | null> {
	return db
		.prepare("SELECT * FROM mcp_clients WHERE client_id = ? LIMIT 1")
		.bind(clientId)
		.first<McpClientRow>();
}

export async function createMcpAuthorizationCode(
	db: D1Database,
	params: {
		client: McpClientRow;
		userId: number | null;
		siteOperator?: SiteOperatorIdentity;
		redirectUri: string;
		codeChallenge: string;
		codeChallengeMethod: string;
		state?: string | null;
		scope?: string | null;
	},
) {
	const code = randomToken("mcp_code_");
	const insert = db
		.prepare(`
    INSERT INTO mcp_authorization_codes (
      mcp_client_id, user_id, code, redirect_uri, scopes, expires_at,
      client_id, code_challenge, code_challenge_method, scope, state
    ) VALUES (?, ?, ?, ?, ?, datetime('now', '+1 minute'), ?, ?, ?, ?, ?)
  `)
		.bind(
			params.client.id,
			params.userId === null ? null : String(params.userId),
			code,
			params.redirectUri,
			JSON.stringify([params.scope || "mcp:full"]),
			params.client.client_id,
			params.codeChallenge,
			params.codeChallengeMethod,
			params.scope || "mcp:full",
			params.state || null,
		);
	if (params.siteOperator)
		await db.batch([insert, siteGrantStatement(db, "code", code, params.siteOperator)]);
	else await insert.run();
	return code;
}

export async function issueMcpToken(
	db: D1Database,
	params: {
		client: McpClientRow;
		userId: number | string | null;
		siteOperator?: SiteOperatorIdentity;
		scope?: string | null;
		name?: string | null;
		expiresInSeconds?: number;
	},
) {
	const expiresIn = params.expiresInSeconds ?? MCP_TOKEN_TTL_SECONDS;
	if (!Number.isSafeInteger(expiresIn) || expiresIn < 30 || expiresIn > MCP_TOKEN_TTL_SECONDS)
		throw new TypeError("Invalid MCP token lifetime");
	const accessToken = randomToken("mcp_");
	const refreshToken = randomToken("mcp_refresh_");
	const accessDigest = await tokenDigest(accessToken);
	const refreshDigest = await tokenDigest(refreshToken);
	const scope = params.scope || "mcp:full";
	const name =
		params.name ||
		params.client.client_name ||
		params.client.name ||
		params.client.client_id ||
		"MCP Token";

	const insert = db
		.prepare(`
    INSERT INTO mcp_tokens (
      mcp_client_id, user_id, access_token, refresh_token, scopes, expires_at,
      name, client_id, scope, token_digest, refresh_token_digest
    ) VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?, ?, ?, ?, ?)
  `)
		.bind(
			params.client.id,
			params.userId === null ? null : String(params.userId),
			accessDigest,
			refreshDigest,
			JSON.stringify([scope]),
			`+${expiresIn} seconds`,
			name,
			params.client.client_id,
			scope,
			accessDigest,
			refreshDigest,
		);
	if (params.siteOperator)
		await db.batch([insert, siteGrantStatement(db, "token", accessDigest, params.siteOperator)]);
	else await insert.run();

	return {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: expiresIn,
		refresh_token: refreshToken,
		scope,
	};
}

export async function readMcpSiteOperatorGrant(
	db: D1Database,
	type: "code" | "token",
	key: string,
): Promise<SiteOperatorIdentity | null> {
	const row = await db
		.prepare(
			"SELECT instance_slug, operator_id, operator_role FROM mcp_site_operator_grants WHERE resource_type = ? AND resource_key = ?",
		)
		.bind(type, key)
		.first<{ instance_slug: string; operator_id: string; operator_role: number }>();
	return row
		? { instance_id: row.instance_slug, operator_id: row.operator_id, role: row.operator_role }
		: null;
}

function siteGrantStatement(
	db: D1Database,
	type: "code" | "token",
	key: string,
	identity: SiteOperatorIdentity,
) {
	return db
		.prepare(
			"INSERT INTO mcp_site_operator_grants (resource_type, resource_key, instance_slug, operator_id, operator_role) VALUES (?, ?, ?, ?, ?)",
		)
		.bind(type, key, identity.instance_id, identity.operator_id, identity.role);
}
