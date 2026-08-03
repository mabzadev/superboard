import { Hono } from 'hono';
import { Env } from '../types';
import { signToken, verifyToken, verifyPassword, verifyTotpCode } from '../lib/crypto';
import { getOrCreateInstanceForUser } from '../lib/db';
import { getAuthContext } from '../lib/auth';
import { isFullAccess } from '../lib/deployment';


const oauth = new Hono<{ Bindings: Env }>();

async function readBody(c: any): Promise<Record<string, string>> {
  const contentType = c.req.header('content-type') || '';
  if (contentType.includes('application/json')) {
    return await c.req.json().catch(() => ({}));
  }
  const formBody = await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(formBody).map(([k, v]) => [k, String(v)]));
}

// =============================================
// OAuth2 Doorkeeper-compatible endpoints
// Compatible with the OpenGrow dashboard OAuth contract.
// =============================================

// POST /oauth/token — password grant + refresh_token grant
oauth.post('/token', async (c) => {
  // Accepte JSON et application/x-www-form-urlencoded
  const body = await readBody(c);
  const grantType = body['grant_type'];
  const clientId = body['client_id'];
  const clientSecret = body['client_secret'];


  // Verify the OAuth client.
  const oauthApp = await c.env.DB.prepare(
    'SELECT * FROM oauth_applications WHERE uid = ? AND secret = ?'
  ).bind(clientId, clientSecret).first<{ id: number; uid: string }>();

  if (!oauthApp) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication failed.' }, 401);
  }

  // === Password Grant ===
  if (grantType === 'password') {
    const email = body['email'] || body['username'];
    const password = body['password'];

    const user = await c.env.DB.prepare(
      'SELECT id, email, password_hash, encrypted_password, name, otp_required_for_login, otp_secret FROM users WHERE email = ?'
    ).bind(email).first<{
      id: number;
      email: string;
      password_hash: string | null;
      encrypted_password: string | null;
      name: string;
      otp_required_for_login: number | null;
      otp_secret: string | null;
    }>();

    const storedPassword = user?.password_hash || user?.encrypted_password || '';
    if (!user || !(await verifyPassword(password, storedPassword))) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid email or password.' }, 401);
    }

    if (user.otp_required_for_login === 1) {
      const otpCode = body['otp_code'];
      if (!otpCode || !user.otp_secret || !(await verifyTotpCode(otpCode, user.otp_secret))) {
        return c.json({ requires_otp: true });
      }
    }

    const instanceId = await getOrCreateInstanceForUser(
      c.env.DB,
      user.id,
      user.email.split('@')[0],
      isFullAccess(c.env),
    );

    const accessToken = await signToken({ sub: user.id, instanceId, type: 'access' }, c.env, '2h');
    const refreshToken = await signToken({ sub: user.id, instanceId, type: 'refresh' }, c.env, '7d');

    // Stocke le token en DB
    await c.env.DB.prepare(
      "INSERT INTO oauth_access_tokens (resource_owner_id, application_id, token, refresh_token, expires_in, scopes) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(user.id, oauthApp.id, accessToken, refreshToken, 7200, 'read write').run();

    return c.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: refreshToken,
      scope: 'read write',
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  // === Refresh Token Grant ===
  if (grantType === 'refresh_token') {
    const refreshToken = body['refresh_token'] as string;

    const stored = await c.env.DB.prepare(
      `SELECT *
       FROM oauth_access_tokens
       WHERE refresh_token = ?
         AND revoked_at IS NULL
         AND datetime(created_at) >= datetime('now', '-7 days')`
    ).bind(refreshToken).first<{ id: number; resource_owner_id: number; token: string }>();

    if (!stored) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token.' }, 401);
    }

    const payload = await verifyToken(refreshToken, c.env).catch(() => null);
    if (!payload) {
      return c.json({ error: 'invalid_grant' }, 401);
    }

    const newAccess = await signToken({ sub: payload.sub, instanceId: payload.instanceId, type: 'access' }, c.env, '2h');
    const newRefresh = await signToken({ sub: payload.sub, instanceId: payload.instanceId, type: 'refresh' }, c.env, '7d');

    // Revoke the previous token and create its replacement.
    await c.env.DB.prepare("UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(stored.id).run();
    await c.env.DB.prepare(
      "INSERT INTO oauth_access_tokens (resource_owner_id, application_id, token, refresh_token, previous_refresh_token, expires_in, scopes) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(payload.sub, oauthApp.id, newAccess, newRefresh, refreshToken, 7200, 'read write').run();

    return c.json({
      access_token: newAccess,
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: newRefresh,
      scope: 'read write',
      created_at: Math.floor(Date.now() / 1000),
    });
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

// POST /oauth/revoke
oauth.post('/revoke', async (c) => {
  const body = await readBody(c);
  const token = body['token'] as string;
  if (token) {
    await c.env.DB.prepare(
      "UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE token = ? OR refresh_token = ?"
    ).bind(token, token).run();
  }
  return c.json({});
});

// GET /oauth/token/info — introspection
oauth.get('/token/info', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const context = await getAuthContext(c.env, auth);
  if (!context) return c.json({ error: 'invalid_token' }, 401);

  const stored = await c.env.DB.prepare(
    'SELECT oat.*, u.email, u.name FROM oauth_access_tokens oat JOIN users u ON u.id = oat.resource_owner_id WHERE oat.token = ? AND oat.revoked_at IS NULL'
  ).bind(context.token).first<{ resource_owner_id: number; email: string; name: string; scopes: string; expires_in: number; created_at: string }>();

  if (!stored) return c.json({ error: 'invalid_token' }, 401);

  const createdAt = new Date(stored.created_at).getTime() / 1000;
  return c.json({
    resource_owner_id: stored.resource_owner_id,
    scope: stored.scopes,
    expires_in: stored.expires_in,
    application: { uid: 'vocostar' },
    created_at: Math.floor(createdAt),
  });
});

// GET /api/v1/me — Return the dashboard user's profile after login.
oauth.get('/api/v1/me', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const context = await getAuthContext(c.env, auth);
  if (!context) return c.json({ error: 'Unauthorized' }, 401);

  const stored = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, i.api_key, i.uri_scheme
     FROM oauth_access_tokens oat
     JOIN users u ON u.id = oat.resource_owner_id
     LEFT JOIN instance_roles ir ON ir.user_id = u.id
     LEFT JOIN instances i ON i.id = ir.instance_id
     WHERE oat.token = ? AND oat.revoked_at IS NULL
     ORDER BY ir.id ASC LIMIT 1`
  ).bind(context.token).first<{ id: number; email: string; name: string; api_key: string | null; uri_scheme: string | null }>();

  if (!stored) return c.json({ error: 'Unauthorized' }, 401);

  return c.json({
    id: stored.id,
    email: stored.email,
    name: stored.name,
    api_key: stored.api_key,
  });
});

export default oauth;
