import { Hono } from 'hono';
import { Env } from '../types';
import {
  findMcpClient,
  issueMcpToken,
  mcpClientResponse,
  normalizeStringArray,
  redirectUriAllowed,
  tokenDigest,
  validRegistrationRedirectUri,
  verifyPkce,
} from '../lib/mcp-oauth';
import { readRequestObjectLimited } from '@superboard/contracts/request-body';

const mcpOauth = new Hono<{ Bindings: Env }>();

async function readBody(c: any): Promise<Record<string, any>> {
  return readRequestObjectLimited(c.req.raw, 1024 * 1024);
}

function consentUrl(c: any) {
  return configuredMcpConsentUrl(c.env);
}

export function configuredMcpConsentUrl(env: Pick<Env, 'MCP_CONSENT_URL' | 'APP_URL'>): string {
  const explicit = String(env.MCP_CONSENT_URL || '').trim();
  const dashboard = String(env.APP_URL || '').trim();
  const candidate = explicit || (dashboard ? `${dashboard.replace(/\/$/, '')}/mcp/authorize` : '');
  if (!candidate) throw new Error('MCP consent URL is not configured');
  const url = new URL(candidate);
  const local = new Set(['localhost', '127.0.0.1', '[::1]']).has(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new Error('MCP consent URL must be an absolute HTTPS URL');
  }
  return url.toString();
}

function htmlError(c: any, error: string, description: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
  return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(error)}</title></head><body><h1>${escape(error)}</h1><p>${escape(description)}</p></body></html>`, 400);
}

mcpOauth.post('/register', async (c) => {
  const body = await readBody(c);
  const clientName = String(body.client_name || '').trim();
  const redirectUris = normalizeStringArray(body.redirect_uris);
  if (!clientName || redirectUris.length === 0) {
    return c.json({ error: 'client_name and redirect_uris are required' }, 400);
  }
  const invalid = redirectUris.find((uri) => !validRegistrationRedirectUri(uri));
  if (invalid) return c.json({ error: `Invalid redirect_uri: ${invalid}` }, 400);

  const existing = await c.env.DB.prepare('SELECT * FROM mcp_clients WHERE client_name = ? OR name = ? ORDER BY created_at ASC')
    .bind(clientName, clientName).all<any>();
  const match = (existing.results || []).find((client: any) => {
    const stored = normalizeStringArray(client.redirect_uris).sort();
    return JSON.stringify(stored) === JSON.stringify([...redirectUris].sort());
  });
  if (match) return c.json(mcpClientResponse(match), 201);

  const clientId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO mcp_clients (
      name, client_name, client_id, redirect_uris, scopes, confidential,
      grant_types, response_types, token_endpoint_auth_method, application_type, client_uri, logo_uri
    ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `).bind(
    clientName,
    clientName,
    clientId,
    JSON.stringify(redirectUris),
    JSON.stringify(['mcp:full']),
    normalizeStringArray(body.grant_types).join(',') || 'authorization_code',
    normalizeStringArray(body.response_types).join(',') || 'code',
    body.token_endpoint_auth_method || 'none',
    body.application_type || 'native',
    body.client_uri || null,
    body.logo_uri || null,
  ).run();

  const client = await findMcpClient(c.env.DB, clientId);
  return c.json(mcpClientResponse(client!), 201);
});

mcpOauth.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id') || '';
  const redirectUri = c.req.query('redirect_uri') || '';
  const responseType = c.req.query('response_type') || '';
  const codeChallenge = c.req.query('code_challenge') || '';
  const codeChallengeMethod = c.req.query('code_challenge_method') || '';

  if (responseType !== 'code') return htmlError(c, 'unsupported_response_type', 'Only response_type=code is supported');
  if (!clientId || !redirectUri) return htmlError(c, 'invalid_request', 'client_id and redirect_uri are required');
  if (!codeChallenge || codeChallengeMethod !== 'S256') return htmlError(c, 'invalid_request', 'PKCE with S256 method is required');

  const client = await findMcpClient(c.env.DB, clientId);
  if (!client) return htmlError(c, 'invalid_client', 'Unknown client_id');
  if (!redirectUriAllowed(client, redirectUri)) return htmlError(c, 'invalid_request', 'redirect_uri not registered for this client');

  const target = new URL(consentUrl(c));
  target.searchParams.set('client_id', clientId);
  target.searchParams.set('client_name', client.client_name || client.name || clientId);
  target.searchParams.set('redirect_uri', redirectUri);
  target.searchParams.set('code_challenge', codeChallenge);
  target.searchParams.set('code_challenge_method', codeChallengeMethod);
  if (c.req.query('state')) target.searchParams.set('state', c.req.query('state')!);
  if (c.req.query('scope')) target.searchParams.set('scope', c.req.query('scope')!);
  return c.redirect(target.toString(), 302);
});

