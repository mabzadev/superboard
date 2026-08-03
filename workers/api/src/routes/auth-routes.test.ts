import { afterEach, describe, expect, it, vi } from 'vitest';
import authRoutes from './auth';
import instancesRoutes from './instances';
import oauthRoutes from './oauth';
import usersRoutes from './users';
import { Env } from '../types';
import { hashPassword, signToken, verifyPassword } from '../lib/crypto';
import { createFakeD1, FakeD1Call } from '../test/fake-d1';

type UserState = {
  id: number;
  email: string;
  name: string | null;
  password_hash: string;
  encrypted_password: string;
  otp_required_for_login?: number | null;
  otp_secret?: string | null;
  invitation_token?: string | null;
  invitation_accepted_at?: string | null;
  reset_password_token?: string | null;
  reset_password_sent_at?: string | null;
};

type TokenState = {
  id: number;
  resource_owner_id: number;
  application_id: number;
  token: string;
  refresh_token: string;
  previous_refresh_token?: string | null;
  expires_in: number;
  scopes: string;
  created_at: string;
  revoked_at: string | null;
};

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function authFixture() {
  const ownerPassword = await hashPassword('secret-password');
  const invitedPassword = await hashPassword('temporary-password');
  const state = {
    users: [
      {
        id: 1,
        email: 'owner@example.com',
        name: 'Owner',
        password_hash: ownerPassword,
        encrypted_password: ownerPassword,
        otp_required_for_login: 0,
        otp_secret: null,
      },
      {
        id: 2,
        email: 'member@example.com',
        name: 'Member',
        password_hash: ownerPassword,
        encrypted_password: ownerPassword,
      },
      {
        id: 3,
        email: 'admin@example.com',
        name: 'Admin',
        password_hash: ownerPassword,
        encrypted_password: ownerPassword,
      },
      {
        id: 4,
        email: 'invited@example.com',
        name: 'Invited',
        password_hash: invitedPassword,
        encrypted_password: invitedPassword,
        invitation_token: 'invite-token',
        invitation_accepted_at: null,
      },
    ] as UserState[],
    instances: [{ id: 10, api_key: 'instance-api-key', uri_scheme: 'prodapp' }],
    roles: [
      { user_id: 1, instance_id: 10, role: 'owner' },
      { user_id: 2, instance_id: 10, role: 'member' },
      { user_id: 3, instance_id: 10, role: 'admin' },
      { user_id: 4, instance_id: 10, role: 'member' },
    ],
    oauthApps: [{ id: 20, uid: 'dashboard-client', secret: 'dashboard-secret' }],
    tokens: [] as TokenState[],
  };

  const db = createFakeD1((call) => authD1Handler(call, state));
  const env = {
    DB: db,
    KV: {} as any,
    ENVIRONMENT: 'test',
    SHORTLINK_DOMAIN: 'go.test',
    API_DOMAIN: 'api.test',
    SDK_DOMAIN: 'sdk.test',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'auth-routes-secret',
    MAIL_PROVIDER: 'webhook',
    MAIL_WEBHOOK_URL: 'https://mail.test/send',
  } satisfies Env;

  return { env, state, db };
}

