import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AppVariables, Env } from '../types';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { decryptCredential, encryptCredential } from '../lib/secrets';
import { testStoreCredentials } from '../lib/store-verification';
import { errorEnvelope, PAYWALL_EVENT_TYPES, purchasesError } from '../lib/purchases-v2';
import { signedCustomerInfo } from '../lib/billing-identity';
import { identifyCustomer, queueCustomerEntitlementChanged } from '../lib/billing';

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();
admin.use('*', authMiddleware);

// VocoStar intentionally supports only the two native stores and Stripe.
// Keep historical rows readable, but never expose or create disabled providers.
const PROVIDERS = ['apple', 'google', 'stripe'] as const;
const ENVIRONMENTS = ['sandbox', 'production'] as const;
const FEATURE_FLAGS = ['purchases_core', 'product_catalog', 'paywalls', 'growth', 'web_billing', 'virtual_currencies', 'scheduled_exports'] as const;

async function jsonBody(c: any): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
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
        SELECT MAX(updated_at) AS last_reconciled_at,
          SUM(CASE WHEN status = 'billing_issue' THEN 1 ELSE 0 END) AS billing_issues
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
    return c.json({ status: Number((events as any)?.failed_events || 0) + Number((deliveries as any)?.failed_deliveries || 0) > 0 ? 'degraded' : 'healthy', events, subscriptions, deliveries, connections: connections.results, features });
  } catch (error) { return replyError(c, error); }
});

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

