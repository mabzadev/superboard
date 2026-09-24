import type { Env } from "../types";

export async function tokenDigest(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isTokenDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

async function digestStoredValue(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value) return null;
  return isTokenDigest(value) ? value : tokenDigest(value);
}

type OAuthTokenRow = {
  id: string | number;
  token: string;
  refresh_token: string | null;
  previous_refresh_token: string | null;
};

type McpTokenRow = {
  id: string | number;
  access_token: string;
  refresh_token: string | null;
};

type UserActionTokenRow = {
  id: string | number;
  reset_password_token: string | null;
  invitation_token: string | null;
};

/**
 * Converts bearer-token plaintext left by the historical schema into
 * irreversible SHA-256 digests. Queries remain backward compatible during the
 * bounded convergence window, while all new writes are digest-only.
 */
export async function migrateLegacyBearerTokenStorage(
  env: Env,
  limit = 100,
): Promise<{ oauth: number; mcp: number; oauthClients: number; userActions: number }> {
  const boundedLimit = Math.max(1, Math.min(100, Number(limit || 100)));
  const oauthRows = await env.DB.prepare(`
    SELECT id, token, refresh_token, previous_refresh_token
    FROM oauth_access_tokens
    WHERE length(token) != 64 OR token GLOB '*[^a-f0-9]*'
       OR (refresh_token IS NOT NULL AND (length(refresh_token) != 64 OR refresh_token GLOB '*[^a-f0-9]*'))
       OR (previous_refresh_token IS NOT NULL AND previous_refresh_token != ''
           AND (length(previous_refresh_token) != 64 OR previous_refresh_token GLOB '*[^a-f0-9]*'))
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<OAuthTokenRow>();
  let oauth = 0;
  for (const row of oauthRows.results || []) {
    const accessDigest = await digestStoredValue(row.token);
    const refreshDigest = await digestStoredValue(row.refresh_token);
    const previousDigest = await digestStoredValue(row.previous_refresh_token);
    if (!accessDigest) continue;
    const result = await env.DB.prepare(`
      UPDATE oauth_access_tokens
      SET token = ?, refresh_token = ?, previous_refresh_token = ?
      WHERE id = ?
    `).bind(accessDigest, refreshDigest, previousDigest || "", row.id).run();
    oauth += Number(result.meta?.changes || 0);
  }

  const mcpRows = await env.DB.prepare(`
    SELECT id, access_token, refresh_token
    FROM mcp_tokens
    WHERE length(access_token) != 64 OR access_token GLOB '*[^a-f0-9]*'
       OR (refresh_token IS NOT NULL AND (length(refresh_token) != 64 OR refresh_token GLOB '*[^a-f0-9]*'))
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<McpTokenRow>();
  let mcp = 0;
  for (const row of mcpRows.results || []) {
    const accessDigest = await digestStoredValue(row.access_token);
    const refreshDigest = await digestStoredValue(row.refresh_token);
    if (!accessDigest) continue;
    const result = await env.DB.prepare(`
      UPDATE mcp_tokens
      SET access_token = ?, refresh_token = ?,
          token_digest = ?, refresh_token_digest = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(accessDigest, refreshDigest, accessDigest, refreshDigest, row.id).run();
    mcp += Number(result.meta?.changes || 0);
  }

  const oauthClientsRows = await env.DB.prepare(`
    SELECT id, secret
    FROM oauth_applications
    WHERE length(secret) != 64 OR secret GLOB '*[^a-f0-9]*'
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<{ id: string | number; secret: string }>();
  let oauthClients = 0;
  for (const row of oauthClientsRows.results || []) {
    const result = await env.DB.prepare(`
      UPDATE oauth_applications
      SET secret = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(await tokenDigest(row.secret), row.id).run();
    oauthClients += Number(result.meta?.changes || 0);
  }

  const userActionRows = await env.DB.prepare(`
    SELECT id, reset_password_token, invitation_token
    FROM users
    WHERE (reset_password_token IS NOT NULL
           AND (length(reset_password_token) != 64 OR reset_password_token GLOB '*[^a-f0-9]*'))
       OR (invitation_token IS NOT NULL
           AND (length(invitation_token) != 64 OR invitation_token GLOB '*[^a-f0-9]*'))
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(boundedLimit).all<UserActionTokenRow>();
  let userActions = 0;
  for (const row of userActionRows.results || []) {
    const result = await env.DB.prepare(`
      UPDATE users
      SET reset_password_token = ?, invitation_token = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      await digestStoredValue(row.reset_password_token),
      await digestStoredValue(row.invitation_token),
      row.id,
    ).run();
    userActions += Number(result.meta?.changes || 0);
  }

  return { oauth, mcp, oauthClients, userActions };
}
