import type { BillingEnv } from '../types';
import { applyVerifiedPurchase } from './billing';
import { readTextLimited } from './http-limits';
import { decryptCredential, scopedStoreCredential } from './secrets';
import { reconcileAppleSubscription } from './store-verification';

const REVENUECAT_ORIGIN = 'https://api.revenuecat.com';
const PAGE_SIZE = 5;
const MAX_CHILD_PAGES = 3;

type LegacySource = {
  id: string;
  project_id: string;
  external_project_id: string;
  configuration_encrypted: string | null;
  billing_configuration_encrypted: string | null;
};

type LegacyRun = LegacySource & {
  run_id: string;
  environment: 'sandbox' | 'production';
  status: string;
  next_cursor: string | null;
};

type RevenueCatCredentials = { api_key: string };
type RevenueCatList = { items: Record<string, unknown>[]; next_page: string | null };

export type NormalizedLegacySubscription = {
  externalSubscriptionId: string;
  provider: 'apple' | 'google' | 'unsupported';
  environment: 'sandbox' | 'production';
  storeProductId: string | null;
  storeSubscriptionIdentifier: string | null;
  sourceStatus: string | null;
  sourceExpiresAt: string | null;
};

export async function testLegacySourceConnection(
  source: LegacySource,
  env: BillingEnv,
  fetchImpl: typeof fetch = fetch,
) {
  const credentials = await sourceCredentials(source, env);
  const path = `/v2/projects/${encodeURIComponent(source.external_project_id)}/customers?limit=1`;
  const payload = await revenueCatRequest(credentials, path, fetchImpl);
  const page = parseList(payload);
  return { ok: true, provider: 'revenuecat', customers_sampled: page.items.length };
}

export async function processLegacyInventoryPage(
  env: BillingEnv,
  runId: string,
  cursor?: string,
  fetchImpl: typeof fetch = fetch,
) {
  const claimToken = crypto.randomUUID();
  const expectedCursor = cursor || '';
  const run = await env.DB.prepare(`
    UPDATE billing_legacy_inventory_runs
    SET status = 'running', started_at = COALESCE(started_at, datetime('now')),
      claim_token = ?, claim_expires_at = datetime('now', '+5 minutes'), updated_at = datetime('now')
    WHERE id = ? AND status IN ('queued', 'running')
      AND COALESCE(next_cursor, '') = ?
      AND (claim_token IS NULL OR claim_expires_at IS NULL OR datetime(claim_expires_at) <= datetime('now'))
    RETURNING id AS run_id, project_id, source_id, environment, status, next_cursor
  `).bind(claimToken, runId, expectedCursor).first<Record<string, unknown>>();
  if (!run) return { skipped: true, reason: 'stale_or_claimed' };

  const context = await env.DB.prepare(`
    SELECT r.id AS run_id, r.project_id, r.environment, r.status, r.next_cursor,
      s.id, s.external_project_id, s.configuration_encrypted, s.billing_configuration_encrypted
    FROM billing_legacy_inventory_runs r
    JOIN billing_legacy_sources s ON s.id = r.source_id
    WHERE r.id = ? AND r.claim_token = ?
  `).bind(runId, claimToken).first<LegacyRun>();
  if (!context) return { skipped: true, reason: 'claim_lost' };

  try {
    const credentials = await sourceCredentials(context, env);
    const basePath = `/v2/projects/${encodeURIComponent(context.external_project_id)}/customers`;
    const pagePath = `${basePath}?limit=${PAGE_SIZE}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`;
    const page = parseList(await revenueCatRequest(credentials, pagePath, fetchImpl));

    for (const customer of page.items) {
      await inventoryCustomer(env, context, credentials, customer, fetchImpl);
    }

    const nextCursor = nextPageCursor(page.next_page, basePath);
    await refreshRunCounts(env, runId);
    const transition = await env.DB.prepare(`
      UPDATE billing_legacy_inventory_runs
      SET status = ?, next_cursor = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END,
        claim_token = NULL, claim_expires_at = NULL, last_error_code = NULL, last_error_message = NULL,
        updated_at = datetime('now')
      WHERE id = ? AND claim_token = ? AND COALESCE(next_cursor, '') = ?
    `).bind(nextCursor ? 'running' : 'completed', nextCursor, nextCursor ? 'running' : 'completed', runId, claimToken, expectedCursor).run();
    if (!transition.meta.changes) return { skipped: true, reason: 'claim_lost' };
    if (nextCursor && env.BILLING_QUEUE) {
      await env.BILLING_QUEUE.send(
        { type: 'billing.legacy.inventory.page', runId, cursor: nextCursor },
        { delaySeconds: 5 },
      );
    }
    return { processed: true, customers: page.items.length, completed: !nextCursor, next_cursor: nextCursor };
  } catch (error) {
    const tagged = error as { code?: string; retryable?: boolean; message?: string };
    await env.DB.prepare(`
      UPDATE billing_legacy_inventory_runs
      SET status = CASE WHEN ? THEN 'running' ELSE 'failed' END,
        claim_token = NULL, claim_expires_at = NULL, last_error_code = ?, last_error_message = ?, updated_at = datetime('now')
      WHERE id = ? AND claim_token = ?
    `).bind(tagged.retryable !== false ? 1 : 0, tagged.code || 'legacy_inventory_failed', String(tagged.message || error).slice(0, 1000), runId, claimToken).run();
    throw error;
  }
}

