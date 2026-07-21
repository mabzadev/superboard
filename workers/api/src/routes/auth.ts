import { Hono } from 'hono';
import { Env } from '../types';
import { verifyPassword, hashPassword, generateApiKey } from '../lib/crypto';
import { ensureDefaultOAuthApplication, getAuthContext, issueDbBackedTokens } from '../lib/auth';

const auth = new Hono<{ Bindings: Env }>();

// POST /api/v1/auth/sign_up
auth.post('/sign_up', async (c) => {
  const { email, password, name } = await c.req.json<{ email: string; password: string; name?: string }>();
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return c.json({ error: 'Email and password required' }, 422);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(normalizedEmail).first();
  if (existing) {
    return c.json({ error: 'Email already taken' }, 422);
  }

  const passwordHash = await hashPassword(password);
  const apiKey = generateApiKey();

  // Create user
  const userResult = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash, encrypted_password, name, confirmed_at) VALUES (?, ?, ?, ?, datetime("now")) RETURNING id'
  ).bind(normalizedEmail, passwordHash, passwordHash, name || null).first<{ id: number }>();

  // Create instance for this user
  const uriScheme = normalizedEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now().toString(36);
  const instanceResult = await c.env.DB.prepare(
    'INSERT INTO instances (api_key, uri_scheme) VALUES (?, ?) RETURNING id'
  ).bind(apiKey, uriScheme).first<{ id: number }>();

  // Link user to instance as owner
  await c.env.DB.prepare(
    'INSERT INTO instance_roles (user_id, instance_id, role) VALUES (?, ?, ?)'
  ).bind(userResult!.id, instanceResult!.id, 'owner').run();

  const applicationId = await ensureDefaultOAuthApplication(c.env.DB, c.env.DASHBOARD_CLIENT_ID);
  const tokens = await issueDbBackedTokens(c.env, userResult!.id, instanceResult!.id, applicationId);

  return c.json({
    token: tokens.access_token,
    ...tokens,
    user: { id: userResult!.id, email: normalizedEmail, name: name || null },
    instance: { id: instanceResult!.id, api_key: apiKey, uri_scheme: uriScheme }
  }, 201);
});

// POST /api/v1/auth/sign_in
auth.post('/sign_in', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const normalizedEmail = email?.trim().toLowerCase();

  if (!normalizedEmail || !password) {
    return c.json({ error: 'Email and password required' }, 422);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, password_hash, encrypted_password FROM users WHERE email = ?'
  ).bind(normalizedEmail).first<{ id: number; email: string; name: string; password_hash: string | null; encrypted_password: string | null }>();

  if (!user || !(await verifyPassword(password, user.password_hash || user.encrypted_password || ''))) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Get instance
  const role = await c.env.DB.prepare(
    'SELECT instance_id FROM instance_roles WHERE user_id = ? LIMIT 1'
  ).bind(user.id).first<{ instance_id: number }>();

  const instance = await c.env.DB.prepare(
    'SELECT id, api_key, uri_scheme FROM instances WHERE id = ?'
  ).bind(role?.instance_id).first<{ id: number; api_key: string; uri_scheme: string }>();

  const applicationId = await ensureDefaultOAuthApplication(c.env.DB, c.env.DASHBOARD_CLIENT_ID);
  const tokens = await issueDbBackedTokens(c.env, user.id, instance?.id, applicationId);

  return c.json({
    token: tokens.access_token,
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name },
    instance
  });
});

// GET /api/v1/auth/me
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  const auth = await getAuthContext(c.env, authHeader);
  if (!auth) return c.json({ error: 'Invalid token' }, 401);

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, created_at FROM users WHERE id = ?'
  ).bind(auth.userId).first();

  const instance = await c.env.DB.prepare(
    'SELECT i.id, i.api_key, i.uri_scheme FROM instances i JOIN instance_roles r ON r.instance_id = i.id WHERE r.user_id = ? LIMIT 1'
  ).bind(auth.userId).first();

  return c.json({ user, instance });
});

export default auth;
