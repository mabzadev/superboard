import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { decryptCredential, encryptCredential, scopedStoreCredential } from '../lib/secrets';
import { testStoreCredentials } from '../lib/store-verification';
import { errorEnvelope, PAYWALL_EVENT_TYPES, purchasesError } from '../lib/purchases-v2';
import { signedCustomerInfo } from '../lib/billing-identity';
import { identifyCustomer, queueCustomerEntitlementChanged } from '../lib/billing';
import {
  refundActionDefinitions,
  refundCaseAllowsOperatorAction,
  supportedRefundActions,
  validateRefundActionPayload,
  type RefundActionType,
} from '../lib/refund-actions';
import {
  billingOperationalPrerequisites,
  buildReleaseGate,
  catalogSyncFresh,
  certificationRunCompatibility,
  nativeCatalogCoverage,
  releaseGateProviderReadiness,
  releaseGateProductCadences,
  RELEASE_GATE_CHECKS,
  validateReleaseGateEvidence,
  type ReleaseGateCatalogProduct,
  type CertificationReferenceType,
  type ReleaseGateCertificationObservation,
  type ReleaseGatePrerequisite,
  type StoredReleaseGateCheck,
} from '../lib/purchases-release-gate';
import { callBillingServiceBinding } from '../lib/billing-service';
import { billingWorkerReadiness, type BillingWorkerReadiness } from '../lib/billing-worker-readiness';
import { testLegacySourceConnection } from '../lib/legacy-subscription-inventory';
import { validateStripeCredentials, validateStripeSecretKey } from '../lib/stripe-credentials';
import { encryptStoreCredentialCopies } from '../lib/store-credential-copies';
import { retrieveStripeCatalogProduct } from '../lib/stripe-catalog';
import { providerEventReplayJob } from '../lib/provider-event-replay';
import {
  APPLE_NOTIFICATION_CONFIRMATION,
  configureAppleNotificationConfiguration,
  persistAppleNotificationConfiguration,
  readAppleNotificationConfiguration,
} from '../lib/apple-notification-configuration';
import { issueCertificationDeviceChallenge } from '../lib/device-certification';
import {
  deleteStripeWebhookEndpoint,
  discoverStripeWebhookConfiguration,
  invalidateStripeWebhookReadiness,
  persistStripeWebhookReadiness,
  provisionStripeWebhookEndpoint,
  retrieveStripeWebhookConfiguration,
  stripeWebhookUrl,
  type StripeWebhookConfiguration,
} from '../lib/stripe-webhook-management';
import { readTextLimited } from '../lib/http-limits';

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();
admin.use('*', authMiddleware);

// Keep historical rows readable, but expose and create only supported providers.
const PROVIDERS = ['apple', 'google', 'stripe'] as const;
const ENVIRONMENTS = ['sandbox', 'production'] as const;
const FEATURE_FLAGS = ['purchases_core', 'product_catalog', 'paywalls', 'growth', 'web_billing', 'virtual_currencies', 'scheduled_exports'] as const;
const DEFAULT_RELEASE_STALE_MINUTES = 15;
const DEFAULT_CATALOG_STALE_HOURS = 24;

function releaseGateStaleMinutes(value: string | undefined) {
  const parsed = Number(value || DEFAULT_RELEASE_STALE_MINUTES);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 120 ? parsed : DEFAULT_RELEASE_STALE_MINUTES;
}

function releaseGateCatalogStaleHours(value: string | undefined) {
  const parsed = Number(value || DEFAULT_CATALOG_STALE_HOURS);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 168 ? parsed : DEFAULT_CATALOG_STALE_HOURS;
}

async function currentBillingWorkerReadiness(env: Env): Promise<BillingWorkerReadiness | null> {
  try {
    if (env.CREDENTIAL_KEY_SCOPE === 'billing') return await billingWorkerReadiness(env);
    if (!env.BILLING) return null;
    return await callBillingServiceBinding<BillingWorkerReadiness>(env, '/internal/v1/health');
  } catch (error) {
    console.error(JSON.stringify({
      event: 'billing_release_readiness_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return null;
  }
}

async function jsonBody(c: any): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function parseObjectValue(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return objectValue(value);
  try { return objectValue(JSON.parse(value)); } catch { return {}; }
}

async function projectFor(c: any) {
  const parsed = parseProjectExternalId(c.req.param('projectId'));
  const access = await c.env.DB.prepare(`
    SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1
  `).bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
  if (!access) throw purchasesError('project_not_found', 'Project not found', 404);
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, id: String(project.id), role: access.role };
}

async function releaseGateScope(c: any, project: { id: string; instanceId: number }) {
  const rows = await c.env.DB.prepare(`
    SELECT id, is_test FROM projects WHERE instance_id = ? ORDER BY is_test ASC, id ASC
  `).bind(project.instanceId).all() as { results: Array<{ id: number; is_test: number }> };
  const productionProjectId = String(rows.results.find((row) => Number(row.is_test) === 0)?.id || '');
  const testProjectId = String(rows.results.find((row) => Number(row.is_test) === 1)?.id || '');
  return {
    productionProjectId,
    testProjectId,
    releaseProjectId: productionProjectId || project.id,
  };
}

function requireAdmin(project: { role: string }) {
  if (!['owner', 'admin'].includes(project.role)) {
    throw purchasesError('insufficient_role', 'Owner or admin access is required', 403);
  }
}

async function audit(c: any, projectId: string, action: string, resourceType: string, resourceId?: string | null, metadata: Record<string, unknown> = {}) {
  await c.env.DB.prepare(`
    INSERT INTO billing_admin_audit_logs (id, project_id, actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), projectId, String(c.get('userId')), action, resourceType, resourceId || null, JSON.stringify(metadata)).run();
}

async function recordAdminBillingEvent(
  c: any,
  project: { id: string; isTest?: boolean },
  customerId: string,
  eventType: 'promotional_granted' | 'promotional_revoked',
  payload: Record<string, unknown>,
) {
  const eventId = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO billing_events (
      id, project_id, customer_id, provider, environment, external_event_id,
      event_type, status, occurred_at, processed_at, payload
    ) VALUES (?, ?, ?, 'promotional', ?, ?, ?, 'processed', datetime('now'), datetime('now'), ?)
  `).bind(
    eventId,
    project.id,
    customerId,
    project.isTest ? 'sandbox' : 'production',
    eventId,
    eventType,
    JSON.stringify(payload),
  ).run();
}

async function featureFlagsFor(c: any, projectId: string) {
  await c.env.DB.prepare('INSERT OR IGNORE INTO billing_feature_flags (project_id) VALUES (?)').bind(projectId).run();
  return c.env.DB.prepare(`
    SELECT purchases_core, product_catalog, paywalls, growth, web_billing,
      virtual_currencies, scheduled_exports, updated_at
    FROM billing_feature_flags WHERE project_id = ?
  `).bind(projectId).first();
}

async function requireLegacyInventoryIdle(c: any, projectId: string) {
  const active = await c.env.DB.prepare(`
    SELECT id FROM billing_legacy_inventory_runs
    WHERE project_id = ? AND status IN ('queued', 'running') LIMIT 1
  `).bind(projectId).first();
  if (active) throw purchasesError('legacy_inventory_active', 'Wait for the active legacy inventory to finish', 409);
}

function replyError(c: any, error: unknown) {
  const value = error as { status?: number };
  return c.json(errorEnvelope(error, c.req.header('cf-ray') || crypto.randomUUID()), value?.status || 422);
}

function identifier(value: unknown, field = 'identifier') {
  const result = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{1,80}$/.test(result)) {
    throw purchasesError('invalid_identifier', `${field} must use lowercase letters, numbers, dots, underscores or hyphens`);
  }
  return result;
}

function parseLimit(value: unknown) {
  return Math.max(1, Math.min(250, Number(value || 50)));
}

function certificationText(value: unknown, field: string, max = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max) throw purchasesError(`${field}_invalid`, `${field} is required and must contain at most ${max} characters`);
  return text;
}

function optionalCertificationText(value: unknown, max = 500) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseCursor(value: unknown): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const decoded = atob(String(value));
    const separator = decoded.lastIndexOf('|');
    if (separator < 1) return null;
    return { createdAt: decoded.slice(0, separator), id: decoded.slice(separator + 1) };
  } catch {
    throw purchasesError('invalid_cursor', 'Cursor is invalid');
  }
}

function nextCursor(rows: Array<Record<string, any>>, limit: number) {
  if (rows.length < limit) return null;
  const row = rows[rows.length - 1];
  return btoa(`${row.created_at}|${row.id}`);
}

function connectionCapabilities(provider: string, configured: boolean) {
  const base = {
    catalog: { status: configured ? 'available' : 'not_configured' },
    transactions: { status: configured ? 'available' : 'not_configured' },
    notifications: { status: configured ? 'needs_test' : 'not_configured' },
    refunds: { status: ['google', 'stripe'].includes(provider) && configured ? 'available' : 'unsupported' },
    subscription_management: { status: configured ? 'available' : 'not_configured' },
  };
  if (provider === 'apple') base.refunds = { status: configured ? 'request_only' : 'not_configured' };
  return base;
}

async function nativeConnections(c: any, project: any) {
  const [apple, google] = await Promise.all([
    c.env.DB.prepare(`
      SELECT isak.key_id, isak.issuer_id, isak.filename, ic.app_apple_id, ic.bundle_id
      FROM applications a JOIN ios_configurations ic ON ic.application_id = a.id
      LEFT JOIN ios_server_api_keys isak ON isak.ios_configuration_id = ic.id OR isak.instance_id = a.instance_id
      WHERE a.instance_id = ? AND a.platform = 'ios' LIMIT 1
    `).bind(project.instanceId).first() as Promise<Record<string, unknown> | null>,
    c.env.DB.prepare(`
      SELECT asak.client_email, asak.project_id, asak.name, ac.identifier
      FROM applications a JOIN android_configurations ac ON ac.application_id = a.id
      LEFT JOIN android_server_api_keys asak ON asak.android_configuration_id = ac.id OR asak.instance_id = a.instance_id
      WHERE a.instance_id = ? AND a.platform = 'android' LIMIT 1
    `).bind(project.instanceId).first() as Promise<Record<string, unknown> | null>,
  ]);
  const appleConfigured = Boolean(apple?.key_id && apple?.issuer_id && apple?.app_apple_id);
  const googleConfigured = Boolean(google?.client_email && google?.project_id);
  return [
    {
      id: 'native-apple', provider: 'apple', environment: project.isTest ? 'sandbox' : 'production',
      display_name: 'Apple App Store', status: appleConfigured ? 'configured' : 'not_configured',
      capabilities: connectionCapabilities('apple', appleConfigured),
      public_configuration: { key_id: apple?.key_id, issuer_id: apple?.issuer_id, app_apple_id: apple?.app_apple_id, bundle_id: apple?.bundle_id, filename: apple?.filename },
    },
    {
      id: 'native-google', provider: 'google', environment: project.isTest ? 'sandbox' : 'production',
      display_name: 'Google Play', status: googleConfigured ? 'configured' : 'not_configured',
      capabilities: connectionCapabilities('google', googleConfigured),
      public_configuration: { client_email: google?.client_email, project_id: google?.project_id, package_name: google?.identifier, filename: google?.name },
    },
  ];
}