admin.post('/:projectId/connections', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const data = await jsonBody(c);
    const provider = String(data.provider || '');
    const environment = String(data.environment || '');
    if (!PROVIDERS.includes(provider as any)) throw purchasesError('unsupported_provider', 'Unsupported billing provider');
    if (!ENVIRONMENTS.includes(environment as any)) throw purchasesError('invalid_environment', 'Environment must be sandbox or production');
    const secret = data.secret_configuration && Object.keys(data.secret_configuration).length
      ? await encryptCredential(c.env, JSON.stringify(data.secret_configuration)) : null;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_store_connections (
        id, project_id, provider, environment, display_name, status, capabilities,
        configuration_encrypted, public_configuration
      ) VALUES (?, ?, ?, ?, ?, 'configured', ?, ?, ?)
      ON CONFLICT(project_id, provider, environment) DO UPDATE SET
        display_name = excluded.display_name, status = 'configured', capabilities = excluded.capabilities,
        configuration_encrypted = COALESCE(excluded.configuration_encrypted, billing_store_connections.configuration_encrypted),
        public_configuration = excluded.public_configuration, last_error_code = NULL,
        last_error_message = NULL, updated_at = datetime('now')
    `).bind(id, project.id, provider, environment, data.display_name || provider, JSON.stringify(connectionCapabilities(provider, true)), secret, JSON.stringify(data.public_configuration || {})).run();
    await audit(c, project.id, 'connection.upserted', 'store_connection', id, { provider, environment });
    return c.json({ id, provider, environment, configured: true }, 201);
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
      const connection = await c.env.DB.prepare(`SELECT id, configuration_encrypted FROM billing_store_connections WHERE project_id = ? AND provider = ? AND environment = ? AND configuration_encrypted IS NOT NULL`)
        .bind(project.id, provider, environment).first<{ id: string; configuration_encrypted: string }>();
      if (!connection) throw purchasesError('connection_not_configured', `${provider} credentials are not configured`, 422);
      const credentials = JSON.parse(await decryptCredential(c.env, connection.configuration_encrypted));
      if (provider === 'stripe') {
        const response = await fetch('https://api.stripe.com/v1/account', {
          headers: { Authorization: `Bearer ${credentials.secret_key || credentials.api_key || ''}` },
        });
        const payload = await response.json().catch(() => ({})) as Record<string, any>;
        if (!response.ok) throw purchasesError('stripe_connection_failed', payload?.error?.message || 'Stripe connection failed', 422);
        result = { ok: true, provider, environment, account_id: payload.id, country: payload.country };
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
    const storeProductId = String(data.store_product_id || '').trim();
    if (!storeProductId) throw purchasesError('product_id_required', 'Provider product or price ID is required');
    const productId = crypto.randomUUID(); const priceId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_products (id, project_id, store, environment, store_product_id, product_type, display_name, description, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(productId, project.id, provider, data.environment || (project.isTest ? 'sandbox' : 'production'), storeProductId, data.product_type, data.display_name || storeProductId, data.description || null, JSON.stringify(data.metadata || {})),
      c.env.DB.prepare(`
        INSERT INTO billing_product_prices (id, product_id, provider_price_id, currency, price_micros, billing_period, trial_period, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(priceId, productId, data.provider_price_id || storeProductId, data.currency || null, data.price_micros ?? null, data.billing_period || null, data.trial_period || null, JSON.stringify(data.price_metadata || {})),
    ]);
    await audit(c, project.id, 'provider_product.created', 'product', productId, { provider, store_product_id: storeProductId });
    return c.json({ id: productId, price_id: priceId }, 201);
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
        { type: 'title', text: 'Passez Premium' },
        { type: 'subtitle', text: 'Débloquez toutes les fonctionnalités.' },
        { type: 'packages' },
        { type: 'purchase_button', text: 'Continuer' },
        { type: 'restore_button', text: 'Restaurer mes achats' },
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
    return c.json({ refund_case: refundCase, evidence: evidence.results, actions: actions.results, deadlines: deadlines.results, audit_events: events.results });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/evidence', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project); const data = await jsonBody(c);
    const refundCase = await c.env.DB.prepare('SELECT id FROM billing_refund_cases WHERE id = ? AND project_id = ?')
      .bind(c.req.param('caseId'), project.id).first<{ id: string }>();
    if (!refundCase) throw purchasesError('refund_case_not_found', 'Refund case not found', 404);
    const evidenceType = identifier(data.evidence_type, 'evidence_type');
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const fileKey = typeof data.file_key === 'string' ? data.file_key.trim() : '';
    if (!content && !fileKey) throw purchasesError('evidence_content_required', 'Evidence content or file_key is required');
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
      WHERE id = ? AND case_id IN (SELECT id FROM billing_refund_cases WHERE id = ? AND project_id = ?)
    `).bind(reviewStatus, String(c.get('userId')), c.req.param('evidenceId'), c.req.param('caseId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('refund_evidence_not_found', 'Refund evidence not found', 404);
    await c.env.DB.prepare(`
      INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, actor_id, payload)
      VALUES (?, ?, ?, 'admin', ?, ?)
    `).bind(crypto.randomUUID(), c.req.param('caseId'), `evidence.${reviewStatus}`, String(c.get('userId')), JSON.stringify({ evidence_id: c.req.param('evidenceId') })).run();
    return c.json({ review_status: reviewStatus });
  } catch (error) { return replyError(c, error); }
});

admin.post('/:projectId/refunds/:caseId/actions/:actionId/approve', async (c) => {
  try {
    const project = await projectFor(c); requireAdmin(project);
    const result = await c.env.DB.prepare(`
      UPDATE billing_refund_provider_actions
      SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND status = 'draft'
        AND case_id IN (SELECT id FROM billing_refund_cases WHERE id = ? AND project_id = ?)
    `).bind(String(c.get('userId')), c.req.param('actionId'), c.req.param('caseId'), project.id).run();
    if (!result.meta.changes) throw purchasesError('refund_action_not_approvable', 'Refund action was not found or is no longer a draft', 409);
    await c.env.DB.prepare(`
      INSERT INTO billing_refund_audit_events (id, case_id, event_type, actor_type, actor_id, payload)
      VALUES (?, ?, 'provider_action.approved', 'admin', ?, ?)
    `).bind(crypto.randomUUID(), c.req.param('caseId'), String(c.get('userId')), JSON.stringify({ action_id: c.req.param('actionId') })).run();
    return c.json({ status: 'approved', queued: false });
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
