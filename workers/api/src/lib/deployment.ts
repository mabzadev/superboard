import { Env } from '../types';

export const REGISTRATION_NOT_ALLOWED = 'registration_not_allowed';

export function normalizeRegistrationEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isFullAccess(env: Env): boolean {
  return env.OPENGROW_ACCESS_MODE === 'full';
}

/** Full Access deployments cannot have Purchases disabled by a stale project row. */
export function isPurchasesEnabled(env: Env, configured: unknown): boolean {
  return isFullAccess(env) || configured === true || Number(configured) === 1;
}

export function registrationRealm(env: Env): string {
  return String(env.REGISTRATION_REALM || '').trim();
}

export function isSsoEnabled(env: Env): boolean {
  return String(env.SSO_ENABLED || '').toLowerCase() === 'true';
}

export async function isRegistrationAllowed(env: Env, rawEmail: unknown): Promise<boolean> {
  if (env.REGISTRATION_MODE !== 'allowlist') return true;

  const realm = registrationRealm(env);
  const email = normalizeRegistrationEmail(rawEmail);
  if (!realm || !email) return false;

  const row = await env.DB.prepare(`
    SELECT 1 AS allowed
    FROM registration_allowlist
    WHERE realm = ? AND email = ? AND active = 1
    LIMIT 1
  `).bind(realm, email).first<{ allowed: number }>();

  return row?.allowed === 1;
}

export async function recordSuccessfulRegistration(env: Env, rawEmail: unknown): Promise<void> {
  if (env.REGISTRATION_MODE !== 'allowlist') return;

  const realm = registrationRealm(env);
  const email = normalizeRegistrationEmail(rawEmail);
  if (!realm || !email) return;

  await env.DB.prepare(`
    UPDATE registration_allowlist
    SET registration_count = registration_count + 1,
        last_registered_at = datetime('now'),
        updated_at = datetime('now')
    WHERE realm = ? AND email = ? AND active = 1
  `).bind(realm, email).run();
}

export function registrationDeniedBody() {
  return {
    error: REGISTRATION_NOT_ALLOWED,
    message: 'This email is not authorized for this OpenGrow deployment.',
  };
}
