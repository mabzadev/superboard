import { Hono } from 'hono';
import { Env } from '../types';
import { verifyToken, verifyPassword, verifyTotpCode } from '../lib/crypto';
import { getOrCreateInstanceForUser } from '../lib/db';
import { getAuthContext, issueDbBackedTokens } from '../lib/auth';
import { tokenDigest } from '../lib/token-storage';
import { timingSafeEqual } from '../lib/secrets';
import { readOtpSecret } from '../lib/auth-credentials';
import { consumeDashboardAuthAttempt, dashboardAuthRateLimitResponse } from '../lib/auth-rate-limit';
import { readRequestObjectLimited } from '@superboard/contracts/request-body';


const oauth = new Hono<{ Bindings: Env }>();

async function readBody(c: any): Promise<Record<string, string>> {
  return await readRequestObjectLimited(c.req.raw, 1024 * 1024) as Record<string, string>;
}

async function oauthSecretMatches(
  stored: string | null | undefined,
  provided: string | undefined,
  providedDigest: string,
): Promise<boolean> {
  if (!stored || !provided) return false;
  return await timingSafeEqual(stored, providedDigest) ||
    await timingSafeEqual(stored, provided);
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
    `SELECT id, uid, secret, previous_secret,
       CASE
         WHEN previous_secret IS NOT NULL
          AND previous_secret_expires_at IS NOT NULL
          AND datetime(previous_secret_expires_at) > datetime('now')
         THEN 1 ELSE 0
       END AS previous_secret_valid
     FROM oauth_applications WHERE uid = ? LIMIT 1`
  ).bind(clientId).first<{
    id: number;
    uid: string;
    secret: string;
    previous_secret: string | null;
    previous_secret_valid: number;
  }>();

  const clientSecretDigest = clientSecret ? await tokenDigest(clientSecret) : '';
  const currentSecretMatches = await oauthSecretMatches(
    oauthApp?.secret,
    clientSecret,
    clientSecretDigest,
  );
  const previousSecretMatches = oauthApp?.previous_secret_valid === 1 &&
    await oauthSecretMatches(
      oauthApp.previous_secret,
      clientSecret,
      clientSecretDigest,
    );
  const clientSecretMatches = currentSecretMatches || previousSecretMatches;
  if (!oauthApp || !clientSecretMatches) {
    return c.json({ error: 'invalid_client', error_description: 'Client authentication failed.' }, 401);
  }

  // === Password Grant ===
  if (grantType === 'password') {
    const email = body['email'] || body['username'];
    const password = body['password'];
    const rateLimit = await consumeDashboardAuthAttempt(c.env, c.req.raw, 'oauth.password', email);
    if (!rateLimit.allowed) return dashboardAuthRateLimitResponse(rateLimit);

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
      const otpSecret = user.otp_secret ? await readOtpSecret(c.env, user.otp_secret) : null;
      if (!otpCode || !otpSecret || !(await verifyTotpCode(otpCode, otpSecret))) {
        return c.json({ requires_otp: true });
      }
    }

    const instanceId = await getOrCreateInstanceForUser(
      c.env.DB,
      user.id,
      user.email.split('@')[0],
      true,
    );

    return c.json(await issueDbBackedTokens(c.env, user.id, instanceId, oauthApp.id));
  }

  // === Refresh Token Grant ===
  if (grantType === 'refresh_token') {
    const refreshToken = body['refresh_token'] as string;
    const refreshDigest = await tokenDigest(refreshToken);

    const stored = await c.env.DB.prepare(
      `SELECT *
       FROM oauth_access_tokens
       WHERE (refresh_token = ? OR refresh_token = ?)
         AND revoked_at IS NULL
         AND datetime(created_at) >= datetime('now', '-7 days')`
    ).bind(refreshDigest, refreshToken).first<{ id: number; resource_owner_id: number; token: string }>();

    if (!stored) {
      return c.json({ error: 'invalid_grant', error_description: 'Invalid refresh token.' }, 401);
    }

    const payload = await verifyToken(refreshToken, c.env).catch(() => null);
    if (!payload) {
      return c.json({ error: 'invalid_grant' }, 401);
    }

    // Revoke the previous token and create its replacement.
    await c.env.DB.prepare("UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE id = ?").bind(stored.id).run();
    return c.json(await issueDbBackedTokens(
      c.env,
      Number(payload.sub),
      Number(payload.instanceId) || null,
      oauthApp.id,
      'read write',
      refreshToken,
    ));
  }

  return c.json({ error: 'unsupported_grant_type' }, 400);
});

// POST /oauth/revoke
oauth.post('/revoke', async (c) => {
  const body = await readBody(c);
  const token = body['token'] as string;
  if (token) {
    const digest = await tokenDigest(token);
    await c.env.DB.prepare(
      "UPDATE oauth_access_tokens SET revoked_at = datetime('now') WHERE token IN (?, ?) OR refresh_token IN (?, ?)"
    ).bind(digest, token, digest, token).run();
  }
  return c.json({});
});

// GET /oauth/token/info — introspection
oauth.get('/token/info', async (c) => {
  const auth = c.req.header('Authorization') || '';
  const context = await getAuthContext(c.env, auth);
  if (!context) return c.json({ error: 'invalid_token' }, 401);

  const stored = await c.env.DB.prepare(
    `SELECT oat.*, u.email, u.name, application.uid application_uid
     FROM oauth_access_tokens oat
     JOIN users u ON u.id = oat.resource_owner_id
     LEFT JOIN oauth_applications application ON application.id = oat.application_id
     WHERE oat.token IN (?, ?) AND oat.revoked_at IS NULL`
  ).bind(await tokenDigest(context.token), context.token).first<{ resource_owner_id: number; email: string; name: string; scopes: string; expires_in: number; created_at: string; application_uid: string | null }>();

  if (!stored) return c.json({ error: 'invalid_token' }, 401);

  const createdAt = new Date(stored.created_at).getTime() / 1000;
  return c.json({
    resource_owner_id: stored.resource_owner_id,
    scope: stored.scopes,
    expires_in: stored.expires_in,
    application: { uid: stored.application_uid || c.env.DASHBOARD_CLIENT_ID },
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
     WHERE oat.token IN (?, ?) AND oat.revoked_at IS NULL
     ORDER BY ir.id ASC LIMIT 1`
  ).bind(await tokenDigest(context.token), context.token).first<{ id: number; email: string; name: string; api_key: string | null; uri_scheme: string | null }>();

  if (!stored) return c.json({ error: 'Unauthorized' }, 401);

  return c.json({
    id: stored.id,
    email: stored.email,
    name: stored.name,
    api_key: stored.api_key,
  });
});

export default oauth;