admin.get('/:projectId/health', async (c) => {
  try {
    const project = await projectFor(c);
    const [events, subscriptions, deliveries, connections, features] = await Promise.all([
      c.env.DB.prepare(`
        SELECT MAX(received_at) AS last_event_at,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_events,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_events
        FROM billing_events WHERE project_id = ?
      `).bind(project.id).first(),
      c.env.DB.prepare(`
        SELECT MAX(provider_last_verified_at) AS last_reconciled_at,
          SUM(CASE WHEN status = 'billing_issue' THEN 1 ELSE 0 END) AS billing_issues,
          SUM(CASE WHEN provider_verification_status = 'failed' THEN 1 ELSE 0 END) AS verification_failures,
          SUM(CASE WHEN customer_id IS NOT NULL
            AND status NOT IN ('expired', 'revoked', 'refunded')
            AND ((provider_last_verified_at IS NULL AND datetime(updated_at) <= datetime('now', '-15 minutes'))
              OR datetime(provider_last_verified_at) <= datetime('now', '-15 minutes'))
            THEN 1 ELSE 0 END) AS stale_verifications
        FROM billing_subscriptions WHERE project_id = ?
      `).bind(project.id).first(),
      c.env.DB.prepare(`
        SELECT SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed_deliveries,
          SUM(CASE WHEN d.status = 'pending' THEN 1 ELSE 0 END) AS pending_deliveries
        FROM billing_webhook_deliveries d
        JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id WHERE e.project_id = ?
      `).bind(project.id).first(),
      c.env.DB.prepare(`SELECT provider, environment, status, last_tested_at, last_synced_at, last_event_at, last_error_code, last_error_message FROM billing_store_connections WHERE project_id = ? AND provider IN ('apple','google','stripe')`)
        .bind(project.id).all(),
      featureFlagsFor(c, project.id),
    ]);
    return c.json({ status: Number((events as any)?.failed_events || 0) + Number((deliveries as any)?.failed_deliveries || 0) + Number((subscriptions as any)?.verification_failures || 0) + Number((subscriptions as any)?.stale_verifications || 0) > 0 ? 'degraded' : 'healthy', events, subscriptions, deliveries, connections: connections.results, features });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/release-gate', async (c) => {
  try {
    const project = await projectFor(c);
    const scope = await releaseGateScope(c, project);
    const scopedProjectIds = [scope.testProjectId, scope.productionProjectId].filter(Boolean);
    const projectPlaceholders = scopedProjectIds.map(() => '?').join(',');
    const staleMinutes = releaseGateStaleMinutes(c.env.BILLING_RELEASE_STALE_MINUTES);
    const catalogStaleHours = releaseGateCatalogStaleHours(c.env.BILLING_CATALOG_STALE_HOURS);
    const [
      checks,
      connections,
      catalog,
      entitlement,
      offering,
      legacyInventory,
      certificationObservations,
      canonicalOperations,
      subscriptionReconciliations,
      providerOperations,
      entitlementDeliveries,
      refundActions,
      refundDeadlines,
      appleNotifications,
      googleNotifications,
      stripeTestNotifications,
      stripeProductionNotifications,
      workerReadiness,
    ] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM billing_release_gate_checks WHERE project_id = ?`).bind(scope.releaseProjectId).all<StoredReleaseGateCheck>(),
      c.env.DB.prepare(`
        SELECT project_id, provider, environment, status, last_tested_at, last_synced_at,
          last_error_code, billing_configuration_encrypted FROM billing_store_connections
        WHERE project_id IN (${projectPlaceholders || "''"}) AND provider IN ('apple', 'google', 'stripe')
      `).bind(...scopedProjectIds).all<Record<string, any>>(),
      c.env.DB.prepare(`
        SELECT p.project_id, p.store, p.environment, p.store_product_id, p.metadata,
          EXISTS (
            SELECT 1 FROM billing_product_entitlements bpe
            JOIN billing_entitlements e ON e.id = bpe.entitlement_id
            WHERE bpe.product_id = p.id AND e.project_id = p.project_id
              AND e.identifier = 'premium' AND e.active = 1
          ) AS premium_mapped,
          (
            SELECT GROUP_CONCAT(DISTINCT bp.package_type) FROM billing_package_products bpp
            JOIN billing_packages bp ON bp.id = bpp.package_id
            JOIN billing_offerings o ON o.id = bp.offering_id
            WHERE bpp.product_id = p.id AND o.project_id = p.project_id
              AND o.identifier = 'default' AND o.active = 1 AND o.is_current = 1
          ) AS package_types
        FROM billing_products p
        WHERE p.project_id IN (${projectPlaceholders || "''"}) AND p.active = 1 AND p.product_type = 'subscription'
      `).bind(...scopedProjectIds).all<ReleaseGateCatalogProduct>(),
      c.env.DB.prepare(`
        SELECT project_id FROM billing_entitlements
        WHERE project_id IN (${projectPlaceholders || "''"}) AND identifier = 'premium' AND active = 1
      `).bind(...scopedProjectIds).all<{ project_id: string }>(),
      c.env.DB.prepare(`
        SELECT project_id FROM billing_offerings
        WHERE project_id IN (${projectPlaceholders || "''"}) AND identifier = 'default' AND active = 1 AND is_current = 1
      `).bind(...scopedProjectIds).all<{ project_id: string }>(),
      c.env.DB.prepare(`
        SELECT id, status, active_subscriptions, matched_subscriptions,
          unresolved_subscriptions, unsupported_subscriptions, completed_at
        FROM billing_legacy_inventory_runs
        WHERE project_id = ? AND environment = 'production'
        ORDER BY created_at DESC LIMIT 1
      `).bind(scope.productionProjectId || scope.releaseProjectId).first<Record<string, unknown>>(),
      c.env.DB.prepare(`
        SELECT o.id, o.run_id, o.check_key, o.outcome, o.evidence_json, o.evidence_sha256, r.status AS run_status
        FROM billing_certification_observations o
        JOIN billing_certification_runs r ON r.id = o.run_id
        JOIN billing_release_gate_checks gc
          ON gc.project_id = r.release_project_id
          AND json_extract(gc.evidence_json, '$.observation_id') = o.id
        WHERE r.release_project_id = ?
      `).bind(scope.releaseProjectId).all<ReleaseGateCertificationObservation>(),
      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'pending' AND datetime(received_at) <= datetime('now', '-' || ? || ' minutes') THEN 1 ELSE 0 END) AS stale_pending
        FROM billing_events
        WHERE project_id IN (${projectPlaceholders || "''"})
      `).bind(staleMinutes, ...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN customer_id IS NOT NULL
            AND status NOT IN ('expired', 'revoked', 'refunded')
            AND provider_verification_status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN customer_id IS NOT NULL
            AND status NOT IN ('expired', 'revoked', 'refunded')
            AND provider_verification_status <> 'failed'
            AND ((provider_last_verified_at IS NULL AND datetime(updated_at) <= datetime('now', '-' || ? || ' minutes'))
              OR datetime(provider_last_verified_at) <= datetime('now', '-' || ? || ' minutes'))
            THEN 1 ELSE 0 END) AS stale
        FROM billing_subscriptions
        WHERE project_id IN (${projectPlaceholders || "''"})
      `).bind(staleMinutes, staleMinutes, ...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'received' AND datetime(received_at) <= datetime('now', '-' || ? || ' minutes') THEN 1 ELSE 0 END) AS stale_received
        FROM billing_webhook_events
        WHERE project_id IN (${projectPlaceholders || "''"})
      `).bind(staleMinutes, ...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN d.status = 'pending' AND datetime(d.created_at) <= datetime('now', '-' || ? || ' minutes') THEN 1 ELSE 0 END) AS stale_pending
        FROM billing_webhook_deliveries d
        JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id
        WHERE e.project_id IN (${projectPlaceholders || "''"})
          AND d.event_type = 'customer.entitlement.changed'
      `).bind(staleMinutes, ...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT
          SUM(CASE WHEN a.status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN a.status IN ('approved', 'queued') AND datetime(a.updated_at) <= datetime('now', '-' || ? || ' minutes') THEN 1 ELSE 0 END) AS stale
        FROM billing_refund_provider_actions a
        JOIN billing_refund_cases rc ON rc.id = a.case_id
        WHERE rc.project_id IN (${projectPlaceholders || "''"})
      `).bind(staleMinutes, ...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT COUNT(*) AS missed
        FROM billing_refund_deadlines d
        JOIN billing_refund_cases rc ON rc.id = d.case_id
        WHERE rc.project_id IN (${projectPlaceholders || "''"}) AND d.status = 'missed'
      `).bind(...scopedProjectIds).first<Record<string, number>>(),
      c.env.DB.prepare(`
        SELECT ready, checked_at, configured_at,
          CASE WHEN datetime(checked_at) >= datetime('now', '-' || ? || ' hours') THEN 1 ELSE 0 END AS fresh
        FROM billing_store_notification_configurations
        WHERE project_id = ? AND provider = 'apple' LIMIT 1
      `).bind(catalogStaleHours, scope.productionProjectId || scope.releaseProjectId)
        .first<{ ready: number; checked_at: string; configured_at: string | null; fresh: number }>(),
      c.env.DB.prepare(`
        SELECT ready, checked_at, configured_at, current_configuration, required_configuration
        FROM billing_store_notification_configurations
        WHERE project_id = ? AND provider = 'google' LIMIT 1
      `).bind(scope.productionProjectId || scope.releaseProjectId)
        .first<{ ready: number; checked_at: string; configured_at: string | null; current_configuration: string; required_configuration: string }>(),
      c.env.DB.prepare(`
        SELECT ready, checked_at, configured_at FROM billing_store_notification_configurations
        WHERE project_id = ? AND provider = 'stripe' LIMIT 1
      `).bind(scope.testProjectId || '').first<{ ready: number; checked_at: string; configured_at: string | null }>(),
      c.env.DB.prepare(`
        SELECT ready, checked_at, configured_at FROM billing_store_notification_configurations
        WHERE project_id = ? AND provider = 'stripe' LIMIT 1
      `).bind(scope.productionProjectId || '').first<{ ready: number; checked_at: string; configured_at: string | null }>(),
      currentBillingWorkerReadiness(c.env),
    ]);
    const verifiedCertificationObservations = await Promise.all((certificationObservations.results || []).map(async (row) => ({
      ...row,
      digest_valid: await sha256Hex(String(row.evidence_json || '')) === row.evidence_sha256,
    })));
    const connectionPassed = (projectId: string, provider: string, environment: string) => (connections.results || []).some((row) =>
      String(row.project_id) === projectId && row.provider === provider && row.environment === environment
      && row.status === 'connected' && row.last_tested_at
      && (provider !== 'stripe' || Boolean(row.billing_configuration_encrypted)));
    const catalogRecentlySynced = (projectId: string, provider: 'apple' | 'google' | 'stripe', environment: 'sandbox' | 'production') =>
      (connections.results || []).some((row) => String(row.project_id) === projectId
        && row.provider === provider
        && row.environment === environment
        && !row.last_error_code
        && catalogSyncFresh(row.last_synced_at, catalogStaleHours));
    const products = catalog.results || [];
    const hasStripePlan = (projectId: string, environment: 'sandbox' | 'production') => {
      const stripeProducts = products.filter((product) => String(product.project_id) === projectId
        && product.store === 'stripe' && product.environment === environment);
      return catalogRecentlySynced(projectId, 'stripe', environment)
        && stripeProducts.length > 0
        && stripeProducts.every((product) => {
          const readiness = releaseGateProviderReadiness(product);
          return readiness.approved && readiness.available && readiness.purchasable;
        });
    };
    const stripeProductsReady = (projectId: string, environment: string, field: 'premium_mapped' | 'offering_mapped') => {
      const stripeProducts = products.filter((product) => String(product.project_id) === projectId
        && product.store === 'stripe' && product.environment === environment);
      return stripeProducts.length > 0 && stripeProducts.every((product) => field === 'premium_mapped'
        ? Number(product.premium_mapped) === 1
        : Boolean(product.package_types));
    };
    const native = (projectId: string, store: 'apple' | 'google', environment: 'sandbox' | 'production') =>
      nativeCatalogCoverage(products, projectId, store, environment);
    const sandboxApple = native(scope.testProjectId, 'apple', 'sandbox');
    const productionApple = native(scope.productionProjectId, 'apple', 'production');
    const sandboxGoogle = native(scope.testProjectId, 'google', 'sandbox');
    const productionGoogle = native(scope.productionProjectId, 'google', 'production');
    const hasEntitlement = (projectId: string) => (entitlement.results || []).some((row) => String(row.project_id) === projectId);
    const hasOffering = (projectId: string) => (offering.results || []).some((row) => String(row.project_id) === projectId);
    const legacyInventoryReady = legacyInventory?.status === 'completed'
      && Number(legacyInventory.unresolved_subscriptions || 0) === 0;
    const legacyInventoryDetail = legacyInventoryReady
      ? `${Number(legacyInventory.matched_subscriptions || 0)} active legacy subscriptions match provider-verified OpenGrow subscriptions.`
      : !legacyInventory
        ? 'Run the verified production legacy subscription inventory.'
        : legacyInventory.status === 'completed'
          ? `Resolve ${Number(legacyInventory.unresolved_subscriptions || 0)} legacy subscriptions before dependency removal.`
          : legacyInventory.status === 'failed'
            ? 'Correct the legacy inventory failure and run it again.'
            : 'Wait for the production legacy subscription inventory to complete.';
    const prerequisite = (key: string, label: string, passed: boolean, success: string, failure: string): ReleaseGatePrerequisite => ({
      key, label, passed, detail: passed ? success : failure,
    });
    const prerequisites: ReleaseGatePrerequisite[] = [
      ...billingOperationalPrerequisites({
        dedicated_execution: c.env.CREDENTIAL_KEY_SCOPE === 'billing' || c.env.BILLING_EXECUTION_MODE === 'service',
        worker_ready: workerReadiness?.ready_for_traffic === true,
        canonical_failed: Number(canonicalOperations?.failed || 0),
        canonical_stale_pending: Number(canonicalOperations?.stale_pending || 0),
        provider_failed: Number(providerOperations?.failed || 0),
        provider_stale_received: Number(providerOperations?.stale_received || 0),
        subscription_reconciliation_failed: Number(subscriptionReconciliations?.failed || 0),
        subscription_reconciliation_stale: Number(subscriptionReconciliations?.stale || 0),
        entitlement_delivery_failed: Number(entitlementDeliveries?.failed || 0),
        entitlement_delivery_stale_pending: Number(entitlementDeliveries?.stale_pending || 0),
        refund_action_failed: Number(refundActions?.failed || 0),
        refund_action_stale: Number(refundActions?.stale || 0),
        missed_refund_deadlines: Number(refundDeadlines?.missed || 0),
      }),
      prerequisite('test_project', 'Test project', Boolean(scope.testProjectId), 'A dedicated test project is available.', 'Create the paired test project.'),
      prerequisite('production_project', 'Production project', Boolean(scope.productionProjectId), 'A dedicated production project is available.', 'Create the paired production project.'),
      ...(['apple', 'google', 'stripe'] as const).flatMap((provider) => [
        prerequisite(`sandbox_${provider}_connection`, `Sandbox ${providerDisplayName(provider)} connection`, connectionPassed(scope.testProjectId, provider, 'sandbox'), 'Credentials were tested successfully.', `Test the sandbox ${providerDisplayName(provider)} connection successfully.`),
        prerequisite(`production_${provider}_connection`, `Production ${providerDisplayName(provider)} connection`, connectionPassed(scope.productionProjectId, provider, 'production'), 'Credentials were tested successfully.', `Test the production ${providerDisplayName(provider)} connection successfully.`),
      ]),
      prerequisite(
        'apple_server_notifications_v2',
        'App Store Server Notifications V2',
        Number(appleNotifications?.ready || 0) === 1 && Number(appleNotifications?.fresh || 0) === 1,
        'Production and sandbox V2 notifications point directly to the verified Billing ingress.',
        !appleNotifications
          ? 'Verify and configure the production and sandbox App Store Server Notification URLs.'
          : Number(appleNotifications.ready || 0) !== 1
            ? 'Replace the current App Store Server Notification URLs with the required direct Billing ingress URLs.'
            : `Recheck the App Store Server Notification URLs; the last verification is older than ${catalogStaleHours} hours.`,
      ),
      prerequisite(
        'google_pubsub_oidc',
        'Google Pub/Sub authenticated push',
        Number(googleNotifications?.ready || 0) === 1,
        'A Google Play RTDN push was verified with the expected Pub/Sub OIDC identity and audience.',
        'Configure authenticated Pub/Sub push and deliver a verified Google Play RTDN event. URL tokens alone cannot pass this gate.',
      ),
      prerequisite(
        'sandbox_stripe_webhook',
        'Stripe test webhook',
        Number(stripeTestNotifications?.ready || 0) === 1,
        'The Stripe test webhook URL, event set, environment, and signature path are verified.',
        'Provision the managed Stripe test webhook or deliver a valid signed test event to the project connection.',
      ),
      prerequisite(
        'production_stripe_webhook',
        'Stripe live webhook',
        Number(stripeProductionNotifications?.ready || 0) === 1,
        'The Stripe live webhook URL, event set, environment, and signature path are verified.',
        'Provision and verify the managed Stripe live webhook for the production connection.',
      ),
      prerequisite('sandbox_apple_catalog', 'Sandbox Apple subscription catalog', sandboxApple.catalog, 'Weekly and yearly subscriptions are imported.', 'Import the weekly and yearly Apple subscriptions into the test project.'),
      prerequisite('production_apple_catalog', 'Production Apple subscription catalog', productionApple.catalog, 'Weekly and yearly subscriptions are imported.', 'Import the weekly and yearly Apple subscriptions into the production project.'),
      prerequisite('production_apple_catalog_fresh', 'Production Apple catalog freshness', catalogRecentlySynced(scope.productionProjectId, 'apple', 'production'), `The Apple catalog was synchronized within the past ${catalogStaleHours} hours.`, `Synchronize the production Apple catalog. Its approval and availability evidence must be less than ${catalogStaleHours} hours old.`),
      prerequisite('production_apple_products_approved', 'Production Apple product approval', productionApple.approved, 'Weekly and yearly subscriptions are approved by Apple.', 'Submit the weekly and yearly subscriptions to Apple and wait until both are approved.'),
      prerequisite('production_apple_products_purchasable', 'Production Apple territory availability', productionApple.available, 'Weekly and yearly subscriptions are available in at least one App Store territory.', 'Make the weekly and yearly subscriptions available in at least one App Store territory, then synchronize the catalog again.'),
      prerequisite('sandbox_google_catalog', 'Sandbox Google subscription catalog', sandboxGoogle.catalog, 'Weekly and yearly subscriptions are imported.', 'Import the weekly and yearly Google subscriptions into the test project.'),
      prerequisite('production_google_catalog', 'Production Google subscription catalog', productionGoogle.catalog, 'Weekly and yearly subscriptions are imported.', 'Import the weekly and yearly Google subscriptions into the production project.'),
      prerequisite('production_google_catalog_fresh', 'Production Google catalog freshness', catalogRecentlySynced(scope.productionProjectId, 'google', 'production'), `The Google catalog was synchronized within the past ${catalogStaleHours} hours.`, `Synchronize the production Google catalog. Its activation and availability evidence must be less than ${catalogStaleHours} hours old.`),
      prerequisite('production_google_products_active', 'Production Google base plan activation', productionGoogle.approved, 'Weekly and yearly subscriptions have active base plans.', 'Activate a base plan for the weekly and yearly Google subscriptions, then synchronize the catalog again.'),
      prerequisite('production_google_products_purchasable', 'Production Google regional availability', productionGoogle.available, 'Weekly and yearly subscriptions are available to new subscribers in at least one region.', 'Enable new subscriber availability for the weekly and yearly Google subscriptions in at least one region, then synchronize the catalog again.'),
      prerequisite('sandbox_stripe_catalog', 'Stripe test subscription catalog', hasStripePlan(scope.testProjectId, 'sandbox'), 'Every active Stripe test subscription is provider-verified and the catalog is current.', 'Import active Stripe test Prices from a tested connection and keep the catalog current.'),
      prerequisite('production_stripe_catalog', 'Stripe production subscription catalog', hasStripePlan(scope.productionProjectId, 'production'), 'Every active Stripe production subscription is provider-verified and the catalog is current.', 'Import active Stripe live Prices from a tested connection and keep the catalog current.'),
      prerequisite('sandbox_premium_entitlement', 'Test Premium entitlement', hasEntitlement(scope.testProjectId), 'The Premium entitlement is active.', 'Create and activate the Premium entitlement in the test project.'),
      prerequisite('production_premium_entitlement', 'Production Premium entitlement', hasEntitlement(scope.productionProjectId), 'The Premium entitlement is active.', 'Create and activate the Premium entitlement in the production project.'),
      prerequisite('sandbox_native_entitlement_mappings', 'Test native Premium mappings', sandboxApple.premium && sandboxGoogle.premium, 'Every required native subscription grants Premium.', 'Map the test weekly and yearly Apple and Google subscriptions to Premium.'),
      prerequisite('production_native_entitlement_mappings', 'Production native Premium mappings', productionApple.premium && productionGoogle.premium, 'Every required native subscription grants Premium.', 'Map the production weekly and yearly Apple and Google subscriptions to Premium.'),
      prerequisite('sandbox_stripe_entitlement_mappings', 'Stripe test Premium mappings', stripeProductsReady(scope.testProjectId, 'sandbox', 'premium_mapped'), 'Every Stripe test subscription grants Premium.', 'Map every Stripe test subscription to Premium.'),
      prerequisite('production_stripe_entitlement_mappings', 'Stripe production Premium mappings', stripeProductsReady(scope.productionProjectId, 'production', 'premium_mapped'), 'Every Stripe production subscription grants Premium.', 'Map every Stripe production subscription to Premium.'),
      prerequisite('sandbox_default_offering', 'Test default offering', hasOffering(scope.testProjectId), 'The current default offering is active.', 'Create and activate the current default offering in the test project.'),
      prerequisite('production_default_offering', 'Production default offering', hasOffering(scope.productionProjectId), 'The current default offering is active.', 'Create and activate the current default offering in the production project.'),
      prerequisite('sandbox_native_packages', 'Test native packages', sandboxApple.packages && sandboxGoogle.packages, 'Weekly and yearly native subscriptions are exposed by the default offering.', 'Add the test weekly and yearly Apple and Google subscriptions to matching packages in the default offering.'),
      prerequisite('production_native_packages', 'Production native packages', productionApple.packages && productionGoogle.packages, 'Weekly and yearly native subscriptions are exposed by the default offering.', 'Add the production weekly and yearly Apple and Google subscriptions to matching packages in the default offering.'),
      prerequisite('sandbox_stripe_packages', 'Stripe test packages', stripeProductsReady(scope.testProjectId, 'sandbox', 'offering_mapped'), 'Every Stripe test subscription is exposed by the default offering.', 'Add every Stripe test subscription to a package in the default offering.'),
      prerequisite('production_stripe_packages', 'Stripe production packages', stripeProductsReady(scope.productionProjectId, 'production', 'offering_mapped'), 'Every Stripe production subscription is exposed by the default offering.', 'Add every Stripe production subscription to a package in the default offering.'),
      prerequisite('production_legacy_inventory', 'Production legacy subscription inventory', legacyInventoryReady, legacyInventoryDetail, legacyInventoryDetail),
    ];
    return c.json({
      data: {
        environments: ['sandbox', 'production'],
        scope,
        operational_policy: { stale_after_minutes: staleMinutes, catalog_stale_after_hours: catalogStaleHours, billing_worker: workerReadiness },
        ...buildReleaseGate(checks.results || [], prerequisites, verifiedCertificationObservations),
      },
    });
  } catch (error) { return replyError(c, error); }
});

export type CertificationRunRow = {
  id: string;
  release_project_id: string;
  target_project_id: string;
  environment: 'sandbox' | 'production';
  platform: 'ios' | 'android' | 'web' | 'cross_platform';
  build_number: string;
  app_version: string | null;
  sdk_version: string | null;
  device_model: string | null;
  os_version: string | null;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
};

admin.get('/:projectId/certification-runs', async (c) => {
  try {
    const project = await projectFor(c);
    const scope = await releaseGateScope(c, project);
    const [runs, observations] = await Promise.all([
      c.env.DB.prepare(`
        SELECT r.*,
          (SELECT COUNT(*) FROM billing_certification_observations o WHERE o.run_id = r.id) AS observation_count,
          (SELECT COUNT(*) FROM billing_certification_observations o WHERE o.run_id = r.id AND o.outcome = 'passed') AS passed_count,
          (SELECT COUNT(*) FROM billing_certification_observations o WHERE o.run_id = r.id AND o.outcome = 'failed') AS failed_count,
          (SELECT COUNT(*) FROM billing_certification_device_results d WHERE d.run_id = r.id) AS device_result_count
        FROM billing_certification_runs r
        WHERE r.release_project_id = ? ORDER BY r.started_at DESC LIMIT 50
      `).bind(scope.releaseProjectId).all<Record<string, unknown>>(),
      c.env.DB.prepare(`
        SELECT o.* FROM billing_certification_observations o
        JOIN billing_certification_runs r ON r.id = o.run_id
        WHERE r.release_project_id = ? ORDER BY o.observed_at DESC LIMIT 500
      `).bind(scope.releaseProjectId).all<Record<string, unknown>>(),
    ]);
    return c.json({ data: { runs: runs.results, observations: observations.results } });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/certification-runs', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const scope = await releaseGateScope(c, project);
    const data = await jsonBody(c);
    const platform = String(data.platform || '');
    const environment = String(data.environment || '');
    if (!['ios', 'android', 'web', 'cross_platform'].includes(platform)) {
      throw purchasesError('certification_platform_invalid', 'Platform must be iOS, Android, Web, or cross-platform');
    }
    if (!['sandbox', 'production'].includes(environment)) {
      throw purchasesError('certification_environment_invalid', 'Environment must be sandbox or production');
    }
    const targetProjectId = environment === 'sandbox' ? scope.testProjectId : scope.productionProjectId;
    if (!targetProjectId) throw purchasesError('certification_target_project_missing', `The ${environment} project is not configured`, 409);
    const buildNumber = certificationText(data.build_number, 'build_number', 100);
    const deviceModel = optionalCertificationText(data.device_model, 200);
    const osVersion = optionalCertificationText(data.os_version, 100);
    if ((platform === 'ios' || platform === 'android') && (!deviceModel || !osVersion)) {
      throw purchasesError('certification_device_required', 'Native certification runs require a device model and OS version');
    }
    const id = crypto.randomUUID();
    const row = await c.env.DB.prepare(`
      INSERT INTO billing_certification_runs (
        id, release_project_id, target_project_id, environment, platform, build_number,
        app_version, sdk_version, device_model, os_version, notes, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *
    `).bind(
      id, scope.releaseProjectId, targetProjectId, environment, platform, buildNumber,
      optionalCertificationText(data.app_version, 100), optionalCertificationText(data.sdk_version, 100),
      deviceModel, osVersion, optionalCertificationText(data.notes, 2000), String(c.get('userId')),
    ).first<Record<string, unknown>>();
    const challenge = await issueCertificationDeviceChallenge(c.env.DB, id);
    await audit(c, scope.releaseProjectId, 'certification_run.created', 'certification_run', id, {
      target_project_id: targetProjectId, environment, platform, build_number: buildNumber,
      device_challenge_expires_at: challenge.expires_at,
    });
    return c.json({ data: {
      ...row,
      device_claim_token: challenge.token,
      device_claim_expires_at: challenge.expires_at,
      device_result_endpoint: `https://${c.env.SDK_DOMAIN}/purchases/v2/certification/device-results`,
    } }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/certification-runs/:runId/device-challenge', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const scope = await releaseGateScope(c, project);
    const runId = c.req.param('runId');
    const run = await c.env.DB.prepare(`
      SELECT id FROM billing_certification_runs
      WHERE id = ? AND release_project_id = ? AND status = 'running' LIMIT 1
    `).bind(runId, scope.releaseProjectId).first<{ id: string }>();
    if (!run) throw purchasesError('certification_run_not_running', 'Running certification run not found', 404);
    const challenge = await issueCertificationDeviceChallenge(c.env.DB, runId);
    await audit(c, scope.releaseProjectId, 'certification_run.device_challenge_rotated', 'certification_run', runId, {
      expires_at: challenge.expires_at,
    });
    return c.json({ data: {
      run_id: runId,
      device_claim_token: challenge.token,
      device_claim_expires_at: challenge.expires_at,
      device_result_endpoint: `https://${c.env.SDK_DOMAIN}/purchases/v2/certification/device-results`,
    } });
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/certification-runs/:runId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const scope = await releaseGateScope(c, project);
    const data = await jsonBody(c);
    const status = String(data.status || '');
    if (!['completed', 'failed', 'cancelled'].includes(status)) {
      throw purchasesError('certification_run_status_invalid', 'A running certification can be completed, failed, or cancelled');
    }
    if (status === 'completed') {
      const observation = await c.env.DB.prepare(`
        SELECT o.id, o.evidence_json, o.evidence_sha256 FROM billing_certification_observations o
        JOIN billing_certification_runs r ON r.id = o.run_id
        WHERE r.id = ? AND r.release_project_id = ? LIMIT 1
      `).bind(c.req.param('runId'), scope.releaseProjectId).first<{ id: string }>();
      if (!observation) throw purchasesError('certification_observation_required', 'Record at least one result before completing the certification run', 409);
    }
    const row = await c.env.DB.prepare(`
      UPDATE billing_certification_runs
      SET status = ?, completed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND release_project_id = ? AND status = 'running' RETURNING *
    `).bind(status, c.req.param('runId'), scope.releaseProjectId).first<Record<string, unknown>>();
    if (!row) throw purchasesError('certification_run_not_running', 'Running certification run not found', 404);
    await audit(c, scope.releaseProjectId, `certification_run.${status}`, 'certification_run', c.req.param('runId'));
    return c.json({ data: row });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/certification-runs/:runId/observations', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const scope = await releaseGateScope(c, project);
    const data = await jsonBody(c);
    const run = await c.env.DB.prepare(`
      SELECT * FROM billing_certification_runs
      WHERE id = ? AND release_project_id = ? LIMIT 1
    `).bind(c.req.param('runId'), scope.releaseProjectId).first<CertificationRunRow>();
    if (!run) throw purchasesError('certification_run_not_found', 'Certification run not found', 404);
    if (run.status !== 'running') throw purchasesError('certification_run_closed', 'Certification results can be added only while the run is active', 409);
    const checkKey = certificationText(data.check_key, 'check_key', 120);
    const definition = RELEASE_GATE_CHECKS.find((item) => item.key === checkKey);
    if (!definition) throw purchasesError('release_gate_check_not_found', 'Release gate check not found', 404);
    const compatibility = certificationRunCompatibility(definition, run.platform, run.environment);
    if (!compatibility.valid) {
      throw purchasesError(
        'certification_run_incompatible',
        `This check requires a ${compatibility.expected_platform} ${compatibility.expected_environment} run`,
        409,
      );
    }
    const outcome = String(data.outcome || '');
    if (!['passed', 'failed'].includes(outcome)) throw purchasesError('certification_outcome_invalid', 'Outcome must be passed or failed');
    const referenceType = String(data.reference_type || '') as CertificationReferenceType;
    if (!definition.reference_types.includes(referenceType)) {
      throw purchasesError('certification_reference_type_invalid', 'The selected reference type is not valid for this check');
    }
    const referenceId = certificationText(data.reference_id, 'reference_id', 500);
    const reference = await certificationReferenceSnapshot(
      c.env.DB,
      run,
      definition.provider,
      referenceType,
      referenceId,
      checkKey,
      outcome as 'passed' | 'failed',
    );
    const observationId = crypto.randomUUID();
    const observedAt = new Date().toISOString();
    const evidenceSnapshot = {
      schema_version: 1,
      observation_id: observationId,
      check_key: checkKey,
      outcome,
      observed_at: observedAt,
      run: {
        id: run.id, target_project_id: run.target_project_id, environment: run.environment,
        platform: run.platform, build_number: run.build_number, app_version: run.app_version,
        sdk_version: run.sdk_version, device_model: run.device_model, os_version: run.os_version,
        started_at: run.started_at,
      },
      reference: { type: referenceType, id: referenceId, verified_record: reference },
    };
    const encodedSnapshot = JSON.stringify(evidenceSnapshot);
    const digest = await sha256Hex(encodedSnapshot);
    const notes = optionalCertificationText(data.notes, 2000);
    const device = [run.device_model, run.os_version].filter(Boolean).join(' / ') || run.platform;
    const gateEvidence = {
      build: run.build_number,
      device,
      reference: `${referenceType}:${referenceId}`,
      observation_id: observationId,
      run_id: run.id,
      evidence_sha256: digest,
    };
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_certification_observations (
          id, run_id, check_key, outcome, reference_type, reference_id,
          evidence_json, evidence_sha256, notes, created_by, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        observationId, run.id, checkKey, outcome, referenceType, referenceId,
        encodedSnapshot, digest, notes, String(c.get('userId')), observedAt,
      ),
      c.env.DB.prepare(`
        INSERT INTO billing_release_gate_checks (
          project_id, check_key, status, evidence_json, notes, verified_by, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'passed' THEN datetime('now') END)
        ON CONFLICT(project_id, check_key) DO UPDATE SET
          status = excluded.status, evidence_json = excluded.evidence_json, notes = excluded.notes,
          verified_by = excluded.verified_by,
          verified_at = CASE WHEN excluded.status = 'passed' THEN datetime('now') ELSE NULL END,
          updated_at = datetime('now')
      `).bind(
        scope.releaseProjectId, checkKey, outcome, JSON.stringify(gateEvidence), notes,
        String(c.get('userId')), outcome,
      ),
    ]);
    await audit(c, scope.releaseProjectId, 'certification_observation.created', 'certification_observation', observationId, {
      run_id: run.id, check_key: checkKey, outcome, reference_type: referenceType,
      evidence_sha256: digest,
    });
    return c.json({ data: { id: observationId, run_id: run.id, check_key: checkKey, outcome, evidence_sha256: digest } }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/release-gate/checks/:checkKey', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const scope = await releaseGateScope(c, project);
    const checkKey = c.req.param('checkKey');
    const definition = RELEASE_GATE_CHECKS.find((item) => item.key === checkKey);
    if (!definition) throw purchasesError('release_gate_check_not_found', 'Release gate check not found', 404);
    const data = await jsonBody(c);
    const status = String(data.status || '');
    if (!['pending', 'passed', 'failed'].includes(status)) throw purchasesError('release_gate_status_invalid', 'Status must be pending, passed, or failed');
    const evidence = data.evidence && typeof data.evidence === 'object' && !Array.isArray(data.evidence) ? data.evidence as Record<string, unknown> : {};
    const encodedEvidence = JSON.stringify(evidence);
    if (encodedEvidence.length > 16_384) throw purchasesError('release_gate_evidence_too_large', 'Evidence is limited to 16 KB', 413);
    const evidenceValidation = validateReleaseGateEvidence(definition, evidence);
    if (status === 'passed' && !evidenceValidation.valid) {
      throw purchasesError('release_gate_evidence_required', `Passing this check requires: ${evidenceValidation.missing.join(', ')}`);
    }
    if (status === 'passed') {
      const observationId = String(evidence.observation_id || '');
      const runId = String(evidence.run_id || '');
      const evidenceSha256 = String(evidence.evidence_sha256 || '');
      const observation = await c.env.DB.prepare(`
        SELECT o.id, o.evidence_json, o.evidence_sha256 FROM billing_certification_observations o
        JOIN billing_certification_runs r ON r.id = o.run_id
        WHERE o.id = ? AND o.check_key = ? AND o.outcome = 'passed'
          AND o.evidence_sha256 = ? AND r.id = ?
          AND r.release_project_id = ? AND r.status = 'completed'
        LIMIT 1
      `).bind(observationId, checkKey, evidenceSha256, runId, scope.releaseProjectId)
        .first<{ id: string; evidence_json: string; evidence_sha256: string }>();
      if (!observation || await sha256Hex(observation.evidence_json) !== observation.evidence_sha256) {
        throw purchasesError('release_gate_certification_observation_required', 'A completed immutable certification observation is required', 409);
      }
    }
    const notes = data.notes == null ? null : String(data.notes).trim().slice(0, 2000) || null;
    await c.env.DB.prepare(`
      INSERT INTO billing_release_gate_checks (project_id, check_key, status, evidence_json, notes, verified_by, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, CASE WHEN ? = 'passed' THEN datetime('now') END)
      ON CONFLICT(project_id, check_key) DO UPDATE SET status = excluded.status,
        evidence_json = excluded.evidence_json, notes = excluded.notes, verified_by = excluded.verified_by,
        verified_at = CASE WHEN excluded.status = 'passed' THEN datetime('now') ELSE NULL END,
        updated_at = datetime('now')
    `).bind(scope.releaseProjectId, checkKey, status, encodedEvidence, notes, String(c.get('userId')), status).run();
    await audit(c, scope.releaseProjectId, 'release_gate_check.updated', 'release_gate_check', checkKey, { status, evidence_fields: Object.keys(evidence) });
    return c.json({ data: { check_key: checkKey, status } });
  } catch (error) { return replyError(c, error); }
});

