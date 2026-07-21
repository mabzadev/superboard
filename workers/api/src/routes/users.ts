import { Hono } from 'hono';
import * as QRCode from 'qrcode';
import { Env } from '../types';
import {
  buildOtpAuthUri,
  generateApiKey,
  generateOtpSecret,
  hashPassword,
  verifyPassword,
  verifyTotpCode,
} from '../lib/crypto';
import { getOrCreateProject } from '../lib/db';
import { getAuthUserId, issueDbBackedTokens } from '../lib/auth';
import { passwordResetMessage, sendMail } from '../lib/mail';

const users = new Hono<{ Bindings: Env }>();

type OAuthApplication = { id: number; uid: string };
type UserRow = {
  id: number;
  email: string;
  name: string | null;
  password_hash: string | null;
  invitation_token?: string | null;
  invitation_accepted_at?: string | null;
};

async function readJsonBody(c: any): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function findOAuthApplication(c: any, clientId: string | undefined): Promise<OAuthApplication | null> {
  if (!clientId) return null;
  return (await c.env.DB.prepare('SELECT id, uid FROM oauth_applications WHERE uid = ?')
    .bind(clientId)
    .first()) as OAuthApplication | null;
}

async function issueOAuthTokens(c: any, userId: number, instanceId: number | null | undefined, applicationId: number) {
  return issueDbBackedTokens(c.env, userId, instanceId, applicationId);
}

// Helper — extrait le user depuis le token Bearer
async function getAuthUser(c: any) {
  return getAuthUserId(c.env, c.req.header('Authorization'));
}

// POST /api/v1/users — Créer un compte (utilisé par le dashboard OpenGrow)
users.post('/', async (c) => {
  const body: any = await readJsonBody(c);

  const userData = body.user || (body as any);
  const { password, name } = userData;
  const email = typeof userData.email === 'string' ? normalizeEmail(userData.email) : '';
  const oauthApp = await findOAuthApplication(c, userData.client_id || body.client_id);

  if (!oauthApp) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (!email || !password) {
    return c.json({ error: 'Email and password required' }, 422);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, email, name, invitation_token, invitation_accepted_at FROM users WHERE email = ?'
  ).bind(email).first<UserRow>();
  if (existing) {
    const invitationToken = userData.invitation_token || body.invitation_token;
    if (invitationToken && existing.invitation_token === invitationToken && !existing.invitation_accepted_at) {
      const passwordHash = await hashPassword(password);
      await c.env.DB.prepare(`
        UPDATE users
        SET password_hash = ?,
            encrypted_password = ?,
            name = COALESCE(?, name),
            invitation_accepted_at = datetime("now"),
            confirmed_at = COALESCE(confirmed_at, datetime("now")),
            updated_at = datetime("now")
        WHERE id = ?
      `).bind(passwordHash, passwordHash, name || null, existing.id).run();

      const role = await c.env.DB.prepare(
        'SELECT instance_id, role FROM instance_roles WHERE user_id = ? LIMIT 1'
      ).bind(existing.id).first<{ instance_id: number; role: string }>();
      const tokens = await issueOAuthTokens(c, existing.id, role?.instance_id, oauthApp.id);
      return c.json({
        ...tokens,
        user: { id: existing.id, email: existing.email, name: name || existing.name, role: role?.role || 'member' },
      }, 201);
    }
    return c.json({ error: 'Email already taken' }, 422);
  }

  const passwordHash = await hashPassword(password);
  const apiKey = generateApiKey();

  const userResult = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, encrypted_password, name, confirmed_at) VALUES (?, ?, ?, ?, datetime("now")) RETURNING id'
  ).bind(email, passwordHash, passwordHash, name || null).first<{ id: number }>();

  const uriScheme = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now().toString(36);
  const instanceResult = await c.env.DB.prepare(
    'INSERT INTO instances (api_key, uri_scheme) VALUES (?, ?) RETURNING id'
  ).bind(apiKey, uriScheme).first<{ id: number }>();

  await c.env.DB.prepare(
    'INSERT INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)'
  ).bind(userResult!.id, instanceResult!.id, 'owner').run();

  await getOrCreateProject(c.env.DB, instanceResult!.id, 'production');
  await getOrCreateProject(c.env.DB, instanceResult!.id, 'test');

  const tokens = await issueOAuthTokens(c, userResult!.id, instanceResult!.id, oauthApp.id);

  return c.json({
    ...tokens,
    user: { id: userResult!.id, email, name: name || null }
  }, 201);
});