mcpOauth.post('/token', async (c) => {
  const body = await readBody(c);
  const grantType = String(body.grant_type || '');
  if (grantType === 'authorization_code') {
    const code = String(body.code || '');
    const redirectUri = String(body.redirect_uri || '');
    const clientId = String(body.client_id || '');
    const authCode = await c.env.DB.prepare(`
      SELECT ac.*, mc.client_name, mc.name, mc.redirect_uris, mc.grant_types, mc.response_types,
             mc.token_endpoint_auth_method, mc.application_type, mc.client_uri, mc.logo_uri
      FROM mcp_authorization_codes ac
      JOIN mcp_clients mc ON mc.id = ac.mcp_client_id
      WHERE ac.code = ?
        AND ac.redirect_uri = ?
        AND ac.client_id = ?
        AND ac.used_at IS NULL
        AND datetime(ac.expires_at) > datetime('now')
      LIMIT 1
    `).bind(code, redirectUri, clientId).first<any>();
    if (!authCode) return c.json({ error: 'invalid_grant', error_description: 'Invalid, expired, or already-used authorization code' }, 400);
    if (!authCode.code_challenge) return c.json({ error: 'invalid_grant', error_description: 'PKCE required' }, 400);
    if (!await verifyPkce(body.code_verifier, authCode.code_challenge, authCode.code_challenge_method)) {
      return c.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
    }

    await c.env.DB.prepare('UPDATE mcp_authorization_codes SET used_at = datetime("now"), updated_at = datetime("now") WHERE id = ?')
      .bind(authCode.id).run();
    const client = {
      id: authCode.mcp_client_id,
      client_id: authCode.client_id,
      client_name: authCode.client_name,
      name: authCode.name,
      redirect_uris: authCode.redirect_uris,
    };
    return c.json(await issueMcpToken(c.env.DB, {
      client,
      userId: authCode.user_id,
      scope: authCode.scope || 'mcp:full',
      name: authCode.client_name || authCode.name || authCode.client_id,
    }));
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(body.refresh_token || '');
    const clientId = String(body.client_id || '');
    const digest = await tokenDigest(refreshToken);
    const existing = await c.env.DB.prepare(`
      SELECT mt.*, mc.id AS client_row_id, mc.client_name, mc.name AS client_row_name, mc.redirect_uris
      FROM mcp_tokens mt
      JOIN mcp_clients mc ON mc.id = mt.mcp_client_id OR mc.client_id = mt.client_id
      WHERE mt.revoked_at IS NULL
        AND (mt.refresh_token = ? OR mt.refresh_token_digest = ?)
        AND (mt.expires_at IS NULL OR datetime(mt.expires_at) > datetime('now'))
      LIMIT 1
    `).bind(refreshToken, digest).first<any>();
    if (!existing) return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token' }, 400);
    if (clientId && existing.client_id && clientId !== existing.client_id) {
      return c.json({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
    }

    await c.env.DB.prepare('UPDATE mcp_tokens SET revoked_at = datetime("now"), updated_at = datetime("now") WHERE id = ?')
      .bind(existing.id).run();
    return c.json(await issueMcpToken(c.env.DB, {
      client: {
        id: existing.client_row_id || existing.mcp_client_id,
        client_id: existing.client_id,
        client_name: existing.client_name,
        name: existing.client_row_name,
        redirect_uris: existing.redirect_uris,
      },
      userId: existing.user_id,
      scope: existing.scope || 'mcp:full',
      name: existing.name,
    }));
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

export default mcpOauth;