function providerDisplayName(provider: 'apple' | 'google' | 'stripe') {
  return provider === 'apple' ? 'Apple App Store' : provider === 'google' ? 'Google Play' : 'Stripe';
}

export async function certificationReferenceSnapshot(
  db: D1Database,
  run: CertificationRunRow,
  provider: 'apple' | 'google' | 'stripe' | 'cross_platform',
  referenceType: CertificationReferenceType,
  referenceId: string,
  checkKey = '',
  expectedOutcome: 'passed' | 'failed' = 'passed',
) {
  if (referenceType === 'test_run') {
    const row = await db.prepare(`
      SELECT id, run_id, target_project_id, customer_id, check_key, outcome,
        source_platform, application_identifier, build_number, app_version,
        sdk_version, device_model, os_version, evidence_json, evidence_sha256,
        observed_at, received_at
      FROM billing_certification_device_results
      WHERE id = ? AND run_id = ? AND target_project_id = ? AND check_key = ? LIMIT 1
    `).bind(referenceId, run.id, run.target_project_id, checkKey).first<Record<string, unknown>>();
    if (!row) {
      throw purchasesError(
        'certification_device_result_not_found',
        'An authenticated SDK device result from this certification run is required',
        409,
      );
    }
    if (row.outcome !== expectedOutcome) {
      throw purchasesError('certification_device_result_outcome_mismatch', 'Device result outcome does not match the review outcome', 409);
    }
    if (await sha256Hex(String(row.evidence_json || '')) !== row.evidence_sha256) {
      throw purchasesError('certification_device_result_invalid', 'Device result evidence digest is invalid', 409);
    }
    requireReferenceDuringRun(row.observed_at || row.received_at, run.started_at);
    return {
      id: row.id,
      run_id: row.run_id,
      check_key: row.check_key,
      outcome: row.outcome,
      source: 'authenticated_sdk',
      source_platform: row.source_platform,
      application_identifier: row.application_identifier,
      build_number: row.build_number,
      app_version: row.app_version,
      sdk_version: row.sdk_version,
      device_model: row.device_model,
      os_version: row.os_version,
      evidence_sha256: row.evidence_sha256,
      observed_at: row.observed_at,
      received_at: row.received_at,
    };
  }
  if (referenceType === 'billing_transaction') {
    const row = await db.prepare(`
      SELECT t.id, t.store, t.environment, t.status, t.event_type, t.verified_at,
        t.purchased_at, t.event_occurred_at, t.created_at, p.store_product_id, p.metadata,
        (SELECT GROUP_CONCAT(DISTINCT bp.package_type)
          FROM billing_package_products bpp
          JOIN billing_packages bp ON bp.id = bpp.package_id
          WHERE bpp.product_id = t.product_id) AS package_types,
        (SELECT s.period_type FROM billing_subscriptions s
          WHERE s.project_id = t.project_id AND s.store = t.store AND s.environment = t.environment
            AND (s.latest_transaction_id = t.id OR s.original_transaction_id = t.original_transaction_id)
          ORDER BY s.updated_at DESC LIMIT 1) AS period_type
      FROM billing_transactions t
      LEFT JOIN billing_products p ON p.id = t.product_id
      WHERE t.id = ? AND t.project_id = ? LIMIT 1
    `).bind(referenceId, run.target_project_id).first<Record<string, unknown>>();
    if (!row || !row.verified_at) throw purchasesError('certification_transaction_not_verified', 'A provider-verified transaction from this certification project is required', 409);
    if (provider !== 'cross_platform' && row.store !== provider) throw purchasesError('certification_reference_provider_mismatch', 'The transaction provider does not match this check', 409);
    if (row.environment !== run.environment) throw purchasesError('certification_reference_environment_mismatch', 'The transaction environment does not match this run', 409);
    requireReferenceDuringRun(row.event_occurred_at || row.purchased_at || row.created_at, run.started_at);
    validateCertificationScenario(checkKey, referenceType, row);
    return {
      id: row.id, provider: row.store, environment: row.environment, status: row.status,
      event_type: row.event_type, verified_at: row.verified_at,
      occurred_at: row.event_occurred_at || row.purchased_at, store_product_id: row.store_product_id,
      period_type: row.period_type,
    };
  }
  if (referenceType === 'billing_event') {
    const row = await db.prepare(`
      SELECT id, provider, environment, event_type, status, occurred_at, received_at,
        transaction_id, subscription_id
      FROM billing_events WHERE id = ? AND project_id = ? LIMIT 1
    `).bind(referenceId, run.target_project_id).first<Record<string, unknown>>();
    if (!row || row.status !== 'processed') throw purchasesError('certification_event_not_processed', 'A processed immutable Billing event from this certification project is required', 409);
    if (provider !== 'cross_platform' && row.provider !== provider) throw purchasesError('certification_reference_provider_mismatch', 'The Billing event provider does not match this check', 409);
    if (provider === 'cross_platform' && !['apple', 'google', 'stripe'].includes(String(row.provider))) {
      throw purchasesError('certification_reference_provider_mismatch', 'Cross-platform convergence requires an Apple, Google Play, or Stripe event', 409);
    }
    if (row.environment !== run.environment) throw purchasesError('certification_reference_environment_mismatch', 'The Billing event environment does not match this run', 409);
    requireReferenceDuringRun(row.occurred_at || row.received_at, run.started_at);
    validateCertificationScenario(checkKey, referenceType, row);
    return {
      id: row.id, provider: row.provider, environment: row.environment, event_type: row.event_type,
      status: row.status, occurred_at: row.occurred_at, received_at: row.received_at,
      transaction_id: row.transaction_id, subscription_id: row.subscription_id,
    };
  }
  if (referenceType === 'paywall_event') {
    const row = await db.prepare(`
      SELECT id, event_type, platform, app_version, sdk_version, occurred_at,
        package_identifier, placement_identifier
      FROM billing_paywall_events WHERE id = ? AND project_id = ? LIMIT 1
    `).bind(referenceId, run.target_project_id).first<Record<string, unknown>>();
    if (!row) throw purchasesError('certification_paywall_event_not_found', 'A paywall event from this certification project is required', 409);
    if (run.platform !== 'cross_platform' && row.platform !== run.platform) {
      throw purchasesError('certification_reference_platform_mismatch', 'The paywall event platform does not match this run', 409);
    }
    requireReferenceDuringRun(row.occurred_at, run.started_at);
    validateCertificationScenario(checkKey, referenceType, row);
    return row;
  }
  const row = await db.prepare(`
    SELECT id, status, active_subscriptions, matched_subscriptions,
      unresolved_subscriptions, unsupported_subscriptions, completed_at
    FROM billing_legacy_inventory_runs
    WHERE id = ? AND project_id = ? AND environment = 'production' LIMIT 1
  `).bind(referenceId, run.target_project_id).first<Record<string, unknown>>();
  if (!row || row.status !== 'completed' || Number(row.unresolved_subscriptions || 0) !== 0) {
    throw purchasesError('certification_legacy_inventory_incomplete', 'A completed production inventory with no unresolved subscription is required', 409);
  }
  return row;
}