// GET /api/v1/users/me — Profil utilisateur courant
users.get('/me', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, created_at, otp_required_for_login FROM users WHERE id = ?'
  ).bind(userId).first<{ id: number; email: string; name: string; created_at: string; otp_required_for_login: number | null }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  const role = await c.env.DB.prepare(
    'SELECT instance_id, role FROM instance_roles WHERE user_id = ? LIMIT 1'
  ).bind(userId).first<{ instance_id: number; role: string }>();

  const instance = role ? await c.env.DB.prepare(
    'SELECT id, api_key, uri_scheme FROM instances WHERE id = ?'
  ).bind(role.instance_id).first<{ id: number; api_key: string; uri_scheme: string }>() : null;

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
      otp_required_for_login: user.otp_required_for_login === 1,
      role: role?.role || 'owner',
    },
    instance: instance ? {
      id: instance.id,
      api_key: instance.api_key,
      uri_scheme: instance.uri_scheme,
    } : null,
  });
});

// PATCH /api/v1/users/me — Modifier le profil
users.patch('/me', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body: any = await c.req.json().catch(() => ({}));

  if (body.name !== undefined) {
    await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(body.name, userId).run();
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ?'
  ).bind(userId).first();

  return c.json({ user });
});

// POST /api/v1/users/reset_password
users.post('/reset_password', async (c) => {
  const body: { email?: string; user?: { email?: string } } = await c.req.json().catch(() => ({}));
  const email = body.email || body.user?.email;
  if (email) {
    const normalizedEmail = normalizeEmail(email);
    const user = await c.env.DB.prepare(
      'SELECT id, email FROM users WHERE email = ? LIMIT 1'
    ).bind(normalizedEmail).first<{ id: number; email: string }>();

    if (!user) {
      return c.json({ message: 'Email sent' });
    }

    const token = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      'UPDATE users SET reset_password_token = ?, reset_password_sent_at = datetime("now") WHERE id = ?'
    ).bind(token, user.id).run();

    try {
      await sendMail(c.env, passwordResetMessage(c.env, user.email, token));
    } catch (error: any) {
      console.error('password_reset_mail_failed', { user_id: user.id, error: error?.message || String(error) });
      return c.json({ error: 'Password reset email could not be delivered' }, 503);
    }
  }
  return c.json({ message: 'Email sent' });
});

// POST /api/v1/users/change_password
users.post('/change_password', async (c) => {
  const body: any = await readJsonBody(c);
  const resetToken = body.reset_token || body.reset_password_token || body.user?.reset_password_token;
  const newPassword = body.new_password || body.password || body.user?.password;

  if (resetToken && newPassword) {
    const user = await c.env.DB.prepare(`
      SELECT id
      FROM users
      WHERE reset_password_token = ?
        AND reset_password_sent_at IS NOT NULL
        AND datetime(reset_password_sent_at) >= datetime('now', '-6 hours')
      LIMIT 1
    `).bind(resetToken).first<{ id: number }>();

    if (!user) return c.json({ error: 'Invalid reset token' }, 404);

    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare(`
      UPDATE users
      SET password_hash = ?,
          encrypted_password = ?,
          reset_password_token = NULL,
          reset_password_sent_at = NULL,
          updated_at = datetime("now")
      WHERE id = ?
    `).bind(newHash, newHash, user.id).run();

    return c.json({ message: 'Password changed' });
  }

  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  if (!body.current_password || !newPassword) {
    return c.json({ error: 'current_password and new_password required' }, 422);
  }

  const user = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?'
  ).bind(userId).first<{ password_hash: string }>();

  if (!user || !(await verifyPassword(body.current_password, user.password_hash))) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hashPassword(newPassword);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, encrypted_password = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(newHash, newHash, userId).run();

  return c.json({ message: 'Password updated successfully' });
});