export function normalizeLegacySubscription(value: Record<string, unknown>): NormalizedLegacySubscription | null {
  if (value.gives_access !== true) return null;
  const externalSubscriptionId = String(value.id || '').trim();
  if (!externalSubscriptionId) return null;
  const environment = String(value.environment || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const store = String(value.store || '').trim().toLowerCase();
  const provider = store === 'app_store' || store === 'mac_app_store'
    ? 'apple'
    : store === 'play_store'
      ? 'google'
      : 'unsupported';
  return {
    externalSubscriptionId,
    provider,
    environment,
    storeProductId: subscriptionProductIdentifier(value),
    storeSubscriptionIdentifier: stringOrNull(value.store_subscription_identifier),
    sourceStatus: stringOrNull(value.status),
    sourceExpiresAt: millisToIso(value.current_period_ends_at ?? value.ends_at),
  };
}

export function nextPageCursor(nextPage: unknown, expectedPath: string): string | null {
  if (!nextPage) return null;
  const url = new URL(String(nextPage), REVENUECAT_ORIGIN);
  if (url.origin !== REVENUECAT_ORIGIN || url.pathname !== expectedPath) {
    throw legacyError('legacy_provider_pagination_invalid', 'Legacy provider returned an invalid pagination URL', false);
  }
  const cursor = url.searchParams.get('starting_after');
  if (!cursor || cursor.length > 1500) {
    throw legacyError('legacy_provider_pagination_invalid', 'Legacy provider returned an invalid pagination cursor', false);
  }
  return cursor;
}

async function inventoryCustomer(
  env: BillingEnv,
  run: LegacyRun,
  credentials: RevenueCatCredentials,
  customer: Record<string, unknown>,
  fetchImpl: typeof fetch,
) {
  const externalCustomerId = String(customer.id || '').trim();
  if (!externalCustomerId) return;
  const root = `/v2/projects/${encodeURIComponent(run.external_project_id)}/customers/${encodeURIComponent(externalCustomerId)}`;
  const [aliases, subscriptions] = await Promise.all([
    collectRevenueCatList(credentials, `${root}/aliases`, fetchImpl),
    collectRevenueCatList(credentials, `${root}/subscriptions?environment=${run.environment}`, fetchImpl),
  ]);
  const aliasValues = [externalCustomerId, ...aliases.map((item) => String(item.id || '').trim())]
    .filter(Boolean).slice(0, 250);
  const identity = await findCustomerIdentity(env, run.project_id, aliasValues);
  const displayAppUserId = identity?.app_user_id
    || aliasValues.find((value) => !value.startsWith('$RCAnonymousID:'))
    || aliasValues[0]
    || null;
  await env.DB.batch([
    cql(env, `
      DELETE FROM billing_legacy_subscription_inventory
      WHERE run_id = ? AND external_customer_id = ?
    `, run.run_id, externalCustomerId),
    cql(env, `
      INSERT INTO billing_legacy_customer_inventory
        (id, run_id, project_id, external_customer_id, app_user_id, customer_id, resolution_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, external_customer_id) DO UPDATE SET app_user_id = excluded.app_user_id,
        customer_id = excluded.customer_id, resolution_status = excluded.resolution_status, updated_at = datetime('now')
    `, crypto.randomUUID(), run.run_id, run.project_id, externalCustomerId, displayAppUserId,
    identity?.customer_id || null, identity ? 'matched' : 'unmatched'),
  ]);

  for (const raw of subscriptions) {
    const normalized = normalizeLegacySubscription(raw);
    if (!normalized || normalized.environment !== run.environment) continue;
    const resolution = await resolveSubscription(env, run, normalized, identity?.customer_id || null);
    await env.DB.prepare(`
      INSERT INTO billing_legacy_subscription_inventory (
        id, run_id, project_id, external_customer_id, external_subscription_id,
        app_user_id, customer_id, provider, environment, store_product_id,
        store_subscription_identifier, source_status, source_expires_at,
        resolution_status, matched_subscription_id, resolution_detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, external_subscription_id) DO UPDATE SET
        app_user_id = excluded.app_user_id, customer_id = excluded.customer_id,
        provider = excluded.provider, environment = excluded.environment,
        store_product_id = excluded.store_product_id,
        store_subscription_identifier = excluded.store_subscription_identifier,
        source_status = excluded.source_status, source_expires_at = excluded.source_expires_at,
        resolution_status = excluded.resolution_status,
        matched_subscription_id = excluded.matched_subscription_id,
        resolution_detail = excluded.resolution_detail, updated_at = datetime('now')
    `).bind(
      crypto.randomUUID(), run.run_id, run.project_id, externalCustomerId,
      normalized.externalSubscriptionId, displayAppUserId, identity?.customer_id || null,
      normalized.provider, normalized.environment, normalized.storeProductId,
      normalized.storeSubscriptionIdentifier, normalized.sourceStatus, normalized.sourceExpiresAt,
      resolution.status, resolution.subscriptionId, resolution.detail,
    ).run();
  }
}

async function resolveSubscription(
  env: BillingEnv,
  run: LegacyRun,
  subscription: NormalizedLegacySubscription,
  customerId: string | null,
): Promise<{ status: string; subscriptionId: string | null; detail: string | null }> {
  if (subscription.provider === 'unsupported') {
    return { status: 'unsupported_provider', subscriptionId: null, detail: 'The legacy provider is outside the supported billing scope.' };
  }
  if (!customerId) return { status: 'unmatched_customer', subscriptionId: null, detail: 'No application identity alias matched this customer.' };
  if (!subscription.storeProductId) return { status: 'missing_product', subscriptionId: null, detail: 'The provider response did not include a Store product identifier.' };

  let matched = await verifiedSubscription(env, run.project_id, customerId, subscription);
  if (!matched && subscription.provider === 'apple' && subscription.storeSubscriptionIdentifier) {
    try {
      const purchase = await reconcileAppleSubscription(env, {
        projectId: run.project_id,
        customerId,
        transactionId: subscription.storeSubscriptionIdentifier,
        environment: run.environment,
      });
      await applyVerifiedPurchase(env, purchase);
      matched = await verifiedSubscription(env, run.project_id, customerId, subscription);
    } catch {
      // The item remains unresolved. No entitlement is created unless Apple verification succeeds.
    }
  }
  return matched
    ? { status: 'matched', subscriptionId: matched.id, detail: null }
    : { status: 'missing_verified_subscription', subscriptionId: null, detail: 'Restore or provider verification is required before legacy removal.' };
}

async function verifiedSubscription(
  env: BillingEnv,
  projectId: string,
  customerId: string,
  subscription: NormalizedLegacySubscription,
) {
  return env.DB.prepare(`
    SELECT s.id
    FROM billing_subscriptions s
    JOIN billing_products p ON p.id = s.product_id
    JOIN billing_transactions t ON t.id = s.latest_transaction_id AND t.verified_at IS NOT NULL
    WHERE s.project_id = ? AND s.customer_id = ? AND s.store = ? AND s.environment = ?
      AND p.store_product_id = ?
      AND s.status IN ('active', 'trialing', 'grace_period', 'cancelled', 'billing_issue')
      AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
    ORDER BY CASE WHEN s.original_transaction_id = ? OR t.store_transaction_id = ? THEN 0 ELSE 1 END,
      s.updated_at DESC
    LIMIT 1
  `).bind(
    projectId, customerId, subscription.provider, subscription.environment,
    subscription.storeProductId, subscription.storeSubscriptionIdentifier,
    subscription.storeSubscriptionIdentifier,
  ).first<{ id: string }>();
}

async function findCustomerIdentity(env: BillingEnv, projectId: string, aliases: string[]) {
  if (!aliases.length) return null;
  return env.DB.prepare(`
    SELECT a.customer_id, a.app_user_id
    FROM billing_customer_aliases a
    WHERE a.project_id = ? AND a.app_user_id IN (SELECT value FROM json_each(?))
    ORDER BY CASE WHEN a.alias_type = 'identified' THEN 0 ELSE 1 END, a.created_at ASC
    LIMIT 1
  `).bind(projectId, JSON.stringify(aliases)).first<{ customer_id: string; app_user_id: string }>();
}

async function collectRevenueCatList(
  credentials: RevenueCatCredentials,
  initialPath: string,
  fetchImpl: typeof fetch,
) {
  const separator = initialPath.includes('?') ? '&' : '?';
  const basePath = initialPath.split('?')[0];
  let path = `${initialPath}${separator}limit=100`;
  const items: Record<string, unknown>[] = [];
  for (let pageNumber = 0; pageNumber < MAX_CHILD_PAGES; pageNumber += 1) {
    const page = parseList(await revenueCatRequest(credentials, path, fetchImpl));
    items.push(...page.items);
    const cursor = nextPageCursor(page.next_page, basePath);
    if (!cursor) return items;
    const filter = initialPath.includes('?') ? `${initialPath}&` : `${initialPath}?`;
    path = `${filter}limit=100&starting_after=${encodeURIComponent(cursor)}`;
  }
  throw legacyError('legacy_provider_pagination_limit', 'Legacy provider pagination exceeded the safety limit', false);
}

async function sourceCredentials(source: LegacySource, env: BillingEnv): Promise<RevenueCatCredentials> {
  const encrypted = scopedStoreCredential(source, env);
  if (!encrypted) throw legacyError('legacy_source_not_configured', 'Legacy source credentials are not configured', false);
  try {
    const parsed = JSON.parse(await decryptCredential(env, encrypted)) as Record<string, unknown>;
    const apiKey = String(parsed.api_key || '').trim();
    if (!apiKey) throw new Error('Missing API key');
    return { api_key: apiKey };
  } catch {
    throw legacyError('legacy_source_key_invalid', 'Legacy source API key is invalid', false);
  }
}

async function revenueCatRequest(credentials: RevenueCatCredentials, path: string, fetchImpl: typeof fetch) {
  const url = new URL(path, REVENUECAT_ORIGIN);
  if (url.origin !== REVENUECAT_ORIGIN || !url.pathname.startsWith('/v2/projects/')) {
    throw legacyError('legacy_provider_url_invalid', 'Legacy provider URL is invalid', false);
  }
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${credentials.api_key}`, Accept: 'application/json' },
    redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) {
    throw legacyError(
      'legacy_provider_redirect_rejected',
      'Legacy provider redirects are not allowed',
      false,
    );
  }
  const text = await readTextLimited(response, 1_048_576, 'Legacy provider response is too large');
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {
    throw legacyError('legacy_provider_response_invalid', 'Legacy provider returned invalid JSON', response.status >= 500);
  }
  if (!response.ok) {
    const message = String(payload.message || payload.type || `Legacy provider returned HTTP ${response.status}`);
    const retryable = response.status === 429 || response.status >= 500;
    const error = legacyError('legacy_provider_request_failed', message, retryable);
    const retryAfter = Number(response.headers.get('Retry-After') || 0);
    if (retryable && Number.isFinite(retryAfter) && retryAfter > 0) error.retryDelaySeconds = Math.min(3600, retryAfter);
    throw error;
  }
  return payload;
}

function parseList(payload: Record<string, unknown>): RevenueCatList {
  if (payload.object !== 'list' || !Array.isArray(payload.items)) {
    throw legacyError('legacy_provider_response_invalid', 'Legacy provider returned an invalid list', false);
  }
  return {
    items: payload.items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)),
    next_page: typeof payload.next_page === 'string' && payload.next_page ? payload.next_page : null,
  };
}

function subscriptionProductIdentifier(subscription: Record<string, unknown>): string | null {
  const direct = subscription.product;
  if (direct && typeof direct === 'object' && !Array.isArray(direct)) {
    const value = stringOrNull((direct as Record<string, unknown>).store_identifier);
    if (value) return value;
  }
  const productId = String(subscription.product_id || '');
  const entitlements = subscription.entitlements;
  const entitlementItems = listItems(entitlements);
  for (const entitlement of entitlementItems) {
    for (const product of listItems(entitlement.products)) {
      if (!productId || String(product.id || '') === productId) {
        const value = stringOrNull(product.store_identifier);
        if (value) return value;
      }
    }
  }
  return null;
}

function listItems(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

async function refreshRunCounts(env: BillingEnv, runId: string) {
  await env.DB.prepare(`
    UPDATE billing_legacy_inventory_runs SET
      customers_scanned = (SELECT COUNT(*) FROM billing_legacy_customer_inventory WHERE run_id = ?),
      active_subscriptions = (SELECT COUNT(*) FROM billing_legacy_subscription_inventory WHERE run_id = ?),
      matched_subscriptions = (SELECT COUNT(*) FROM billing_legacy_subscription_inventory WHERE run_id = ? AND resolution_status = 'matched'),
      unresolved_subscriptions = (SELECT COUNT(*) FROM billing_legacy_subscription_inventory WHERE run_id = ? AND resolution_status <> 'matched'),
      unsupported_subscriptions = (SELECT COUNT(*) FROM billing_legacy_subscription_inventory WHERE run_id = ? AND resolution_status = 'unsupported_provider'),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(runId, runId, runId, runId, runId, runId).run();
}

function millisToIso(value: unknown): string | null {
  if (value == null) return null;
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : null;
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 1500) : null;
}

function cql(env: BillingEnv, sql: string, ...values: unknown[]) {
  return env.DB.prepare(sql).bind(...values);
}

function legacyError(code: string, message: string, retryable: boolean) {
  return Object.assign(new Error(message), {
    code,
    status: retryable ? 503 : 422,
    retryable,
    retryDelaySeconds: retryable ? 60 : undefined,
  });
}