function validateCertificationScenario(
  checkKey: string,
  referenceType: CertificationReferenceType,
  row: Record<string, unknown>,
) {
  if (!checkKey || referenceType === 'test_run' || referenceType === 'legacy_inventory') return;
  const scenario = checkKey.split('.').at(-1) || '';
  const eventType = String(row.event_type || '').toLocaleLowerCase('en');
  const status = String(row.status || '').toLocaleLowerCase('en');
  const matches = (pattern: RegExp) => pattern.test(`${eventType} ${status}`);
  let valid = true;
  if (scenario === 'weekly_purchase' || scenario === 'yearly_purchase') {
    const cadence = scenario === 'weekly_purchase' ? 'weekly' : 'annual';
    valid = releaseGateProductCadences({
      project_id: '', store: '', environment: '', premium_mapped: 0,
      metadata: row.metadata as string | Record<string, unknown> | null,
      package_types: String(row.package_types || ''),
    }).includes(cadence);
  } else if (scenario === 'trial') valid = String(row.period_type || '').toLocaleLowerCase('en') === 'trial' || matches(/trial/);
  else if (scenario === 'renewal') valid = matches(/renew|did_renew|invoice\.paid|payment_succeeded/);
  else if (scenario === 'upgrade_downgrade') valid = matches(/upgrade|downgrade|product.?chang|plan.?chang|change.?renewal.?pref/);
  else if (scenario === 'expiration') valid = matches(/expir/);
  else if (scenario === 'refund') valid = matches(/refund|revoke|void/);
  else if (scenario === 'checkout') valid = matches(/checkout|initial|purchase|invoice\.paid|payment_succeeded|active|trialing/);
  else if (scenario === 'payment_failed') valid = matches(/payment.?fail|invoice.?fail|billing.?issue|past_due/);
  else if (scenario === 'dispute') valid = matches(/dispute|inquiry|chargeback/);
  else if (scenario === 'user_cancelled' && referenceType === 'paywall_event') valid = matches(/purchase_cancelled|closed/);
  else if (scenario === 'pending' && referenceType === 'paywall_event') valid = matches(/purchase_started/);
  else if (scenario === 'restore' && referenceType === 'paywall_event') valid = matches(/restore_succeeded/);
  if (!valid) {
    throw purchasesError('certification_reference_scenario_mismatch', 'The referenced record does not prove this certification scenario', 409);
  }
}

function requireReferenceDuringRun(value: unknown, startedAt: string) {
  const referenceTime = certificationTimestamp(value);
  const runStart = certificationTimestamp(startedAt);
  if (!Number.isFinite(referenceTime) || !Number.isFinite(runStart) || referenceTime < runStart - 600_000) {
    throw purchasesError('certification_reference_outside_run', 'The referenced record must be observed during this certification run', 409);
  }
}

function certificationTimestamp(value: unknown) {
  const input = String(value || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)
    ? `${input.replace(' ', 'T')}Z`
    : input;
  return new Date(normalized).getTime();
}