// POST /api/v1/users/otp_status
users.post('/otp_status', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT otp_required_for_login FROM users WHERE id = ?'
  ).bind(userId).first<{ otp_required_for_login: number | null }>();

  return c.json({ otp_enabled: user?.otp_required_for_login === 1 });
});

// GET /api/v1/users/me/otp_qr
users.get('/me/otp_qr', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const user = await c.env.DB.prepare(
    'SELECT email, otp_required_for_login, otp_secret FROM users WHERE id = ?'
  ).bind(userId).first<{ email: string; otp_required_for_login: number | null; otp_secret: string | null }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  const currentSecret = user.otp_secret || '';
  const secret = /^[A-Z2-7]+$/.test(currentSecret) ? currentSecret : generateOtpSecret();
  if (secret !== currentSecret) {
    await c.env.DB.prepare('UPDATE users SET otp_secret = ?, updated_at = datetime("now") WHERE id = ?')
      .bind(secret, userId).run();
  }

  const uri = buildOtpAuthUri(user.email, secret);
  const svg = await QRCode.toString(uri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 160 });
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
});

// DELETE /api/v1/users/me — Supprimer son compte
users.delete('/me', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  // Révoquer tous les tokens
  await c.env.DB.prepare('DELETE FROM oauth_access_tokens WHERE resource_owner_id = ?').bind(userId).run();
  await c.env.DB.prepare('DELETE FROM instance_roles WHERE user_id = ?').bind(userId).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();
  return c.json({ message: 'Account deleted' });
});

// POST /api/v1/users/accept_invite
users.post('/accept_invite', async (c) => {
  const body: any = await readJsonBody(c);
  const invitationToken = body.invitation_token || body.token;
  const oauthApp = await findOAuthApplication(c, body.client_id);

  if (!oauthApp) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  if (!invitationToken || !body.password) {
    return c.json({ error: 'invitation_token and password required' }, 422);
  }

  const invited = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE invitation_token = ? AND invitation_accepted_at IS NULL LIMIT 1'
  ).bind(invitationToken).first<{ id: number; email: string; name: string | null }>();

  if (!invited) {
    return c.json({ error: 'Invitation token is invalid or already accepted' }, 422);
  }

  const passwordHash = await hashPassword(body.password);
  await c.env.DB.prepare(`
    UPDATE users
    SET password_hash = ?,
        encrypted_password = ?,
        name = COALESCE(?, name),
        invitation_accepted_at = datetime("now"),
        confirmed_at = COALESCE(confirmed_at, datetime("now")),
        updated_at = datetime("now")
    WHERE id = ?
  `).bind(passwordHash, passwordHash, body.name || null, invited.id).run();

  const role = await c.env.DB.prepare(
    'SELECT instance_id, role FROM instance_roles WHERE user_id = ? LIMIT 1'
  ).bind(invited.id).first<{ instance_id: number; role: string }>();

  const tokens = await issueOAuthTokens(c, invited.id, role?.instance_id, oauthApp.id);

  return c.json({
    ...tokens,
    user: { id: invited.id, email: invited.email, name: body.name || invited.name, role: role?.role || 'member' },
  });
});

// PUT /api/v1/users/me/two_factor
users.put('/me/two_factor', async (c) => {
  const userId = await getAuthUser(c);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const body: any = await readJsonBody(c);
  const enableValue = body.enable_2fa ?? body.enabled ?? body.otp_required_for_login ?? body.two_factor_enabled ?? true;
  const enabled = Boolean(enableValue);
  const otpCode = body.otp_code || body.code;

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, otp_secret FROM users WHERE id = ?'
  ).bind(userId).first<{ id: number; email: string; name: string | null; otp_secret: string | null }>();

  if (!user) return c.json({ error: 'User not found' }, 404);
  if (!user.otp_secret) return c.json({ error: 'OTP setup required' }, 422);

  const valid = await verifyTotpCode(otpCode, user.otp_secret);
  if (!valid) return c.json({ error: 'Invalid OTP code' }, 403);

  await c.env.DB.prepare(
    'UPDATE users SET otp_required_for_login = ?, updated_at = datetime("now") WHERE id = ?'
  ).bind(enabled ? 1 : 0, userId).run();

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      otp_required_for_login: enabled,
    },
  });
});

export default users;