function authD1Handler(call: FakeD1Call, state: Awaited<ReturnType<typeof authFixture>>['state']) {
  const { op, sql, args } = call;
  const userById = (id: unknown) => state.users.find((user) => user.id === Number(id));
  const userByEmail = (email: unknown) => state.users.find((user) => user.email === String(email).toLowerCase());

  if (op === 'first' && sql.includes('FROM oauth_applications WHERE uid = ? AND secret = ?')) {
    return state.oauthApps.find((app) => app.uid === args[0] && app.secret === args[1]) || null;
  }

  if (op === 'first' && sql.includes('FROM oauth_applications WHERE uid = ?')) {
    return state.oauthApps.find((app) => app.uid === args[0]) || null;
  }

  if (op === 'first' && sql.includes("WHERE uid = 'opengrow-dashboard-vocostar'")) {
    return state.oauthApps[0];
  }

  if (op === 'first' && sql.includes('FROM users WHERE email = ?')) {
    return userByEmail(args[0]) || null;
  }

  if (op === 'first' && sql.includes('FROM users WHERE invitation_token = ?')) {
    return state.users.find((user) => user.invitation_token === args[0] && !user.invitation_accepted_at) || null;
  }

  if (op === 'first' && sql.includes('FROM users WHERE reset_password_token = ?')) {
    const user = state.users.find((candidate) => candidate.reset_password_token === args[0] && candidate.reset_password_sent_at);
    return user ? { id: user.id } : null;
  }

  if (op === 'first' && sql.includes('FROM projects WHERE instance_id = ? AND is_test = ?')) {
    const isTest = Number(args[1]);
    return {
      id: isTest ? 102 : 101,
      name: isTest ? 'Test' : 'Production',
      identifier: isTest ? 'test' : 'production',
      instance_id: Number(args[0]),
      is_test: isTest,
    };
  }

  if (op === 'first' && sql.includes('COUNT(DISTINCT')) {
    return { total: 0 };
  }

  if (op === 'first' && sql.includes('FROM users WHERE id = ?')) {
    return userById(args[0]) || null;
  }

  if (op === 'first' && sql.includes('FROM instance_roles WHERE user_id = ? AND instance_id = ?')) {
    return state.roles.find((role) => role.user_id === Number(args[0]) && role.instance_id === Number(args[1])) || null;
  }

  if (op === 'first' && sql.includes('FROM instance_roles WHERE user_id = ? LIMIT 1')) {
    return state.roles.find((role) => role.user_id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.includes('FROM instance_roles WHERE user_id = ? ORDER BY id ASC LIMIT 1')) {
    return state.roles.find((role) => role.user_id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.includes('FROM instances i JOIN instance_roles r')) {
    const role = state.roles.find((candidate) => candidate.user_id === Number(args[0]));
    return role ? state.instances.find((instance) => instance.id === role.instance_id) || null : null;
  }

  if (op === 'first' && sql.includes('FROM instances WHERE id = ?')) {
    return state.instances.find((instance) => instance.id === Number(args[0])) || null;
  }

  if (op === 'first' && sql.includes('FROM oauth_access_tokens') && sql.includes('WHERE refresh_token = ?')) {
    return state.tokens.find((candidate) => candidate.refresh_token === args[0] && !candidate.revoked_at) || null;
  }

  if (op === 'first' && sql.includes('FROM oauth_access_tokens') && (sql.includes('WHERE token = ?') || sql.includes('WHERE oat.token = ?'))) {
    const token = state.tokens.find((candidate) => candidate.token === args[0]);
    if (!token) return null;
    const user = userById(token.resource_owner_id);
    return { ...token, email: user?.email, name: user?.name };
  }

  if (op === 'all' && sql.includes('FROM instance_roles ir JOIN users u')) {
    return state.roles
      .filter((role) => role.instance_id === Number(args[0]))
      .map((role) => {
        const user = userById(role.user_id)!;
        return { id: user.id, email: user.email, name: user.name, role: role.role };
      });
  }

  if (op === 'run' && sql.startsWith('INSERT INTO oauth_access_tokens')) {
    const row = args.length === 7
      ? {
          resource_owner_id: Number(args[0]),
          application_id: Number(args[1]),
          token: String(args[2]),
          refresh_token: String(args[3]),
          previous_refresh_token: String(args[4]),
          expires_in: Number(args[5]),
          scopes: String(args[6]),
        }
      : {
          resource_owner_id: Number(args[0]),
          application_id: Number(args[1]),
          token: String(args[2]),
          refresh_token: String(args[3]),
          previous_refresh_token: null,
          expires_in: Number(args[4]),
          scopes: String(args[5]),
        };
    state.tokens.push({
      id: state.tokens.length + 1,
      created_at: new Date().toISOString(),
      revoked_at: null,
      ...row,
    });
    return true;
  }

  if (op === 'run' && sql.startsWith('UPDATE oauth_access_tokens SET revoked_at = datetime')) {
    if (sql.includes('WHERE id = ?')) {
      const token = state.tokens.find((candidate) => candidate.id === Number(args[0]));
      if (token) token.revoked_at = new Date().toISOString();
      return true;
    }
    for (const token of state.tokens) {
      if (token.token === args[0] || token.refresh_token === args[1]) token.revoked_at = new Date().toISOString();
    }
    return true;
  }

  if (op === 'run' && sql.startsWith('UPDATE users SET reset_password_token = ?')) {
    const user = userById(args[1]);
    if (user) {
      user.reset_password_token = String(args[0]);
      user.reset_password_sent_at = new Date().toISOString();
    }
    return true;
  }

  if (op === 'run' && sql.includes('SET password_hash = ?') && sql.includes('reset_password_token = NULL')) {
    const user = userById(args[2]);
    if (user) {
      user.password_hash = String(args[0]);
      user.encrypted_password = String(args[1]);
      user.reset_password_token = null;
      user.reset_password_sent_at = null;
    }
    return true;
  }

  if (op === 'run' && sql.includes('invitation_accepted_at = datetime')) {
    const user = userById(args[3]);
    if (user) {
      user.password_hash = String(args[0]);
      user.encrypted_password = String(args[1]);
      user.name = args[2] ? String(args[2]) : user.name;
      user.invitation_accepted_at = new Date().toISOString();
    }
    return true;
  }

  return undefined;
}

async function passwordGrant(env: Env, body: Record<string, unknown> = {}) {
  return oauthRoutes.request('/token', json({
    grant_type: 'password',
    client_id: 'dashboard-client',
    client_secret: 'dashboard-secret',
    username: 'owner@example.com',
    password: 'secret-password',
    ...body,
  }), env);
}

function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of input.toUpperCase().replace(/=+$/g, '').replace(/\s/g, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

async function currentTotp(secret: string): Promise<string> {
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setUint32(4, Math.floor(Date.now() / 30000));
  const key = await crypto.subtle.importKey('raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = signature[signature.length - 1] & 0xf;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OAuth/dashboard auth routes', () => {
  it('rejects non-allowlisted registration before creating any records', async () => {
    const db = createFakeD1(({ op, sql }) => {
      if (op === 'first' && sql.includes('FROM oauth_applications WHERE uid = ?')) {
        return { id: 20, uid: 'dashboard-client' };
      }
      if (op === 'first' && sql.includes('FROM registration_allowlist')) return null;
      return undefined;
    });
    const env = {
      DB: db,
      KV: {} as KVNamespace,
      ENVIRONMENT: 'test',
      SHORTLINK_DOMAIN: 'go.test',
      API_DOMAIN: 'api.test',
      SDK_DOMAIN: 'sdk.test',
      CORS_ORIGIN: '*',
      JWT_SECRET: 'auth-routes-secret',
      REGISTRATION_MODE: 'allowlist',
      REGISTRATION_REALM: 'vocostar:production',
    } satisfies Env;

    const response = await usersRoutes.request('/', json({
      client_id: 'dashboard-client',
      email: 'blocked@example.com',
      password: 'safe-password',
      name: 'Blocked',
    }), env);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'registration_not_allowed' });
    expect(db.calls.some((call) => call.sql.startsWith('INSERT INTO users'))).toBe(false);
    expect(db.calls.some((call) => call.sql.startsWith('INSERT INTO instances'))).toBe(false);
  });

  it('returns unlimited full-access usage and disables Stripe mutations', async () => {
    const { env } = await authFixture();
    env.OPENGROW_ACCESS_MODE = 'full';
    const tokenBody: any = await (await passwordGrant(env)).json();
    const headers = { Authorization: `Bearer ${tokenBody.access_token}` };

    const subscription = await instancesRoutes.request('/10/billing/subscription', { headers }, env);
    expect(subscription.status).toBe(200);
    await expect(subscription.json()).resolves.toMatchObject({
      type: 'full',
      unlimited: true,
      current_maus: 0,
      total_available: null,
    });

    const checkout = await instancesRoutes.request('/10/billing/subscriptions', {
      method: 'POST',
      headers,
    }, env);
    expect(checkout.status).toBe(409);
  });

  it('rejects a revoked access token even when its JWT remains valid', async () => {
    const { env } = await authFixture();
    const tokenResponse = await passwordGrant(env);
    const tokenBody: any = await tokenResponse.json();

    expect((await oauthRoutes.request('/token/info', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }, env)).status).toBe(200);

    await oauthRoutes.request('/revoke', json({ token: tokenBody.access_token }), env);

    expect((await oauthRoutes.request('/token/info', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }, env)).status).toBe(401);
    expect((await authRoutes.request('/me', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }, env)).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the previous access/refresh pair', async () => {
    const { env } = await authFixture();
    const tokenBody: any = await (await passwordGrant(env)).json();

    const refreshResponse = await oauthRoutes.request('/token', json({
      grant_type: 'refresh_token',
      client_id: 'dashboard-client',
      client_secret: 'dashboard-secret',
      refresh_token: tokenBody.refresh_token,
    }), env);
    expect(refreshResponse.status).toBe(200);
    const refreshed: any = await refreshResponse.json();
    expect(refreshed.refresh_token).not.toBe(tokenBody.refresh_token);

    expect((await oauthRoutes.request('/token/info', {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    }, env)).status).toBe(401);

    expect((await oauthRoutes.request('/token', json({
      grant_type: 'refresh_token',
      client_id: 'dashboard-client',
      client_secret: 'dashboard-secret',
      refresh_token: tokenBody.refresh_token,
    }), env)).status).toBe(401);

    expect((await oauthRoutes.request('/token/info', {
      headers: { Authorization: `Bearer ${refreshed.access_token}` },
    }, env)).status).toBe(200);
  });

  it('requires a valid OTP challenge for 2FA-enabled password grant users', async () => {
    const { env, state } = await authFixture();
    state.users[0].otp_required_for_login = 1;
    state.users[0].otp_secret = 'JBSWY3DPEHPK3PXP';

    const response = await passwordGrant(env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ requires_otp: true });
  });

  it('accepts 2FA password grant login with a valid OTP code', async () => {
    const { env, state } = await authFixture();
    state.users[0].otp_required_for_login = 1;
    state.users[0].otp_secret = 'JBSWY3DPEHPK3PXP';

    const response = await passwordGrant(env, { otp_code: await currentTotp(state.users[0].otp_secret) });
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.access_token).toBeTruthy();
    expect((await oauthRoutes.request('/token/info', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }, env)).status).toBe(200);
  });

  it('accepts invited users and returns DB-backed OAuth tokens', async () => {
    const { env, state } = await authFixture();
    const response = await usersRoutes.request('/accept_invite', json({
      client_id: 'dashboard-client',
      invitation_token: 'invite-token',
      password: 'accepted-password',
      name: 'Accepted User',
    }), env);

    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.access_token).toBeTruthy();
    expect(state.users[3].invitation_accepted_at).toBeTruthy();

    expect((await authRoutes.request('/me', {
      headers: { Authorization: `Bearer ${body.access_token}` },
    }, env)).status).toBe(200);
  });

  it('runs password reset request and token-based password change', async () => {
    const { env, state } = await authFixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 })));

    const resetResponse = await usersRoutes.request('/reset_password', json({ email: 'owner@example.com' }), env);
    expect(resetResponse.status).toBe(200);
    const resetToken = state.users[0].reset_password_token;
    expect(resetToken).toBeTruthy();

    const changeResponse = await usersRoutes.request('/change_password', json({
      reset_password_token: resetToken,
      password: 'new-password',
    }), env);

    expect(changeResponse.status).toBe(200);
    expect(state.users[0].reset_password_token).toBeNull();
    await expect(verifyPassword('new-password', state.users[0].password_hash)).resolves.toBe(true);
  });

  it('forbids members and allows admins on admin-only instance member routes', async () => {
    const { env, state } = await authFixture();
    const memberToken = await signToken({ sub: 2, instanceId: 10, type: 'access' }, env, '2h');
    const adminToken = await signToken({ sub: 3, instanceId: 10, type: 'access' }, env, '2h');
    state.tokens.push({
      id: 1,
      resource_owner_id: 2,
      application_id: 20,
      token: memberToken,
      refresh_token: 'member-refresh',
      expires_in: 7200,
      scopes: 'read write',
      created_at: new Date().toISOString(),
      revoked_at: null,
    }, {
      id: 2,
      resource_owner_id: 3,
      application_id: 20,
      token: adminToken,
      refresh_token: 'admin-refresh',
      expires_in: 7200,
      scopes: 'read write',
      created_at: new Date().toISOString(),
      revoked_at: null,
    });

    expect((await instancesRoutes.request('/10/members', {
      headers: { Authorization: `Bearer ${memberToken}` },
    }, env)).status).toBe(403);

    const adminResponse = await instancesRoutes.request('/10/members', {
      headers: { Authorization: `Bearer ${adminToken}` },
    }, env);
    expect(adminResponse.status).toBe(200);
    await expect(adminResponse.json()).resolves.toMatchObject({ members: expect.any(Array) });
  });
});
