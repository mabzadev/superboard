import type { Env } from '../types';
import { readTextLimited } from './http-limits';
import { appStoreConnectAccess } from './store-verification';

const APP_FIELDS = [
  'bundleId',
  'subscriptionStatusUrl',
  'subscriptionStatusUrlForSandbox',
  'subscriptionStatusUrlVersion',
  'subscriptionStatusUrlVersionForSandbox',
].join(',');

export const APPLE_NOTIFICATION_CONFIRMATION = 'configure_app_store_server_notifications_v2';

export type AppleNotificationConfiguration = {
  provider: 'apple';
  app_id: string;
  bundle_id: string;
  current: {
    production_url: string | null;
    sandbox_url: string | null;
    production_version: string | null;
    sandbox_version: string | null;
  };
  required: {
    production_url: string;
    sandbox_url: string;
    production_version: 'V2';
    sandbox_version: 'V2';
  };
  checks: {
    production_url: boolean;
    sandbox_url: boolean;
    production_version: boolean;
    sandbox_version: boolean;
  };
  ready: boolean;
};

export function requiredAppleNotificationUrls(
  apiDomain: string,
  productionProjectId: string,
  sandboxProjectId: string,
) {
  const origin = apiOrigin(apiDomain);
  return {
    production_url: `${origin}/api/v2/purchases/providers/webhooks/apple/production/${projectId(productionProjectId)}`,
    sandbox_url: `${origin}/api/v2/purchases/providers/webhooks/apple/sandbox/${projectId(sandboxProjectId)}`,
    production_version: 'V2' as const,
    sandbox_version: 'V2' as const,
  };
}

export async function readAppleNotificationConfiguration(
  env: Env,
  productionProjectId: string,
  sandboxProjectId: string,
): Promise<AppleNotificationConfiguration> {
  const required = requiredAppleNotificationUrls(env.API_DOMAIN, productionProjectId, sandboxProjectId);
  const access = await appStoreConnectAccess(env, projectId(productionProjectId));
  const payload = await appleJson(
    `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(access.appId)}?fields%5Bapps%5D=${encodeURIComponent(APP_FIELDS)}`,
    access.token,
  );
  return configuration(payload, access.appId, access.bundleId, required);
}

export async function configureAppleNotificationConfiguration(
  env: Env,
  productionProjectId: string,
  sandboxProjectId: string,
): Promise<AppleNotificationConfiguration> {
  const required = requiredAppleNotificationUrls(env.API_DOMAIN, productionProjectId, sandboxProjectId);
  const access = await appStoreConnectAccess(env, projectId(productionProjectId));
  await appleJson(
    `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(access.appId)}`,
    access.token,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          type: 'apps',
          id: access.appId,
          attributes: {
            subscriptionStatusUrl: required.production_url,
            subscriptionStatusUrlForSandbox: required.sandbox_url,
            subscriptionStatusUrlVersion: required.production_version,
            subscriptionStatusUrlVersionForSandbox: required.sandbox_version,
          },
        },
      }),
    },
  );
  return readAppleNotificationConfiguration(env, productionProjectId, sandboxProjectId);
}

export async function persistAppleNotificationConfiguration(
  db: D1Database,
  productionProjectId: string,
  value: AppleNotificationConfiguration,
) {
  await db.prepare(`
    INSERT INTO billing_store_notification_configurations (
      project_id, provider, ready, current_configuration, required_configuration,
      checked_at, configured_at, updated_at
    ) VALUES (?, 'apple', ?, ?, ?, datetime('now'), CASE WHEN ? = 1 THEN datetime('now') END, datetime('now'))
    ON CONFLICT(project_id, provider) DO UPDATE SET
      ready = excluded.ready,
      current_configuration = excluded.current_configuration,
      required_configuration = excluded.required_configuration,
      checked_at = excluded.checked_at,
      configured_at = CASE
        WHEN excluded.ready = 1 THEN COALESCE(billing_store_notification_configurations.configured_at, excluded.configured_at)
        ELSE billing_store_notification_configurations.configured_at
      END,
      updated_at = excluded.updated_at
  `).bind(
    projectId(productionProjectId),
    value.ready ? 1 : 0,
    JSON.stringify(value.current),
    JSON.stringify(value.required),
    value.ready ? 1 : 0,
  ).run();
}