admin.get('/:projectId/features', async (c) => {
  try {
    const project = await projectFor(c);
    return c.json({ data: await featureFlagsFor(c, project.id) });
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/features', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    await featureFlagsFor(c, project.id);
    const statements = FEATURE_FLAGS
      .filter((flag) => data[flag] !== undefined)
      .map((flag) => c.env.DB.prepare(`UPDATE billing_feature_flags SET ${flag} = ?, updated_by = ?, updated_at = datetime('now') WHERE project_id = ?`)
        .bind(data[flag] ? 1 : 0, String(c.get('userId')), project.id));
    if (!statements.length) throw purchasesError('feature_flags_required', 'At least one known feature flag is required');
    await c.env.DB.batch(statements);
    await audit(c, project.id, 'features.updated', 'billing_feature_flags', project.id, { flags: FEATURE_FLAGS.filter((flag) => data[flag] !== undefined) });
    return c.json({ data: await featureFlagsFor(c, project.id) });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/legacy/revenuecat/connections', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    await requireLegacyInventoryIdle(c, project.id);
    const data = await jsonBody(c);
    const externalProjectId = String(data.external_project_id || '').trim();
    const apiKey = String(data.api_key || '').trim();
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(externalProjectId)) {
      throw purchasesError('legacy_project_id_invalid', 'A valid legacy project ID is required');
    }
    if (!apiKey || apiKey.length > 4096) {
      throw purchasesError('legacy_api_key_invalid', 'A valid legacy V2 secret API key is required');
    }
    const clearCredential = JSON.stringify({ api_key: apiKey });
    const [apiCiphertext, billingResult] = await Promise.all([
      encryptCredential(c.env, clearCredential),
      callBillingServiceBinding<{ data: { ciphertext: string } }>(c.env, '/internal/v1/credentials/encrypt', {
        credential: clearCredential,
      }),
    ]);
    const billingCiphertext = String(billingResult.data?.ciphertext || '');
    if (!billingCiphertext) throw purchasesError('billing_credential_copy_failed', 'Billing credential encryption failed', 503, true);
    const sourceId = crypto.randomUUID();
    const source = await c.env.DB.prepare(`
      INSERT INTO billing_legacy_sources (
        id, project_id, provider, external_project_id,
        configuration_encrypted, billing_configuration_encrypted, status
      ) VALUES (?, ?, 'revenuecat', ?, ?, ?, 'configured')
      ON CONFLICT(project_id, provider) DO UPDATE SET
        external_project_id = excluded.external_project_id,
        configuration_encrypted = excluded.configuration_encrypted,
        billing_configuration_encrypted = excluded.billing_configuration_encrypted,
        status = 'configured', last_error_code = NULL, last_error_message = NULL,
        updated_at = datetime('now')
      RETURNING id
    `).bind(sourceId, project.id, externalProjectId, apiCiphertext, billingCiphertext).first<{ id: string }>();
    const id = String(source?.id || sourceId);
    await audit(c, project.id, 'legacy_source.upserted', 'legacy_source', id, {
      provider: 'revenuecat', external_project_id: externalProjectId, dual_credential_copy: true,
    });
    return c.json({ data: { id, provider: 'revenuecat', status: 'configured', billing_copy_ready: true } }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/legacy/revenuecat/connection-test', async (c) => {
  let sourceId: string | null = null;
  try {
    const project = await projectFor(c); requireAdmin(project);
    const source = await c.env.DB.prepare(`
      SELECT id, project_id, external_project_id, configuration_encrypted, billing_configuration_encrypted
      FROM billing_legacy_sources WHERE project_id = ? AND provider = 'revenuecat'
    `).bind(project.id).first<{
      id: string; project_id: string; external_project_id: string;
      configuration_encrypted: string | null; billing_configuration_encrypted: string | null;
    }>();
    if (!source) throw purchasesError('legacy_source_not_configured', 'Configure the legacy source first', 409);
    sourceId = source.id;
    const result = await testLegacySourceConnection(source, c.env);
    await c.env.DB.prepare(`
      UPDATE billing_legacy_sources SET status = 'connected', last_tested_at = datetime('now'),
        last_error_code = NULL, last_error_message = NULL, updated_at = datetime('now') WHERE id = ?
    `).bind(source.id).run();
    await audit(c, project.id, 'legacy_source.tested', 'legacy_source', source.id, { ok: true });
    return c.json({ data: result });
  } catch (error) {
    if (sourceId) {
      const tagged = error as { code?: string; message?: string };
      await c.env.DB.prepare(`
        UPDATE billing_legacy_sources SET status = 'error', last_tested_at = datetime('now'),
          last_error_code = ?, last_error_message = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(tagged.code || 'legacy_connection_failed', String(tagged.message || error).slice(0, 1000), sourceId).run().catch(() => undefined);
    }
    return replyError(c, error);
  }
});

admin.delete('/:projectId/legacy/revenuecat/connection', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    await requireLegacyInventoryIdle(c, project.id);
    const source = await c.env.DB.prepare(`
      UPDATE billing_legacy_sources
      SET configuration_encrypted = NULL, billing_configuration_encrypted = NULL,
        status = 'disabled', last_error_code = NULL, last_error_message = NULL,
        updated_at = datetime('now')
      WHERE project_id = ? AND provider = 'revenuecat'
      RETURNING id
    `).bind(project.id).first<{ id: string }>();
    if (!source) throw purchasesError('legacy_source_not_configured', 'Legacy source is not configured', 404);
    await audit(c, project.id, 'legacy_source.disabled', 'legacy_source', source.id, { credentials_destroyed: true });
    return c.json({ data: { id: source.id, status: 'disabled', credentials_destroyed: true } });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/legacy/revenuecat/inventory-runs', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    if (!c.env.BILLING_QUEUE) throw purchasesError('billing_queue_unavailable', 'Billing queue is unavailable', 503, true);
    const data = await jsonBody(c);
    const environment = data.environment === 'sandbox' ? 'sandbox' : 'production';
    const source = await c.env.DB.prepare(`
      SELECT id, status FROM billing_legacy_sources
      WHERE project_id = ? AND provider = 'revenuecat'
    `).bind(project.id).first<{ id: string; status: string }>();
    if (!source || source.status !== 'connected') {
      throw purchasesError('legacy_source_not_connected', 'Test the legacy source connection before starting inventory', 409);
    }
    const active = await c.env.DB.prepare(`
      SELECT id, status FROM billing_legacy_inventory_runs
      WHERE project_id = ? AND environment = ? AND status IN ('queued', 'running') LIMIT 1
    `).bind(project.id, environment).first<{ id: string; status: string }>();
    if (active) return c.json({ data: active }, 200);
    const runId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_legacy_inventory_runs
        (id, project_id, source_id, environment, status, requested_by)
      VALUES (?, ?, ?, ?, 'queued', ?)
    `).bind(runId, project.id, source.id, environment, String(c.get('userId'))).run();
    await c.env.BILLING_QUEUE.send({ type: 'billing.legacy.inventory.page', runId });
    await audit(c, project.id, 'legacy_inventory.started', 'legacy_inventory_run', runId, { environment });
    return c.json({ data: { id: runId, status: 'queued', environment } }, 202);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/legacy/revenuecat/inventory', async (c) => {
  try {
    const project = await projectFor(c);
    const [source, runs] = await Promise.all([
      c.env.DB.prepare(`
        SELECT id, provider, external_project_id, status, last_tested_at,
          last_error_code, last_error_message, created_at, updated_at
        FROM billing_legacy_sources WHERE project_id = ? AND provider = 'revenuecat'
      `).bind(project.id).first(),
      c.env.DB.prepare(`
        SELECT id, environment, status, customers_scanned, active_subscriptions,
          matched_subscriptions, unresolved_subscriptions, unsupported_subscriptions,
          last_error_code, last_error_message, started_at, completed_at, created_at, updated_at
        FROM billing_legacy_inventory_runs WHERE project_id = ?
        ORDER BY created_at DESC LIMIT 20
      `).bind(project.id).all<Record<string, unknown>>(),
    ]);
    const latestRunId = String(runs.results?.[0]?.id || '');
    const unresolved = latestRunId ? await c.env.DB.prepare(`
      SELECT external_customer_id, external_subscription_id, app_user_id, provider,
        environment, store_product_id, source_status, source_expires_at,
        resolution_status, resolution_detail
      FROM billing_legacy_subscription_inventory
      WHERE run_id = ? AND resolution_status <> 'matched'
      ORDER BY source_expires_at DESC LIMIT 100
    `).bind(latestRunId).all<Record<string, unknown>>() : { results: [] };
    return c.json({ data: { source: source || null, runs: runs.results || [], unresolved: unresolved.results || [] } });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/connections', async (c) => {
  try {
    const project = await projectFor(c);
    const [stored, native] = await Promise.all([
      c.env.DB.prepare(`
        SELECT id, provider, environment, display_name, status, capabilities, public_configuration,
          last_tested_at, last_synced_at, last_event_at, last_error_code, last_error_message, created_at, updated_at
        FROM billing_store_connections
        WHERE project_id = ? AND provider IN ('apple','google','stripe')
        ORDER BY provider, environment
      `).bind(project.id).all<Record<string, any>>(),
      nativeConnections(c, project),
    ]);
    const rows: Array<Record<string, any>> = (stored.results || []).map((row) => ({ ...row, capabilities: JSON.parse(row.capabilities || '{}'), public_configuration: JSON.parse(row.public_configuration || '{}') }));
    for (const item of native) {
      const existing = rows.find((row) => row.provider === item.provider && row.environment === item.environment);
      if (existing) {
        existing.public_configuration = { ...item.public_configuration, ...existing.public_configuration };
        existing.capabilities = Object.keys(existing.capabilities || {}).length ? existing.capabilities : item.capabilities;
      } else rows.push(item);
    }
    return c.json({ data: rows });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/apple-server-notifications', async (c) => {
  try {
    const project = await projectFor(c);
    const scope = await releaseGateScope(c, project);
    const data = await readAppleNotificationConfiguration(
      c.env,
      scope.productionProjectId,
      scope.testProjectId,
    );
    await persistAppleNotificationConfiguration(c.env.DB, scope.productionProjectId, data);
    return c.json({ data });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/apple-server-notifications/configure', async (c) => {
  try {
    const project = await projectFor(c);
    requireAdmin(project);
    const body = await jsonBody(c);
    if (body.confirmation !== APPLE_NOTIFICATION_CONFIRMATION) {
      throw purchasesError(
        'apple_notification_confirmation_required',
        'Explicit confirmation is required before changing App Store Server Notification URLs',
        409,
      );
    }
    const scope = await releaseGateScope(c, project);
    const before = await readAppleNotificationConfiguration(
      c.env,
      scope.productionProjectId,
      scope.testProjectId,
    );
    await persistAppleNotificationConfiguration(c.env.DB, scope.productionProjectId, before);
    if (before.ready) return c.json({ data: before, changed: false });
    await audit(c, scope.productionProjectId, 'apple_server_notifications.configuration_requested', 'store_connection', 'native-apple', {
      current: before.current,
      required: before.required,
    });
    try {
      const configured = await configureAppleNotificationConfiguration(
        c.env,
        scope.productionProjectId,
        scope.testProjectId,
      );
      await persistAppleNotificationConfiguration(c.env.DB, scope.productionProjectId, configured);
      if (!configured.ready) {
        throw purchasesError(
          'apple_notification_configuration_not_applied',
          'App Store Connect did not apply every required notification setting',
          502,
          true,
        );
      }
      await audit(c, scope.productionProjectId, 'apple_server_notifications.configured', 'store_connection', 'native-apple', {
        previous: before.current,
        configured: configured.current,
      });
      return c.json({ data: configured, changed: true });
    } catch (error) {
      await audit(c, scope.productionProjectId, 'apple_server_notifications.configuration_failed', 'store_connection', 'native-apple', {
        code: String((error as { code?: string }).code || 'apple_notification_configuration_failed'),
      });
      throw error;
    }
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/connections', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const data = await jsonBody(c);
    const provider = String(data.provider || '');
    const environment = String(data.environment || '');
    if (!PROVIDERS.includes(provider as any)) throw purchasesError('unsupported_provider', 'Unsupported billing provider');
    if (!ENVIRONMENTS.includes(environment as any)) throw purchasesError('invalid_environment', 'Environment must be sandbox or production');
    const expectedEnvironment = project.isTest ? 'sandbox' : 'production';
    if (environment !== expectedEnvironment) {
      throw purchasesError('invalid_environment', `This project requires the ${expectedEnvironment} environment`, 422);
    }
    const existing = await c.env.DB.prepare(`
      SELECT id, configuration_encrypted, public_configuration
      FROM billing_store_connections
      WHERE project_id = ? AND provider = ? AND environment = ? LIMIT 1
    `).bind(project.id, provider, environment).first<{
      id: string;
      configuration_encrypted: string | null;
      public_configuration: string | null;
    }>();
    const id = String(existing?.id || crypto.randomUUID());
    let publicConfiguration = objectValue(data.public_configuration);
    let secret: string | null = null;
    let billingSecret: string | null = null;
    let provisioned: { secretKey: string; configuration: StripeWebhookConfiguration } | null = null;
    let replacedManagedEndpoint: { secretKey: string; endpointId: string } | null = null;
    let stripeReadinessMustReset = false;
    if (provider !== 'stripe' && data.secret_configuration !== undefined) {
      throw purchasesError('native_store_credentials_managed_separately', 'Apple App Store and Google Play credentials are managed by their platform configuration', 422);
    }
    if (provider === 'stripe') {
      publicConfiguration = Object.fromEntries(
        Object.entries(publicConfiguration).filter(([key]) => !key.startsWith('webhook_')),
      );
      const supplied = objectValue(data.secret_configuration);
      const stripeEnvironment = environment as 'sandbox' | 'production';
      const secretKey = validateStripeSecretKey(supplied, stripeEnvironment);
      let webhookSecret = String(supplied.webhook_secret || '').trim();
      const existingPublicConfiguration = parseObjectValue(existing?.public_configuration);
      let existingCredentials: ReturnType<typeof validateStripeCredentials> | null = null;
      if (existing?.configuration_encrypted) {
        try {
          existingCredentials = validateStripeCredentials(
            JSON.parse(await decryptCredential(c.env, existing.configuration_encrypted)),
            stripeEnvironment,
          );
        } catch {
          // An unreadable credential is replaced by the newly supplied provider configuration.
        }
      }
      const sameCredentials = existingCredentials?.secret_key === secretKey
        && (!webhookSecret || existingCredentials.webhook_secret === webhookSecret);
      if (sameCredentials && existingCredentials) {
        webhookSecret = existingCredentials.webhook_secret;
        publicConfiguration = { ...existingPublicConfiguration, ...publicConfiguration };
      } else if (webhookSecret) {
        stripeReadinessMustReset = true;
      }
      const existingManagedEndpointId = existingPublicConfiguration.webhook_managed === true
        ? String(existingPublicConfiguration.webhook_endpoint_id || '')
        : '';
      if (!sameCredentials && existingCredentials && existingManagedEndpointId.startsWith('we_')) {
        replacedManagedEndpoint = {
          secretKey: existingCredentials.secret_key,
          endpointId: existingManagedEndpointId,
        };
      }
      if (!webhookSecret) {
        const managed = await provisionStripeWebhookEndpoint({
          secretKey,
          environment: stripeEnvironment,
          url: stripeWebhookUrl(c.env.API_DOMAIN, id),
          connectionId: id,
        });
        webhookSecret = managed.secret;
        provisioned = { secretKey, configuration: managed.configuration };
        publicConfiguration = {
          ...publicConfiguration,
          webhook_managed: true,
          webhook_endpoint_id: managed.configuration.endpoint_id,
          webhook_url: managed.configuration.url,
          webhook_enabled_events: managed.configuration.enabled_events,
        };
      }
      const stripeCredentials = validateStripeCredentials({ secret_key: secretKey, webhook_secret: webhookSecret }, stripeEnvironment);
      const clearCredential = JSON.stringify(stripeCredentials);
      let copies;
      try {
        copies = await encryptStoreCredentialCopies(c.env, clearCredential);
      } catch (error) {
        if (provisioned) await deleteStripeWebhookEndpoint(provisioned.secretKey, provisioned.configuration.endpoint_id);
        throw error;
      }
      secret = copies.sourceCiphertext;
      billingSecret = copies.billingCiphertext;
    }
    let stored: { id: string } | null | undefined;
    try {
      stored = await c.env.DB.prepare(`
        INSERT INTO billing_store_connections (
          id, project_id, provider, environment, display_name, status, capabilities,
          configuration_encrypted, billing_configuration_encrypted, public_configuration
        ) VALUES (?, ?, ?, ?, ?, 'configured', ?, ?, ?, ?)
        ON CONFLICT(project_id, provider, environment) DO UPDATE SET
          display_name = excluded.display_name, status = 'configured', capabilities = excluded.capabilities,
          configuration_encrypted = COALESCE(excluded.configuration_encrypted, billing_store_connections.configuration_encrypted),
          billing_configuration_encrypted = COALESCE(excluded.billing_configuration_encrypted, billing_store_connections.billing_configuration_encrypted),
          public_configuration = excluded.public_configuration, last_error_code = NULL,
          last_error_message = NULL, updated_at = datetime('now')
        RETURNING id
      `).bind(id, project.id, provider, environment, data.display_name || provider, JSON.stringify(connectionCapabilities(provider, true)), secret, billingSecret, JSON.stringify(publicConfiguration)).first<{ id: string }>();
      if (provisioned) await persistStripeWebhookReadiness(c.env.DB, project.id, provisioned.configuration);
      else if (provider === 'stripe' && stripeReadinessMustReset) {
        await invalidateStripeWebhookReadiness(c.env.DB, project.id, 'manual_signing_secret_requires_delivery');
      }
    } catch (error) {
      if (provisioned) await deleteStripeWebhookEndpoint(provisioned.secretKey, provisioned.configuration.endpoint_id);
      throw error;
    }
    const connectionId = String(stored?.id || id);
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_store_credential_audit
          (id, connection_id, project_id, provider, environment, operation, actor_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), connectionId, project.id, provider, environment, secret ? 'dual_copy_upserted' : 'configuration_upserted', String(c.get('userId'))),
      c.env.DB.prepare(`
        INSERT INTO billing_admin_audit_logs (id, project_id, actor_user_id, action, resource_type, resource_id, metadata)
        VALUES (?, ?, ?, 'connection.upserted', 'store_connection', ?, ?)
      `).bind(crypto.randomUUID(), project.id, String(c.get('userId')), connectionId, JSON.stringify({ provider, environment })),
    ]);
    if (replacedManagedEndpoint
      && replacedManagedEndpoint.endpointId !== String(publicConfiguration.webhook_endpoint_id || '')) {
      await deleteStripeWebhookEndpoint(replacedManagedEndpoint.secretKey, replacedManagedEndpoint.endpointId);
    }
    return c.json({
      id: connectionId,
      provider,
      environment,
      configured: true,
      billing_copy_ready: !secret || Boolean(billingSecret),
      webhook_managed: publicConfiguration.webhook_managed === true,
      webhook_url: publicConfiguration.webhook_url || null,
    }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/connections/:provider/test', async (c) => {
  const provider = c.req.param('provider');
  let projectId: string | null = null;
  let environment: string | null = null;
  try {
    const project = await projectFor(c); requireAdmin(project);
    if (!PROVIDERS.includes(provider as any)) throw purchasesError('unsupported_provider', 'Only Apple App Store, Google Play and Stripe are enabled', 422);
    projectId = project.id;
    const data = await jsonBody(c);
    environment = ENVIRONMENTS.includes(data.environment) ? data.environment : project.isTest ? 'sandbox' : 'production';
    let result: Record<string, unknown>;
    if (provider === 'apple' || provider === 'google') {
      result = await testStoreCredentials(c.env, { projectId: project.id, platform: provider === 'apple' ? 'ios' : 'android', environment: environment as 'sandbox' | 'production' });
    } else {
      const connection = await c.env.DB.prepare(`
        SELECT id, configuration_encrypted, billing_configuration_encrypted, public_configuration
        FROM billing_store_connections WHERE project_id = ? AND provider = ? AND environment = ?
      `).bind(project.id, provider, environment).first<{
        id: string; configuration_encrypted: string | null; billing_configuration_encrypted: string | null; public_configuration: string | null;
      }>();
      const encrypted = connection && scopedStoreCredential(connection, c.env);
      if (!encrypted) throw purchasesError('connection_not_configured', `${provider} credentials are not configured`, 422);
      const credentials = JSON.parse(await decryptCredential(c.env, encrypted));
      if (provider === 'stripe') {
        const stripeCredentials = validateStripeCredentials(credentials, environment as 'sandbox' | 'production');
        const response = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${stripeCredentials.secret_key}` },
        });
        const responseText = await readTextLimited(response, 1_048_576, 'Stripe account response is too large');
        let payload: Record<string, any> = {};
        try { payload = JSON.parse(responseText || '{}') as Record<string, any>; } catch { /* handled below */ }
        if (!response.ok) throw purchasesError('stripe_connection_failed', payload?.error?.message || 'Stripe connection failed', 422);
        if (payload.object !== 'account' || !String(payload.id || '').startsWith('acct_')) {
          throw purchasesError('stripe_connection_response_invalid', 'Stripe returned an invalid Account response', 502, true);
        }
        const publicConfiguration = parseObjectValue(connection.public_configuration);
        let webhookConfiguration: StripeWebhookConfiguration | null = null;
        if (publicConfiguration.webhook_endpoint_id) {
          webhookConfiguration = await retrieveStripeWebhookConfiguration({
            secretKey: stripeCredentials.secret_key,
            environment: environment as 'sandbox' | 'production',
            url: stripeWebhookUrl(c.env.API_DOMAIN, connection.id),
            endpointId: String(publicConfiguration.webhook_endpoint_id),
            managed: publicConfiguration.webhook_managed === true,
          });
        } else {
          webhookConfiguration = await discoverStripeWebhookConfiguration({
            secretKey: stripeCredentials.secret_key,
            environment: environment as 'sandbox' | 'production',
            url: stripeWebhookUrl(c.env.API_DOMAIN, connection.id),
          });
        }
        const webhookReadiness = await persistStripeWebhookReadiness(c.env.DB, project.id, webhookConfiguration);
        const updatedPublicConfiguration = {
          ...publicConfiguration,
          webhook_managed: webhookConfiguration.managed,
          webhook_endpoint_id: webhookConfiguration.endpoint_id,
          webhook_url: webhookConfiguration.url,
          webhook_enabled_events: webhookConfiguration.enabled_events,
        };
        await c.env.DB.prepare(`
          UPDATE billing_store_connections SET public_configuration = ?, updated_at = datetime('now')
          WHERE id = ? AND project_id = ?
        `).bind(JSON.stringify(updatedPublicConfiguration), connection.id, project.id).run();
        result = {
          ok: true,
          provider,
          environment,
          account_id: payload.id,
          country: payload.country,
          webhook_managed: webhookConfiguration.managed,
          webhook_ready: webhookReadiness.ready,
        };
      } else {
        throw purchasesError('unsupported_provider', 'Only Apple App Store, Google Play and Stripe are enabled', 422);
      }
    }
    await c.env.DB.prepare(`
      INSERT INTO billing_store_connections (
        id, project_id, provider, environment, display_name, status, capabilities,
        public_configuration, last_tested_at
      ) VALUES (?, ?, ?, ?, ?, 'connected', ?, '{}', datetime('now'))
      ON CONFLICT(project_id, provider, environment) DO UPDATE SET
        status = 'connected', capabilities = excluded.capabilities, last_tested_at = datetime('now'),
        last_error_code = NULL, last_error_message = NULL, updated_at = datetime('now')
    `).bind(crypto.randomUUID(), project.id, provider, environment, provider === 'apple' ? 'Apple App Store' : provider === 'google' ? 'Google Play' : provider, JSON.stringify(connectionCapabilities(provider, true))).run();
    return c.json(result);
  } catch (error) {
    if (projectId && environment) {
      const value = error as { code?: string; message?: string };
      await c.env.DB.prepare(`
        INSERT INTO billing_store_connections (
          id, project_id, provider, environment, display_name, status, capabilities,
          public_configuration, last_tested_at, last_error_code, last_error_message
        ) VALUES (?, ?, ?, ?, ?, 'error', ?, '{}', datetime('now'), ?, ?)
        ON CONFLICT(project_id, provider, environment) DO UPDATE SET
          status = 'error', last_tested_at = datetime('now'), last_error_code = ?,
          last_error_message = ?, updated_at = datetime('now')
      `).bind(
        crypto.randomUUID(), projectId, provider, environment, provider, JSON.stringify(connectionCapabilities(provider, false)),
        value.code || 'connection_test_failed', value.message || 'Connection test failed',
        value.code || 'connection_test_failed', value.message || 'Connection test failed',
      ).run().catch(() => undefined);
    }
    return replyError(c, error);
  }
});

admin.post('/:projectId/provider-products', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const provider = String(data.provider || '');
    if (provider !== 'stripe') throw purchasesError('unsupported_provider', 'Only Stripe products can be added outside Apple App Store and Google Play');
    if (!['subscription', 'non_consumable', 'consumable'].includes(data.product_type)) throw purchasesError('invalid_product_type', 'Invalid product type');
    const environment = project.isTest ? 'sandbox' : 'production';
    if (data.environment && data.environment !== environment) {
      throw purchasesError('invalid_environment', `This project requires the Stripe ${environment === 'sandbox' ? 'test' : 'live'} environment`, 422);
    }
    const requestedPriceId = String(data.provider_price_id || data.store_product_id || '').trim();
    if (!requestedPriceId) throw purchasesError('product_id_required', 'Stripe Price ID is required');
    const connection = await c.env.DB.prepare(`
      SELECT id, environment, status, configuration_encrypted, billing_configuration_encrypted
      FROM billing_store_connections
      WHERE project_id = ? AND provider = 'stripe' AND environment = ? LIMIT 1
    `).bind(project.id, environment).first<Record<string, any>>();
    if (!connection || connection.status !== 'connected') {
      throw purchasesError('stripe_connection_required', `Connect and test Stripe ${environment === 'sandbox' ? 'test' : 'live'} credentials before importing a Price`, 422);
    }
    const encrypted = scopedStoreCredential(connection, c.env);
    if (!encrypted) throw purchasesError('connection_credentials_invalid', 'Stripe credentials are unavailable for this execution domain', 500);
    let stripeCredentials;
    try {
      stripeCredentials = validateStripeCredentials(JSON.parse(await decryptCredential(c.env, encrypted)), environment);
    } catch (error) {
      const tagged = error as { code?: string };
      if (tagged.code) throw error;
      throw purchasesError('connection_credentials_invalid', 'Stripe credentials cannot be decrypted', 500);
    }
    const imported = await retrieveStripeCatalogProduct({
      secretKey: stripeCredentials.secret_key,
      environment,
      priceId: requestedPriceId,
      productType: data.product_type as 'subscription' | 'non_consumable' | 'consumable',
    });
    const proposedProductId = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_products (
        id, project_id, store, environment, store_product_id, product_type,
        display_name, description, active, metadata, updated_at
      ) VALUES (?, ?, 'stripe', ?, ?, ?, ?, ?, 1, ?, datetime('now'))
      ON CONFLICT(project_id, store, environment, store_product_id) DO UPDATE SET
        product_type = excluded.product_type,
        display_name = excluded.display_name,
        description = excluded.description,
        active = 1,
        metadata = excluded.metadata,
        updated_at = datetime('now')
    `).bind(
      proposedProductId, project.id, environment, imported.storeProductId, imported.productType,
      imported.displayName, imported.description, JSON.stringify(imported.productMetadata),
    ).run();
    const storedProduct = await c.env.DB.prepare(`
      SELECT id FROM billing_products
      WHERE project_id = ? AND store = 'stripe' AND environment = ? AND store_product_id = ? LIMIT 1
    `).bind(project.id, environment, imported.storeProductId).first<{ id: string }>();
    if (!storedProduct) throw purchasesError('stripe_product_persistence_failed', 'Verified Stripe Product could not be persisted', 503, true);
    const proposedPriceId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_product_prices (
          id, product_id, provider_price_id, currency, price_micros,
          billing_period, trial_period, active, metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'))
        ON CONFLICT DO UPDATE SET
          price_micros = excluded.price_micros,
          billing_period = excluded.billing_period,
          trial_period = excluded.trial_period,
          active = 1,
          metadata = excluded.metadata,
          updated_at = datetime('now')
      `).bind(
        proposedPriceId, storedProduct.id, imported.providerPriceId, imported.currency,
        imported.priceMicros, imported.billingPeriod, imported.trialPeriod,
        JSON.stringify(imported.priceMetadata),
      ),
      c.env.DB.prepare(`
        UPDATE billing_store_connections
        SET last_synced_at = datetime('now'), last_error_code = NULL, last_error_message = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).bind(connection.id),
    ]);
    const storedPrice = await c.env.DB.prepare(`
      SELECT id FROM billing_product_prices
      WHERE product_id = ? AND provider_price_id = ? AND currency = ? LIMIT 1
    `).bind(storedProduct.id, imported.providerPriceId, imported.currency).first<{ id: string }>();
    if (!storedPrice) throw purchasesError('stripe_product_persistence_failed', 'Verified Stripe Price could not be persisted', 503, true);
    await audit(c, project.id, 'provider_product.imported', 'product', storedProduct.id, {
      provider,
      store_product_id: imported.storeProductId,
      provider_price_id: imported.providerPriceId,
      stripe_product_id: imported.productMetadata.stripe_product_id,
      environment,
    });
    return c.json({ id: storedProduct.id, price_id: storedPrice.id, imported: true }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/transactions', async (c) => {
  try {
    const project = await projectFor(c);
    const limit = parseLimit(c.req.query('limit'));
    const cursor = parseCursor(c.req.query('cursor'));
    const store = c.req.query('store');
    const environment = c.req.query('environment');
    const status = c.req.query('status');
    const rows = await c.env.DB.prepare(`
      SELECT t.*, p.store_product_id, p.display_name AS product_name, cu.primary_app_user_id
      FROM billing_transactions t
      LEFT JOIN billing_products p ON p.id = t.product_id
      LEFT JOIN billing_customers cu ON cu.id = t.customer_id
      WHERE t.project_id = ?
        AND (? IS NULL OR t.store = ?)
        AND (? IS NULL OR t.environment = ?)
        AND (? IS NULL OR t.status = ?)
        AND (? IS NULL OR t.created_at < ? OR (t.created_at = ? AND t.id < ?))
      ORDER BY t.created_at DESC, t.id DESC LIMIT ?
    `).bind(project.id, store || null, store || null, environment || null, environment || null, status || null, status || null,
      cursor?.createdAt || null, cursor?.createdAt || null, cursor?.createdAt || null, cursor?.id || null, limit).all<Record<string, any>>();
    return c.json({ data: rows.results, next_cursor: nextCursor(rows.results || [], limit) });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/provider-events', async (c) => {
  try {
    const project = await projectFor(c);
    const status = String(c.req.query('status') || '');
    if (status && !['received', 'processed', 'failed'].includes(status)) {
      throw purchasesError('provider_event_status_invalid', 'Provider event status is invalid', 422);
    }
    const rows = await c.env.DB.prepare(`
      SELECT id, store, environment, external_event_id, event_type, status, attempts,
        error_message, received_at, processed_at, job_payload IS NOT NULL AS replay_available
      FROM billing_webhook_events
      WHERE project_id = ? AND (? = '' OR status = ?)
      ORDER BY received_at DESC, id DESC
      LIMIT 100
    `).bind(project.id, status, status).all<Record<string, unknown>>();
    return c.json({ data: rows.results || [] });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/provider-events/:eventId/replay', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const event = await c.env.DB.prepare(`
      SELECT id, store, environment, status, job_payload
      FROM billing_webhook_events
      WHERE id = ? AND project_id = ? LIMIT 1
    `).bind(c.req.param('eventId'), project.id).first<Record<string, unknown>>();
    if (!event) throw purchasesError('provider_event_not_found', 'Provider event not found', 404);
    if (event.status === 'processed') {
      throw purchasesError('provider_event_already_processed', 'Processed provider events cannot be replayed', 409);
    }
    if (!c.env.BILLING_QUEUE) throw purchasesError('billing_queue_unavailable', 'Billing queue is unavailable', 503, true);
    const job = providerEventReplayJob({
      eventId: String(event.id),
      projectId: String(project.id),
      store: String(event.store),
      environment: String(event.environment),
      jobPayload: event.job_payload,
    });
    await c.env.DB.prepare(`
      UPDATE billing_webhook_events SET status = 'received', error_message = NULL WHERE id = ?
    `).bind(event.id).run();
    try {
      await c.env.BILLING_QUEUE.send(job);
    } catch {
      await c.env.DB.prepare(`
        UPDATE billing_webhook_events SET status = 'failed', error_message = 'Queue delivery failed' WHERE id = ?
      `).bind(event.id).run();
      throw purchasesError('billing_queue_unavailable', 'Billing queue is unavailable', 503, true);
    }
    await audit(c, project.id, 'provider_event.replayed', 'provider_event', String(event.id), {
      store: event.store,
      job_type: job.type,
    });
    return c.json({ replay_queued: true }, 202);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/subscriptions', async (c) => {
  try {
    const project = await projectFor(c);
    const limit = parseLimit(c.req.query('limit'));
    const status = c.req.query('status');
    const rows = await c.env.DB.prepare(`
      SELECT s.*, p.store_product_id, p.display_name AS product_name, cu.primary_app_user_id
      FROM billing_subscriptions s
      LEFT JOIN billing_products p ON p.id = s.product_id
      LEFT JOIN billing_customers cu ON cu.id = s.customer_id
      WHERE s.project_id = ? AND (? IS NULL OR s.status = ?)
      ORDER BY s.updated_at DESC LIMIT ?
    `).bind(project.id, status || null, status || null, limit).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/customers', async (c) => {
  try {
    const project = await projectFor(c);
    const limit = parseLimit(c.req.query('limit'));
    const cursor = parseCursor(c.req.query('cursor'));
    const query = `%${String(c.req.query('q') || '').slice(0, 100)}%`;
    const rows = await c.env.DB.prepare(`
      SELECT c.*, GROUP_CONCAT(a.app_user_id) AS aliases,
        (SELECT COUNT(*) FROM billing_transactions t WHERE t.customer_id = c.id) AS transaction_count,
        (SELECT COUNT(*) FROM billing_subscriptions s WHERE s.customer_id = c.id AND s.status IN ('active','trialing','grace_period','cancelled')) AS active_subscription_count
      FROM billing_customers c
      LEFT JOIN billing_customer_aliases a ON a.customer_id = c.id
      WHERE c.project_id = ?
        AND (c.primary_app_user_id LIKE ? OR a.app_user_id LIKE ?)
        AND (? IS NULL OR c.last_seen_at < ?)
      GROUP BY c.id
      ORDER BY c.last_seen_at DESC
      LIMIT ?
    `).bind(project.id, query, query, cursor, cursor, limit + 1).all<Record<string, any>>();
    const data = rows.results || [];
    const hasMore = data.length > limit;
    const page = data.slice(0, limit);
    return c.json({ data: page, next_cursor: hasMore ? page[page.length - 1]?.last_seen_at || null : null });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/customers/:customerId', async (c) => {
  try {
    const project = await projectFor(c);
    const customer = await c.env.DB.prepare('SELECT * FROM billing_customers WHERE id = ? AND project_id = ?')
      .bind(c.req.param('customerId'), project.id).first<Record<string, any>>();
    if (!customer) throw purchasesError('customer_not_found', 'Customer not found', 404);
    const [transactions, events, aliases] = await Promise.all([
      c.env.DB.prepare(`SELECT t.*, p.store_product_id FROM billing_transactions t LEFT JOIN billing_products p ON p.id = t.product_id WHERE t.customer_id = ? ORDER BY t.created_at DESC LIMIT 250`).bind(customer.id).all(),
      c.env.DB.prepare(`SELECT * FROM billing_events WHERE customer_id = ? ORDER BY occurred_at DESC LIMIT 250`).bind(customer.id).all(),
      c.env.DB.prepare(`SELECT app_user_id, alias_type, created_at FROM billing_customer_aliases WHERE customer_id = ? ORDER BY created_at`).bind(customer.id).all(),
    ]);
    return c.json({
      customer,
      aliases: aliases.results,
      customer_info: await signedCustomerInfo(c.env, project.id, String(customer.id)),
      transactions: transactions.results,
      events: events.results,
    });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/customers/:customerId/block', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const blocked = data.blocked === false ? 0 : 1;
    const result = await c.env.DB.prepare(`UPDATE billing_customers SET blocked = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
      .bind(blocked, c.req.param('customerId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('customer_not_found', 'Customer not found', 404);
    await audit(c, project.id, blocked ? 'customer.blocked' : 'customer.unblocked', 'customer', c.req.param('customerId'));
    return c.json({ blocked: Boolean(blocked) });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/customers/:customerId/entitlements/:entitlementId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const [customer, entitlement] = await Promise.all([
      c.env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?').bind(c.req.param('customerId'), project.id).first<{ id: string }>(),
      c.env.DB.prepare('SELECT id FROM billing_entitlements WHERE id = ? AND project_id = ?').bind(c.req.param('entitlementId'), project.id).first<{ id: string }>(),
    ]);
    if (!customer || !entitlement) throw purchasesError('customer_or_entitlement_not_found', 'Customer or entitlement not found', 404);
    await c.env.DB.prepare(`
      INSERT INTO billing_customer_entitlements (project_id, customer_id, entitlement_id, source, status, starts_at, expires_at, verification)
      VALUES (?, ?, ?, 'promotional', 'active', datetime('now'), ?, 'admin')
      ON CONFLICT(customer_id, entitlement_id, source) DO UPDATE SET status = 'active', expires_at = excluded.expires_at, updated_at = datetime('now')
    `).bind(project.id, customer.id, entitlement.id, data.expires_at || null).run();
    await recordAdminBillingEvent(c, project, customer.id, 'promotional_granted', { entitlement_id: entitlement.id, expires_at: data.expires_at || null });
    await queueCustomerEntitlementChanged(c.env, {
      projectId: project.id,
      customerId: String(customer.id),
      environment: project.isTest ? 'sandbox' : 'production',
      reason: 'promotional_granted',
    });
    await audit(c, project.id, 'entitlement.granted', 'customer', customer.id, { entitlement_id: entitlement.id });
    return c.json({ granted: true });
  } catch (error) { return replyError(c, error); }
});

admin.delete('/:projectId/customers/:customerId/entitlements/:entitlementId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const result = await c.env.DB.prepare(`
      UPDATE billing_customer_entitlements SET status = 'revoked', updated_at = datetime('now')
      WHERE project_id = ? AND customer_id = ? AND entitlement_id = ? AND source = 'promotional'
    `).bind(project.id, c.req.param('customerId'), c.req.param('entitlementId')).run();
    if (!result.meta.changes) throw purchasesError('promotional_entitlement_not_found', 'Promotional entitlement not found', 404);
    await recordAdminBillingEvent(c, project, c.req.param('customerId'), 'promotional_revoked', { entitlement_id: c.req.param('entitlementId') });
    await queueCustomerEntitlementChanged(c.env, {
      projectId: project.id,
      customerId: c.req.param('customerId'),
      environment: project.isTest ? 'sandbox' : 'production',
      reason: 'promotional_revoked',
    });
    await audit(c, project.id, 'entitlement.revoked', 'customer', c.req.param('customerId'), { entitlement_id: c.req.param('entitlementId') });
    return c.json({ revoked: true });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/customers/:customerId/merge', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const [source, target] = await Promise.all([
      c.env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?').bind(c.req.param('customerId'), project.id).first<{ primary_app_user_id: string }>(),
      c.env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?').bind(String(data.target_customer_id), project.id).first<{ primary_app_user_id: string }>(),
    ]);
    if (!source || !target) throw purchasesError('customer_not_found', 'Source or target customer not found', 404);
    const merged = await identifyCustomer(c.env.DB, project.id, source.primary_app_user_id, target.primary_app_user_id);
    await audit(c, project.id, 'customer.merged', 'customer', String(merged?.id || data.target_customer_id), { source_customer_id: c.req.param('customerId') });
    return c.json({ customer_id: merged?.id });
  } catch (error) { return replyError(c, error); }
});

admin.delete('/:projectId/customers/:customerId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const customerId = c.req.param('customerId');
    const customer = await c.env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?').bind(customerId, project.id).first();
    if (!customer) throw purchasesError('customer_not_found', 'Customer not found', 404);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE billing_transactions SET customer_id = NULL WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('UPDATE billing_subscriptions SET customer_id = NULL WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('UPDATE billing_events SET customer_id = NULL WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('DELETE FROM billing_customer_entitlements WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('DELETE FROM billing_balance_ledger WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('DELETE FROM billing_experiment_assignments WHERE customer_id = ?').bind(customerId),
      c.env.DB.prepare('DELETE FROM billing_customer_aliases WHERE project_id = ? AND customer_id = ?').bind(project.id, customerId),
      c.env.DB.prepare('DELETE FROM billing_customers WHERE id = ? AND project_id = ?').bind(customerId, project.id),
    ]);
    await audit(c, project.id, 'customer.deleted', 'customer', customerId);
    return c.json({ deleted: true });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/events', async (c) => {
  try {
    const project = await projectFor(c);
    const limit = parseLimit(c.req.query('limit'));
    const rows = await c.env.DB.prepare(`SELECT * FROM billing_events WHERE project_id = ? ORDER BY occurred_at DESC LIMIT ?`)
      .bind(project.id, limit).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/analytics', async (c) => {
  try {
    const project = await projectFor(c);
    const days = Math.max(1, Math.min(730, Number(c.req.query('days') || 30)));
    const [summary, series, funnel, stores, subscriptionMetrics] = await Promise.all([
      c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN t.status NOT IN ('refunded','revoked') THEN t.price_micros ELSE 0 END), 0) AS gross_revenue_micros,
          COUNT(DISTINCT CASE WHEN t.status IN ('active','trialing','grace_period','cancelled') THEN t.customer_id END) AS paying_customers,
          SUM(CASE WHEN e.event_type = 'trial_started' THEN 1 ELSE 0 END) AS trials,
          SUM(CASE WHEN e.event_type = 'refunded' THEN 1 ELSE 0 END) AS refunds
        FROM billing_events e LEFT JOIN billing_transactions t ON t.id = e.transaction_id
        WHERE e.project_id = ? AND datetime(e.occurred_at) >= datetime('now', ?)
      `).bind(project.id, `-${days} days`).first(),
      c.env.DB.prepare(`
        SELECT date(occurred_at) AS date,
          SUM(CASE WHEN e.event_type IN ('initial_purchase','renewal','trial_converted') THEN COALESCE(t.price_micros,0) ELSE 0 END) AS revenue_micros,
          SUM(CASE WHEN e.event_type = 'initial_purchase' THEN 1 ELSE 0 END) AS purchases,
          SUM(CASE WHEN e.event_type = 'renewal' THEN 1 ELSE 0 END) AS renewals,
          SUM(CASE WHEN e.event_type = 'refunded' THEN 1 ELSE 0 END) AS refunds
        FROM billing_events e LEFT JOIN billing_transactions t ON t.id = e.transaction_id
        WHERE e.project_id = ? AND datetime(e.occurred_at) >= datetime('now', ?)
        GROUP BY date(occurred_at) ORDER BY date(occurred_at)
      `).bind(project.id, `-${days} days`).all(),
      c.env.DB.prepare(`
        SELECT event_type, COUNT(*) AS count FROM billing_paywall_events
        WHERE project_id = ? AND datetime(occurred_at) >= datetime('now', ?)
        GROUP BY event_type
      `).bind(project.id, `-${days} days`).all(),
      c.env.DB.prepare(`
        SELECT provider AS store, COUNT(*) AS events FROM billing_events
        WHERE project_id = ? AND datetime(occurred_at) >= datetime('now', ?)
        GROUP BY provider ORDER BY events DESC
      `).bind(project.id, `-${days} days`).all(),
      c.env.DB.prepare(`
        SELECT
          COUNT(*) AS subscriptions,
          SUM(CASE WHEN s.status = 'trialing' THEN 1 ELSE 0 END) AS active_trials,
          SUM(CASE WHEN s.status IN ('active','trialing','grace_period','billing_issue','cancelled')
            AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now')) THEN 1 ELSE 0 END) AS active_subscriptions,
          COALESCE(SUM(CASE
            WHEN s.status IN ('active','trialing','grace_period','billing_issue','cancelled')
              AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
            THEN COALESCE(t.price_micros, 0) * CASE
              WHEN pp.billing_period LIKE '%Y%' THEN 1.0 / 12.0
              WHEN pp.billing_period LIKE '%W%' THEN 52.0 / 12.0
              WHEN pp.billing_period LIKE '%D%' THEN 30.0
              ELSE 1.0 END
            ELSE 0 END), 0) AS mrr_micros,
          SUM(CASE WHEN s.status IN ('expired','cancelled') AND datetime(s.updated_at) >= datetime('now', ?) THEN 1 ELSE 0 END) AS churned
        FROM billing_subscriptions s
        LEFT JOIN billing_transactions t ON t.id = s.latest_transaction_id
        LEFT JOIN billing_product_prices pp ON pp.product_id = s.product_id AND pp.active = 1
        WHERE s.project_id = ?
      `).bind(`-${days} days`, project.id).first<Record<string, any>>(),
    ]);
    const gross = Number((summary as any)?.gross_revenue_micros || 0);
    const paying = Number((summary as any)?.paying_customers || 0);
    const subscriptions = Number(subscriptionMetrics?.subscriptions || 0);
    const activeSubscriptions = Number(subscriptionMetrics?.active_subscriptions || 0);
    const refunds = Number((summary as any)?.refunds || 0);
    const transactionCount = (series.results || []).reduce((total: number, row: any) => total + Number(row.purchases || 0) + Number(row.renewals || 0), 0);
    return c.json({
      range_days: days,
      summary: {
        ...(summary || {}),
        ...(subscriptionMetrics || {}),
        arr_micros: Number(subscriptionMetrics?.mrr_micros || 0) * 12,
        arpu_micros: paying > 0 ? Math.round(gross / paying) : 0,
        arppu_micros: paying > 0 ? Math.round(gross / paying) : 0,
        realized_ltv_micros: paying > 0 ? Math.round(gross / paying) : 0,
        churn_rate: subscriptions > 0 ? Number(subscriptionMetrics?.churned || 0) / subscriptions : 0,
        refund_rate: transactionCount > 0 ? refunds / transactionCount : 0,
        active_subscription_rate: subscriptions > 0 ? activeSubscriptions / subscriptions : 0,
      },
      series: series.results,
      paywall_funnel: funnel.results,
      stores: stores.results,
    });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/placements', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT p.*, o.identifier AS default_offering_identifier
      FROM billing_placements p LEFT JOIN billing_offerings o ON o.id = p.default_offering_id
      WHERE p.project_id = ? ORDER BY p.created_at
    `).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/placements', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const data = await jsonBody(c); const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_placements (id, project_id, identifier, display_name, description, default_offering_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, identifier(data.identifier), data.display_name || data.identifier, data.description || null, data.default_offering_id || null).run();
    return c.json({ id }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/placements/:id', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const result = await c.env.DB.prepare(`
      UPDATE billing_placements SET display_name = COALESCE(?, display_name), description = COALESCE(?, description),
        default_offering_id = COALESCE(?, default_offering_id), active = COALESCE(?, active), updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `).bind(data.display_name ?? null, data.description ?? null, data.default_offering_id ?? null, data.active === undefined ? null : data.active ? 1 : 0, c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw purchasesError('placement_not_found', 'Placement not found', 404);
    return c.json({ updated: true });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/paywalls', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT p.*, o.identifier AS offering_identifier, v.version AS active_version, v.published_at
      FROM billing_paywalls p LEFT JOIN billing_offerings o ON o.id = p.offering_id
      LEFT JOIN billing_paywall_versions v ON v.id = p.active_version_id
      WHERE p.project_id = ? ORDER BY p.updated_at DESC
    `).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/paywalls', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const paywallId = crypto.randomUUID(); const versionId = crypto.randomUUID();
    const config = data.configuration || {
      schema_version: 1,
      theme: { accent_color: '#5B5FF0', background_color: '#FFFFFF', text_color: '#111827' },
      components: [
        { type: 'title', text: 'Go Premium' },
        { type: 'subtitle', text: 'Unlock every feature.' },
        { type: 'packages' },
        { type: 'purchase_button', text: 'Continue' },
        { type: 'restore_button', text: 'Restore purchases' },
      ],
    };
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO billing_paywalls (id, project_id, identifier, display_name, offering_id) VALUES (?, ?, ?, ?, ?)`)
        .bind(paywallId, project.id, identifier(data.identifier), data.display_name || data.identifier, data.offering_id || null),
      c.env.DB.prepare(`INSERT INTO billing_paywall_versions (id, paywall_id, version, state, configuration, localizations, created_by) VALUES (?, ?, 1, 'draft', ?, ?, ?)`)
        .bind(versionId, paywallId, JSON.stringify(config), JSON.stringify(data.localizations || {}), String(c.get('userId'))),
    ]);
    await audit(c, project.id, 'paywall.created', 'paywall', paywallId, { draft_version_id: versionId });
    return c.json({ id: paywallId, draft_version_id: versionId, version: 1 }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/paywalls/:id/versions', async (c) => {
  try {
    const project = await projectFor(c);
    const paywall = await c.env.DB.prepare('SELECT id FROM billing_paywalls WHERE id = ? AND project_id = ?').bind(c.req.param('id'), project.id).first();
    if (!paywall) throw purchasesError('paywall_not_found', 'Paywall not found', 404);
    const rows = await c.env.DB.prepare('SELECT * FROM billing_paywall_versions WHERE paywall_id = ? ORDER BY version DESC').bind(c.req.param('id')).all<Record<string, any>>();
    return c.json({ data: (rows.results || []).map((row) => ({ ...row, configuration: JSON.parse(row.configuration), localizations: JSON.parse(row.localizations || '{}') })) });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/paywalls/:id/versions', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const current = await c.env.DB.prepare(`SELECT COALESCE(MAX(v.version), 0) AS version FROM billing_paywall_versions v JOIN billing_paywalls p ON p.id = v.paywall_id WHERE p.id = ? AND p.project_id = ?`)
      .bind(c.req.param('id'), project.id).first<{ version: number }>();
    if (!current) throw purchasesError('paywall_not_found', 'Paywall not found', 404);
    const id = crypto.randomUUID(); const version = Number(current.version || 0) + 1;
    await c.env.DB.prepare(`INSERT INTO billing_paywall_versions (id, paywall_id, version, state, configuration, localizations, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?)`)
      .bind(id, c.req.param('id'), version, JSON.stringify(data.configuration || {}), JSON.stringify(data.localizations || {}), String(c.get('userId'))).run();
    return c.json({ id, version }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/paywalls/:id/publish', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const version = await c.env.DB.prepare(`
      SELECT v.id FROM billing_paywall_versions v JOIN billing_paywalls p ON p.id = v.paywall_id
      WHERE v.id = ? AND p.id = ? AND p.project_id = ?
    `).bind(String(data.version_id), c.req.param('id'), project.id).first<{ id: string }>();
    if (!version) throw purchasesError('paywall_version_not_found', 'Paywall version not found', 404);
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE billing_paywall_versions SET state = CASE WHEN id = ? THEN 'published' ELSE state END, published_at = CASE WHEN id = ? THEN datetime('now') ELSE published_at END WHERE paywall_id = ?`)
        .bind(version.id, version.id, c.req.param('id')),
      c.env.DB.prepare(`UPDATE billing_paywalls SET active_version_id = ?, updated_at = datetime('now') WHERE id = ? AND project_id = ?`)
        .bind(version.id, c.req.param('id'), project.id),
    ]);
    await audit(c, project.id, 'paywall.published', 'paywall', c.req.param('id'), { version_id: version.id });
    return c.json({ published: true, version_id: version.id });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/targeting', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT r.*, p.identifier AS placement_identifier, o.identifier AS offering_identifier
      FROM billing_targeting_rules r JOIN billing_placements p ON p.id = r.placement_id
      JOIN billing_offerings o ON o.id = r.offering_id
      WHERE r.project_id = ? ORDER BY p.identifier, r.priority
    `).bind(project.id).all<Record<string, any>>();
    return c.json({ data: (rows.results || []).map((row) => ({ ...row, conditions: JSON.parse(row.conditions || '[]') })) });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/targeting', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c); const id = crypto.randomUUID();
    if (!['draft', 'live', 'scheduled', 'inactive'].includes(data.state || 'draft')) throw purchasesError('invalid_rule_state', 'Invalid targeting rule state');
    await c.env.DB.prepare(`
      INSERT INTO billing_targeting_rules (id, project_id, placement_id, display_name, priority, state, conditions, offering_id, starts_at, ends_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, data.placement_id, data.display_name || 'Rule', Number(data.priority || 0), data.state || 'draft', JSON.stringify(data.conditions || []), data.offering_id, data.starts_at || null, data.ends_at || null).run();
    return c.json({ id }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/targeting/:id', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const result = await c.env.DB.prepare(`
      UPDATE billing_targeting_rules SET display_name = COALESCE(?, display_name), priority = COALESCE(?, priority),
        state = COALESCE(?, state), conditions = COALESCE(?, conditions), offering_id = COALESCE(?, offering_id),
        starts_at = COALESCE(?, starts_at), ends_at = COALESCE(?, ends_at), updated_at = datetime('now')
      WHERE id = ? AND project_id = ?
    `).bind(data.display_name ?? null, data.priority ?? null, data.state ?? null, data.conditions === undefined ? null : JSON.stringify(data.conditions), data.offering_id ?? null, data.starts_at ?? null, data.ends_at ?? null, c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw purchasesError('targeting_rule_not_found', 'Targeting rule not found', 404);
    return c.json({ updated: true });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/experiments', async (c) => {
  try {
    const project = await projectFor(c);
    const experiments = await c.env.DB.prepare(`SELECT e.*, p.identifier AS placement_identifier FROM billing_experiments e JOIN billing_placements p ON p.id = e.placement_id WHERE e.project_id = ? ORDER BY e.created_at DESC`)
      .bind(project.id).all<Record<string, any>>();
    const data = [];
    for (const experiment of experiments.results || []) {
      const variants = await c.env.DB.prepare(`SELECT v.*, o.identifier AS offering_identifier FROM billing_experiment_variants v JOIN billing_offerings o ON o.id = v.offering_id WHERE v.experiment_id = ? ORDER BY v.created_at`)
        .bind(experiment.id).all();
      const metrics = await c.env.DB.prepare(`
        SELECT pe.variant_id, pe.event_type, COUNT(*) AS count
        FROM billing_paywall_events pe WHERE pe.experiment_id = ? GROUP BY pe.variant_id, pe.event_type
      `).bind(experiment.id).all();
      data.push({ ...experiment, audience_conditions: JSON.parse(experiment.audience_conditions || '[]'), variants: variants.results, metrics: metrics.results });
    }
    return c.json({ data });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/experiments', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const variants = Array.isArray(data.variants) ? data.variants : [];
    if (variants.length < 2) throw purchasesError('experiment_variants_required', 'At least two variants are required');
    const total = variants.reduce((sum: number, item: any) => sum + Number(item.weight || 0), 0);
    if (total !== 10000) throw purchasesError('invalid_variant_weights', 'Variant weights must total 10000 basis points');
    const id = crypto.randomUUID();
    const statements = [c.env.DB.prepare(`
      INSERT INTO billing_experiments (id, project_id, placement_id, display_name, state, audience_conditions, starts_at, ends_at)
      VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)
    `).bind(id, project.id, data.placement_id, data.display_name || 'Experiment', JSON.stringify(data.audience_conditions || []), data.starts_at || null, data.ends_at || null)];
    for (const variant of variants) {
      statements.push(c.env.DB.prepare(`
        INSERT INTO billing_experiment_variants (id, experiment_id, identifier, offering_id, weight, is_control)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), id, identifier(variant.identifier, 'variant identifier'), variant.offering_id, Number(variant.weight), variant.is_control ? 1 : 0));
    }
    await c.env.DB.batch(statements);
    await audit(c, project.id, 'experiment.created', 'experiment', id, { variants: variants.length });
    return c.json({ id }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/experiments/:id', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    if (data.state && !['draft', 'running', 'paused', 'stopped'].includes(data.state)) throw purchasesError('invalid_experiment_state', 'Invalid experiment state');
    const result = await c.env.DB.prepare(`
      UPDATE billing_experiments SET display_name = COALESCE(?, display_name), state = COALESCE(?, state),
        audience_conditions = COALESCE(?, audience_conditions), starts_at = COALESCE(?, starts_at),
        ends_at = COALESCE(?, ends_at), updated_at = datetime('now') WHERE id = ? AND project_id = ?
    `).bind(data.display_name ?? null, data.state ?? null, data.audience_conditions === undefined ? null : JSON.stringify(data.audience_conditions), data.starts_at ?? null, data.ends_at ?? null, c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw purchasesError('experiment_not_found', 'Experiment not found', 404);
    return c.json({ updated: true });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/virtual-currencies', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`SELECT * FROM billing_virtual_currencies WHERE project_id = ? ORDER BY code`).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/virtual-currencies', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const code = String(data.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{1,12}$/.test(code)) throw purchasesError('invalid_currency_code', 'Currency code must be 1-12 uppercase letters, numbers or underscores');
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO billing_virtual_currencies (id, project_id, code, display_name, description, icon, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, project.id, code, data.display_name || code, data.description || null, data.icon || null, JSON.stringify(data.metadata || {})).run();
    return c.json({ id, code }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/virtual-currencies/:currencyId/products/:productId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const valid = await c.env.DB.prepare(`
      SELECT 1 AS ok FROM billing_virtual_currencies vc
      JOIN billing_products p ON p.project_id = vc.project_id
      WHERE vc.id = ? AND p.id = ? AND vc.project_id = ?
    `).bind(c.req.param('currencyId'), c.req.param('productId'), project.id).first();
    if (!valid) throw purchasesError('currency_or_product_not_found', 'Virtual currency or product not found', 404);
    const amount = Number(data.grant_amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw purchasesError('invalid_grant_amount', 'grant_amount must be a positive integer');
    await c.env.DB.prepare(`
      INSERT INTO billing_virtual_currency_products (
        currency_id, product_id, grant_amount, trial_grant_amount, grant_cadence, expires_after_seconds
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(currency_id, product_id) DO UPDATE SET grant_amount = excluded.grant_amount,
        trial_grant_amount = excluded.trial_grant_amount, grant_cadence = excluded.grant_cadence,
        expires_after_seconds = excluded.expires_after_seconds
    `).bind(c.req.param('currencyId'), c.req.param('productId'), amount, data.trial_grant_amount ?? null, data.grant_cadence || 'purchase', data.expires_after_seconds ?? null).run();
    return c.json({ mapped: true });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/customers/:customerId/virtual-currencies/adjust', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const adjustments = data.adjustments && typeof data.adjustments === 'object' ? data.adjustments : {};
    const idempotencyKey = c.req.header('Idempotency-Key') || data.idempotency_key;
    if (!idempotencyKey) throw purchasesError('idempotency_key_required', 'Idempotency-Key header is required');
    const customer = await c.env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?').bind(c.req.param('customerId'), project.id).first();
    if (!customer) throw purchasesError('customer_not_found', 'Customer not found', 404);
    const currentRows = await c.env.DB.prepare(`SELECT currency_identifier, SUM(amount) AS balance FROM billing_balance_ledger WHERE project_id = ? AND customer_id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) GROUP BY currency_identifier`)
      .bind(project.id, c.req.param('customerId')).all<{ currency_identifier: string; balance: number }>();
    const balances = Object.fromEntries((currentRows.results || []).map((row) => [row.currency_identifier, Number(row.balance)]));
    for (const [code, amountValue] of Object.entries(adjustments)) {
      const amount = Number(amountValue);
      if (!Number.isSafeInteger(amount) || amount === 0) throw purchasesError('invalid_adjustment', `Invalid adjustment for ${code}`);
      if (Number(balances[code] || 0) + amount < 0) throw purchasesError('insufficient_virtual_currency', `Insufficient ${code} balance`, 422);
    }
    const statements = Object.entries(adjustments).map(([code, amountValue]) => c.env.DB.prepare(`
      INSERT OR IGNORE INTO billing_balance_ledger (project_id, customer_id, currency_identifier, amount, reason, idempotency_key)
      VALUES (?, ?, ?, ?, 'admin_adjustment', ?)
    `).bind(project.id, c.req.param('customerId'), code, Number(amountValue), `${idempotencyKey}:${code}`));
    await c.env.DB.batch(statements);
    await audit(c, project.id, 'virtual_currency.adjusted', 'customer', c.req.param('customerId'), { currencies: Object.keys(adjustments) });
    const updated = await c.env.DB.prepare(`SELECT currency_identifier, SUM(amount) AS balance FROM billing_balance_ledger WHERE project_id = ? AND customer_id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) GROUP BY currency_identifier`)
      .bind(project.id, c.req.param('customerId')).all<{ currency_identifier: string; balance: number }>();
    return c.json({ balances: Object.fromEntries((updated.results || []).map((row) => [row.currency_identifier, Number(row.balance)])) });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/integrations/deliveries', async (c) => {
  try {
    const project = await projectFor(c); const limit = parseLimit(c.req.query('limit'));
    const rows = await c.env.DB.prepare(`
      SELECT d.*, e.name AS endpoint_name, e.url FROM billing_webhook_deliveries d
      JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id
      WHERE e.project_id = ? ORDER BY d.created_at DESC LIMIT ?
    `).bind(project.id, limit).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/integrations/deliveries/:id/replay', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const delivery = await c.env.DB.prepare(`SELECT d.id FROM billing_webhook_deliveries d JOIN billing_webhook_endpoints e ON e.id = d.endpoint_id WHERE d.id = ? AND e.project_id = ?`)
      .bind(c.req.param('id'), project.id).first<{ id: string }>();
    if (!delivery) throw purchasesError('delivery_not_found', 'Webhook delivery not found', 404);
    await c.env.DB.prepare(`UPDATE billing_webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = datetime('now'), last_error = NULL WHERE id = ?`)
      .bind(delivery.id).run();
    if (c.env.BILLING_QUEUE) await c.env.BILLING_QUEUE.send({ type: 'billing.webhook.deliver', deliveryId: delivery.id });
    await audit(c, project.id, 'webhook.replayed', 'webhook_delivery', delivery.id);
    return c.json({ replay_queued: true });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/refunds', async (c) => {
  try {
    const project = await projectFor(c);
    const status = String(c.req.query('status') || '').trim();
    const limit = parseLimit(c.req.query('limit'));
    const rows = await c.env.DB.prepare(`
      SELECT rc.*, bc.primary_app_user_id, t.store_transaction_id, p.store_product_id,
        (SELECT COUNT(*) FROM billing_refund_evidence re WHERE re.case_id = rc.id) AS evidence_count,
        (SELECT COUNT(*) FROM billing_refund_provider_actions ra WHERE ra.case_id = rc.id AND ra.status = 'draft') AS actions_requiring_approval
      FROM billing_refund_cases rc
      LEFT JOIN billing_customers bc ON bc.id = rc.customer_id
      LEFT JOIN billing_transactions t ON t.id = rc.transaction_id
      LEFT JOIN billing_products p ON p.id = t.product_id
      WHERE rc.project_id = ? AND (? = '' OR rc.status = ?)
      ORDER BY CASE WHEN rc.deadline_at IS NULL THEN 1 ELSE 0 END, rc.deadline_at, rc.updated_at DESC
      LIMIT ?
    `).bind(project.id, status, status, limit).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/refunds/:caseId', async (c) => {
  try {
    const project = await projectFor(c);
    const refundCase = await c.env.DB.prepare(`
      SELECT rc.*, bc.primary_app_user_id, t.store_transaction_id, p.store_product_id
      FROM billing_refund_cases rc
      LEFT JOIN billing_customers bc ON bc.id = rc.customer_id
      LEFT JOIN billing_transactions t ON t.id = rc.transaction_id
      LEFT JOIN billing_products p ON p.id = t.product_id
      WHERE rc.id = ? AND rc.project_id = ?
    `).bind(c.req.param('caseId'), project.id).first();
    if (!refundCase) throw purchasesError('refund_case_not_found', 'Refund case not found', 404);
    const [evidence, actions, deadlines, events] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM billing_refund_evidence WHERE case_id = ? ORDER BY created_at').bind(c.req.param('caseId')).all(),
      c.env.DB.prepare('SELECT * FROM billing_refund_provider_actions WHERE case_id = ? ORDER BY created_at').bind(c.req.param('caseId')).all(),
      c.env.DB.prepare('SELECT * FROM billing_refund_deadlines WHERE case_id = ? ORDER BY due_at').bind(c.req.param('caseId')).all(),
      c.env.DB.prepare('SELECT * FROM billing_refund_audit_events WHERE case_id = ? ORDER BY occurred_at DESC').bind(c.req.param('caseId')).all(),
    ]);
    const provider = String((refundCase as { provider?: string }).provider || '');
    return c.json({
      refund_case: refundCase,
      evidence: evidence.results,
      actions: actions.results,
      deadlines: deadlines.results,
      audit_events: events.results,
      action_definitions: refundActionDefinitions(provider),
    });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/evidence', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const refundCase = await c.env.DB.prepare('SELECT id, status FROM billing_refund_cases WHERE id = ? AND project_id = ?')
      .bind(c.req.param('caseId'), project.id).first<{ id: string; status: string }>();
    if (!refundCase) throw purchasesError('refund_case_not_found', 'Refund case not found', 404);
    if (!refundCaseAllowsOperatorAction(refundCase.status)) {
      throw purchasesError('refund_case_terminal', 'A terminal refund case cannot accept new evidence', 409);
    }
    const evidenceType = identifier(data.evidence_type, 'evidence_type');
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const fileKey = typeof data.file_key === 'string' ? data.file_key.trim() : '';
    if (!content && !fileKey) throw purchasesError('evidence_content_required', 'Evidence content or file_key is required');
    if (content.length > 20_000) throw purchasesError('refund_evidence_too_large', 'Refund evidence content must contain at most 20,000 characters', 413);
    if (fileKey.length > 1024 || fileKey.includes('..') || fileKey.startsWith('/') || /[\x00-\x1f\x7f]/.test(fileKey)) {
      throw purchasesError('refund_evidence_file_key_invalid', 'Refund evidence file_key is invalid', 422);
    }
    const id = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_refund_evidence (id, case_id, evidence_type, content, file_key, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(id, refundCase.id, evidenceType, content || null, fileKey || null, String(c.get('userId'))),
      c.env.DB.prepare(`
        INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, actor_id, payload)
        VALUES (?, ?, 'evidence.created', 'admin', ?, ?)
      `).bind(crypto.randomUUID(), refundCase.id, String(c.get('userId')), JSON.stringify({ evidence_id: id, evidence_type: evidenceType })),
      c.env.DB.prepare(`UPDATE billing_refund_cases SET status = 'awaiting_approval', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('won','lost','closed')`).bind(refundCase.id),
    ]);
    return c.json({ id, review_status: 'draft' }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/evidence/:evidenceId/review', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const reviewStatus = data.approved === true ? 'approved' : 'rejected';
    const result = await c.env.DB.prepare(`
      UPDATE billing_refund_evidence
      SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND review_status = 'draft'
        AND case_id IN (
          SELECT id FROM billing_refund_cases
          WHERE id = ? AND project_id = ? AND status NOT IN ('won','lost','closed')
        )
    `).bind(reviewStatus, String(c.get('userId')), c.req.param('evidenceId'), c.req.param('caseId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('refund_evidence_not_reviewable', 'Refund evidence was not found or is no longer reviewable', 409);
    await c.env.DB.prepare(`
      INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, actor_id, payload)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).bind(crypto.randomUUID(), c.req.param('caseId'), `evidence.${reviewStatus}`, String(c.get('userId')), JSON.stringify({ evidence_id: c.req.param('evidenceId') })).run();
    return c.json({ review_status: reviewStatus });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/actions', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const refundCase = await c.env.DB.prepare(`
      SELECT id, provider, status FROM billing_refund_cases WHERE id = ? AND project_id = ? LIMIT 1
    `).bind(c.req.param('caseId'), project.id).first<{ id: string; provider: string; status: string }>();
    if (!refundCase) throw purchasesError('refund_case_not_found', 'Refund case not found', 404);
    if (!refundCaseAllowsOperatorAction(refundCase.status)) {
      throw purchasesError('refund_case_terminal', 'A terminal refund case cannot prepare provider actions', 409);
    }
    const actionType = String(data.action_type || '').trim();
    if (!supportedRefundActions(refundCase.provider).includes(actionType as RefundActionType)) {
      throw purchasesError('refund_action_unsupported', `${actionType || 'Refund action'} is not supported for ${refundCase.provider}`);
    }
    const payload = data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)
      ? data.payload as Record<string, unknown>
      : {};
    if (JSON.stringify(payload).length > 100_000) throw purchasesError('refund_action_payload_too_large', 'Refund action payload is too large', 413);
    const id = crypto.randomUUID();
    const idempotencyKey = `refund:${refundCase.id}:${actionType}`;
    await c.env.DB.prepare(`
      INSERT INTO billing_refund_provider_actions (id, case_id, action_type, payload, status, idempotency_key)
      VALUES (?, ?, ?, ?, 'draft', ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        payload = CASE WHEN billing_refund_provider_actions.status = 'draft' THEN excluded.payload ELSE billing_refund_provider_actions.payload END,
        updated_at = datetime('now')
    `).bind(id, refundCase.id, actionType, JSON.stringify(payload), idempotencyKey).run();
    const action = await c.env.DB.prepare(`
      SELECT id, action_type, status, payload FROM billing_refund_provider_actions WHERE idempotency_key = ?
    `).bind(idempotencyKey).first();
    await audit(c, project.id, 'refund_action.drafted', 'refund_provider_action', String((action as any)?.id || id), { case_id: refundCase.id, action_type: actionType });
    return c.json({ data: action, supported_actions: supportedRefundActions(refundCase.provider) }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.patch('/:projectId/refunds/:caseId/actions/:actionId', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const action = await c.env.DB.prepare(`
      SELECT action.id, action.action_type, refund.provider
      FROM billing_refund_provider_actions action
      JOIN billing_refund_cases refund ON refund.id = action.case_id
      WHERE action.id = ? AND action.case_id = ? AND refund.project_id = ?
        AND refund.status NOT IN ('won','lost','closed') AND action.status IN ('draft','failed')
    `).bind(c.req.param('actionId'), c.req.param('caseId'), project.id)
      .first<{ id: string; action_type: string; provider: string }>();
    if (!action) throw purchasesError('refund_action_not_editable', 'Refund action was not found or cannot be edited in its current state', 409);
    const payload = validateRefundActionPayload(action.provider, action.action_type, data.payload);
    await c.env.DB.prepare(`
      UPDATE billing_refund_provider_actions
      SET payload = ?, status = 'draft', attempts = 0, next_attempt_at = NULL,
        claim_token = NULL, claim_expires_at = NULL, last_error = NULL,
        provider_response = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).bind(JSON.stringify(payload), action.id).run();
    await audit(c, project.id, 'refund_action.updated', 'refund_provider_action', action.id, { case_id: c.req.param('caseId') });
    return c.json({ id: action.id, status: 'draft', payload });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/actions/:actionId/approve', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const action = await c.env.DB.prepare(`
      SELECT action.id, action.action_type, action.payload, refund.provider
      FROM billing_refund_provider_actions action
      JOIN billing_refund_cases refund ON refund.id = action.case_id
      WHERE action.id = ? AND action.status = 'draft' AND refund.id = ? AND refund.project_id = ?
        AND refund.status NOT IN ('won','lost','closed')
      LIMIT 1
    `).bind(c.req.param('actionId'), c.req.param('caseId'), project.id)
      .first<{ id: string; action_type: RefundActionType; payload: string; provider: string }>();
    if (!action) throw purchasesError('refund_action_not_approvable', 'Refund action was not found or is no longer a draft', 409);
    validateRefundActionPayload(action.provider, action.action_type, action.payload);
    if (action.action_type === 'submit_consumption_info') {
      const consent = await c.env.DB.prepare(`
        SELECT id FROM billing_refund_evidence
        WHERE case_id = ? AND evidence_type = 'apple_consumption_consent'
          AND review_status = 'approved' AND content IS NOT NULL LIMIT 1
      `).bind(c.req.param('caseId')).first();
      if (!consent) throw purchasesError('apple_consumption_consent_evidence_required', 'Approve apple_consumption_consent evidence before sending data to Apple', 409);
    }
    if (action.action_type === 'submit_stripe_dispute_evidence') {
      const payload = JSON.parse(action.payload || '{}') as Record<string, any>;
      const inlineEvidence = payload.evidence && typeof payload.evidence === 'object' && Object.keys(payload.evidence).length > 0;
      const approved = await c.env.DB.prepare(`
        SELECT id FROM billing_refund_evidence
        WHERE case_id = ? AND review_status = 'approved' AND content IS NOT NULL LIMIT 1
      `).bind(c.req.param('caseId')).first();
      if (!inlineEvidence && !approved) throw purchasesError('stripe_evidence_required', 'Approve at least one evidence item before submitting the Stripe dispute', 409);
    }
    const result = await c.env.DB.prepare(`
      UPDATE billing_refund_provider_actions
      SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'draft' AND payload = ?
        AND case_id IN (
          SELECT id FROM billing_refund_cases
          WHERE id = ? AND project_id = ? AND status NOT IN ('won','lost','closed')
        )
    `).bind(String(c.get('userId')), c.req.param('actionId'), action.payload, c.req.param('caseId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('refund_action_not_approvable', 'Refund action was modified concurrently', 409);
    await c.env.DB.prepare(`
      INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, actor_id, payload)
      VALUES (?, ?, 'provider_action.approved', 'admin', ?, ?)
    `).bind(crypto.randomUUID(), c.req.param('caseId'), String(c.get('userId')), JSON.stringify({ action_id: c.req.param('actionId') })).run();
    let queued = false;
    if (c.env.BILLING_QUEUE) {
      try {
        await c.env.BILLING_QUEUE.send({ type: 'billing.refund.action.execute', actionId: c.req.param('actionId') });
        queued = true;
        await c.env.DB.prepare(`
          UPDATE billing_refund_provider_actions SET status = 'queued', updated_at = datetime('now')
          WHERE id = ? AND status = 'approved'
        `).bind(c.req.param('actionId')).run();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'refund_action_queue_failed', action_id: c.req.param('actionId'),
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    return c.json({ status: queued ? 'queued' : 'approved', queued, retry_scheduled: !queued }, 202);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/exports', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`SELECT * FROM billing_export_jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100`).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/audiences', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT a.*,
        (SELECT COUNT(*) FROM billing_customers c WHERE c.project_id = a.project_id) AS total_customers
      FROM billing_audiences a WHERE a.project_id = ? ORDER BY a.created_at DESC
    `).bind(project.id).all<Record<string, any>>();
    return c.json({ data: (rows.results || []).map((row) => ({ ...row, filters: JSON.parse(row.filters || '[]') })) });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/audiences', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const name = String(data.display_name || '').trim();
    if (!name || name.length > 100) throw purchasesError('invalid_audience_name', 'Audience name is required and must be at most 100 characters');
    const filters = Array.isArray(data.filters) ? data.filters : [];
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`INSERT INTO billing_audiences (id, project_id, display_name, filters) VALUES (?, ?, ?, ?)`)
      .bind(id, project.id, name, JSON.stringify(filters)).run();
    return c.json({ id }, 201);
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/exports', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    if (!['transactions', 'subscriptions', 'customers', 'virtual_currencies'].includes(data.dataset)) throw purchasesError('invalid_export_dataset', 'Invalid export dataset');
    if ((data.format || 'csv') !== 'csv') throw purchasesError('unsupported_export_format', 'Only CSV exports are supported', 422);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_export_jobs (id, project_id, dataset, format, cadence, incremental, columns, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, data.dataset, data.format || 'csv', data.cadence || null, data.incremental === false ? 0 : 1, JSON.stringify(data.columns || []), String(c.get('userId'))).run();
    await audit(c, project.id, 'export.requested', 'export', id, { dataset: data.dataset, format: data.format || 'csv' });
    if (c.env.BILLING_QUEUE) await c.env.BILLING_QUEUE.send({ type: 'billing.export', exportId: id });
    return c.json({ id, status: 'pending', queued: Boolean(c.env.BILLING_QUEUE) }, 202);
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/exports/:id/download', async (c) => {
  try {
    const project = await projectFor(c);
    const job = await c.env.DB.prepare(`SELECT r2_key, dataset, format, status FROM billing_export_jobs WHERE id = ? AND project_id = ?`)
      .bind(c.req.param('id'), project.id).first<{ r2_key: string | null; dataset: string; format: string; status: string }>();
    if (!job) throw purchasesError('export_not_found', 'Export not found', 404);
    if (job.status !== 'completed' || !job.r2_key) throw purchasesError('export_not_ready', 'Export is not ready', 409, job.status === 'pending' || job.status === 'running');
    if (!c.env.R2) throw purchasesError('export_storage_unavailable', 'Export storage is unavailable', 503, true);
    const object = await c.env.R2.get(job.r2_key);
    if (!object) throw purchasesError('export_file_not_found', 'Export file not found', 404);
    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Content-Disposition': object.httpMetadata?.contentDisposition || `attachment; filename="opengrow-${job.dataset}.${job.format}"`,
        ETag: object.httpEtag,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) { return replyError(c, error); }
});

admin.get('/:projectId/paywall-event-types', async (c) => c.json({ data: PAYWALL_EVENT_TYPES }));

export default admin;