export async function refreshAppleNotificationConfigurationsIfDue(env: Env, now = new Date()) {
  const period = `${now.toISOString().slice(0, 10)}:${Math.floor(now.getUTCHours() / 6)}`;
  const marker = `billing:apple-notification-configuration:${period}`;
  if (await env.KV.get(marker)) return { checked: 0, ready: 0, failures: [], skipped: true };
  const projects = await env.DB.prepare(`
    SELECT production.id AS production_project_id, sandbox.id AS sandbox_project_id
    FROM projects production
    JOIN projects sandbox ON sandbox.instance_id = production.instance_id
      AND COALESCE(sandbox.is_test, sandbox.test, 0) = 1
    WHERE COALESCE(production.is_test, production.test, 0) = 0
      AND EXISTS (
        SELECT 1 FROM applications app
        JOIN ios_configurations ios ON ios.application_id = app.id
        JOIN ios_server_api_keys credentials
          ON credentials.instance_id = CAST(app.instance_id AS TEXT)
          OR credentials.ios_configuration_id = ios.id
        WHERE app.instance_id = production.instance_id AND app.platform = 'ios'
          AND COALESCE(app.enabled, 1) = 1
          AND credentials.encrypted_key IS NOT NULL
          AND credentials.key_id IS NOT NULL
          AND credentials.issuer_id IS NOT NULL
      )
    ORDER BY production.id
    LIMIT 100
  `).all<{ production_project_id: string | number; sandbox_project_id: string | number }>();
  let ready = 0;
  const failures: Array<{ project_id: string; code: string }> = [];
  for (const row of projects.results) {
    const productionProjectId = String(row.production_project_id);
    const sandboxProjectId = String(row.sandbox_project_id);
    try {
      const value = await readAppleNotificationConfiguration(env, productionProjectId, sandboxProjectId);
      await persistAppleNotificationConfiguration(env.DB, productionProjectId, value);
      if (value.ready) ready += 1;
    } catch (error) {
      failures.push({
        project_id: productionProjectId,
        code: String((error as { code?: string }).code || 'apple_notification_configuration_check_failed'),
      });
    }
  }
  await env.KV.put(marker, now.toISOString(), { expirationTtl: 604_800 });
  return { checked: projects.results.length, ready, failures, skipped: false };
}

function configuration(
  payload: Record<string, unknown>,
  appId: string,
  bundleId: string,
  required: AppleNotificationConfiguration['required'],
): AppleNotificationConfiguration {
  const data = object(payload.data);
  const attributes = object(data.attributes);
  const rawCurrent = {
    production_url: optionalText(attributes.subscriptionStatusUrl),
    sandbox_url: optionalText(attributes.subscriptionStatusUrlForSandbox),
    production_version: optionalText(attributes.subscriptionStatusUrlVersion),
    sandbox_version: optionalText(attributes.subscriptionStatusUrlVersionForSandbox),
  };
  const checks = {
    production_url: normalizedUrl(rawCurrent.production_url) === normalizedUrl(required.production_url),
    sandbox_url: normalizedUrl(rawCurrent.sandbox_url) === normalizedUrl(required.sandbox_url),
    production_version: rawCurrent.production_version === required.production_version,
    sandbox_version: rawCurrent.sandbox_version === required.sandbox_version,
  };
  const current = {
    production_url: safeProviderDestination(rawCurrent.production_url, required.production_url),
    sandbox_url: safeProviderDestination(rawCurrent.sandbox_url, required.sandbox_url),
    production_version: rawCurrent.production_version,
    sandbox_version: rawCurrent.sandbox_version,
  };
  return {
    provider: 'apple',
    app_id: appId,
    bundle_id: bundleId,
    current,
    required,
    checks,
    ready: Object.values(checks).every(Boolean),
  };
}

async function appleJson(url: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal || AbortSignal.timeout(10_000),
  });
  const text = await readTextLimited(response, 1_000_000, 'App Store Connect response is too large');
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; }
  catch { throw appleError('apple_connect_response_invalid', 'App Store Connect returned invalid JSON', 502, true); }
  if (!response.ok) {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const first = object(errors[0]);
    const detail = optionalText(first.detail) || optionalText(first.title);
    throw appleError(
      'apple_notification_configuration_failed',
      detail ? `App Store Connect: ${detail}` : `App Store Connect returned HTTP ${response.status}`,
      response.status === 401 || response.status === 403 ? 422 : 502,
      response.status === 429 || response.status >= 500,
    );
  }
  return payload;
}

function apiOrigin(value: string) {
  const candidate = value.includes('://') ? value : `https://${value}`;
  let parsed: URL;
  try { parsed = new URL(candidate); }
  catch { throw appleError('api_domain_invalid', 'The public API domain is invalid', 500, false); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/') {
    throw appleError('api_domain_invalid', 'The public API domain must be an HTTPS origin', 500, false);
  }
  return parsed.origin;
}

function projectId(value: string) {
  const result = String(value || '').trim();
  if (!/^[1-9][0-9]{0,18}$/.test(result)) {
    throw appleError('apple_notification_project_invalid', 'Production and sandbox projects are required', 422, false);
  }
  return result;
}

function normalizedUrl(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

function safeProviderDestination(value: string | null, required: string) {
  if (!value) return null;
  if (normalizedUrl(value) === normalizedUrl(required)) return required;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.origin : 'Configured destination';
  } catch {
    return 'Configured destination';
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function appleError(code: string, message: string, status: number, retryable: boolean) {
  return Object.assign(new Error(message), { code, status, retryable });
}
