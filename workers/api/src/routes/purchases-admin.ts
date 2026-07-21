import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { AppVariables, Env } from '../types';
import { getOrCreateProject, parseProjectExternalId } from '../lib/db';
import { encryptCredential } from '../lib/secrets';
import { signedCustomerInfo } from '../lib/billing-identity';
import { customerInfo, identifyCustomer } from '../lib/billing';
import { customerForAppUserId } from '../lib/billing-identity';
import { testStoreCredentials } from '../lib/store-verification';

const admin = new Hono<{ Bindings: Env; Variables: AppVariables }>();
admin.use('*', authMiddleware);

async function body(c: any): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

async function projectFor(c: any) {
  const externalId = c.req.param('projectId');
  const parsed = parseProjectExternalId(externalId);
  const access = await c.env.DB.prepare(`
    SELECT role FROM instance_roles WHERE user_id = ? AND instance_id = ? LIMIT 1
  `).bind(c.get('userId'), parsed.instanceId).first() as { role: string } | null;
  if (!access) throw new Error('Project not found');
  const project = await getOrCreateProject(c.env.DB, parsed.instanceId, parsed.kind);
  return { ...project, role: access.role };
}

function fail(c: any, error: unknown) {
  const message = error instanceof Error ? error.message : 'Billing request failed';
  return c.json({ error: message }, /not found/i.test(message) ? 404 : 422);
}

admin.get('/:projectId', async (c) => {
  try {
    const project = await projectFor(c);
    const [settings, products, entitlements, offerings, metrics] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM billing_project_settings WHERE project_id = ?').bind(project.id).first(),
      c.env.DB.prepare('SELECT * FROM billing_products WHERE project_id = ? ORDER BY created_at DESC').bind(project.id).all(),
      c.env.DB.prepare('SELECT * FROM billing_entitlements WHERE project_id = ? ORDER BY identifier').bind(project.id).all(),
      c.env.DB.prepare('SELECT * FROM billing_offerings WHERE project_id = ? ORDER BY is_current DESC, created_at').bind(project.id).all(),
      c.env.DB.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status IN ('active','trialing','grace_period','cancelled') THEN price_micros ELSE 0 END), 0) AS revenue_micros,
          COUNT(DISTINCT CASE WHEN status IN ('active','trialing','grace_period','cancelled') THEN customer_id END) AS paying_customers,
          COUNT(DISTINCT CASE WHEN status = 'trialing' THEN customer_id END) AS trials,
          COUNT(DISTINCT CASE WHEN status IN ('refunded','revoked') THEN id END) AS refunds
        FROM billing_transactions WHERE project_id = ?
      `).bind(project.id).first(),
    ]);
    return c.json({ project, settings, products: products.results, entitlements: entitlements.results, offerings: offerings.results, metrics });
  } catch (error) { return fail(c, error); }
});

admin.put('/:projectId/settings', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const restore = data.restore_behavior === 'block' ? 'block' : 'transfer';
    await c.env.DB.prepare(`
      INSERT INTO billing_project_settings (project_id, restore_behavior, purchases_enabled)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET restore_behavior = excluded.restore_behavior,
        purchases_enabled = excluded.purchases_enabled, updated_at = datetime('now')
    `).bind(project.id, restore, data.purchases_enabled ? 1 : 0).run();
    return c.json(await c.env.DB.prepare('SELECT * FROM billing_project_settings WHERE project_id = ?').bind(project.id).first());
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/oidc', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare('SELECT * FROM billing_oidc_configs WHERE project_id = ? ORDER BY created_at').bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/oidc', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const issuerUrl = new URL(String(data.issuer));
    if (issuerUrl.protocol !== 'https:') throw new Error('OIDC issuer must use HTTPS');
    const issuer = issuerUrl.toString().replace(/\/$/, '');
    const jwks = new URL(String(data.jwks_uri));
    if (jwks.protocol !== 'https:') throw new Error('JWKS URL must use HTTPS');
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_oidc_configs (id, project_id, issuer, audience, jwks_uri, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(project_id, issuer, audience) DO UPDATE SET jwks_uri = excluded.jwks_uri, enabled = 1, updated_at = datetime('now')
    `).bind(id, project.id, issuer, String(data.audience || 'opengrow'), jwks.toString()).run();
    return c.json({ id }, 201);
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/products', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT p.*, GROUP_CONCAT(pe.entitlement_id) AS entitlement_ids
      FROM billing_products p LEFT JOIN billing_product_entitlements pe ON pe.product_id = p.id
      WHERE p.project_id = ? GROUP BY p.id ORDER BY p.created_at DESC
    `).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/products', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    if (!['apple', 'google'].includes(data.store) || !['subscription', 'non_consumable', 'consumable'].includes(data.product_type)) {
      throw new Error('Valid store and product_type are required');
    }
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_products (id, project_id, application_id, store, environment, store_product_id, product_type, display_name, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, data.application_id || null, data.store, project.isTest ? 'sandbox' : 'production', String(data.store_product_id), data.product_type, data.display_name || data.store_product_id, data.description || null, JSON.stringify(data.metadata || {})).run();
    for (const entitlementId of Array.isArray(data.entitlement_ids) ? data.entitlement_ids : []) {
      await c.env.DB.prepare('INSERT OR IGNORE INTO billing_product_entitlements (product_id, entitlement_id) SELECT ?, id FROM billing_entitlements WHERE id = ? AND project_id = ?')
        .bind(id, entitlementId, project.id).run();
    }
    return c.json({ id }, 201);
  } catch (error) { return fail(c, error); }
});

admin.patch('/:projectId/products/:id', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const row = await c.env.DB.prepare(`
      UPDATE billing_products SET display_name = COALESCE(?, display_name), description = COALESCE(?, description),
        active = COALESCE(?, active), metadata = COALESCE(?, metadata), updated_at = datetime('now')
      WHERE id = ? AND project_id = ? RETURNING *
    `).bind(data.display_name ?? null, data.description ?? null, data.active === undefined ? null : data.active ? 1 : 0, data.metadata === undefined ? null : JSON.stringify(data.metadata), c.req.param('id'), project.id).first();
    if (!row) throw new Error('Product not found');
    return c.json(row);
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/entitlements', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare('SELECT * FROM billing_entitlements WHERE project_id = ? ORDER BY identifier').bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/entitlements', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const identifier = String(data.identifier || '').trim().toLowerCase();
    if (!/^[a-z0-9_.-]{1,80}$/.test(identifier)) throw new Error('Entitlement identifier is invalid');
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO billing_entitlements (id, project_id, identifier, display_name, description) VALUES (?, ?, ?, ?, ?)')
      .bind(id, project.id, identifier, data.display_name || identifier, data.description || null).run();
    return c.json({ id }, 201);
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/products/:productId/entitlements/:entitlementId', async (c) => {
  try {
    const project = await projectFor(c);
    const valid = await c.env.DB.prepare(`
      SELECT 1 AS ok FROM billing_products p JOIN billing_entitlements e ON e.project_id = p.project_id
      WHERE p.id = ? AND e.id = ? AND p.project_id = ?
    `).bind(c.req.param('productId'), c.req.param('entitlementId'), project.id).first();
    if (!valid) throw new Error('Product or entitlement not found');
    await c.env.DB.prepare('INSERT OR IGNORE INTO billing_product_entitlements (product_id, entitlement_id) VALUES (?, ?)')
      .bind(c.req.param('productId'), c.req.param('entitlementId')).run();
    return c.json({ mapped: true });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/offerings', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const id = crypto.randomUUID();
    if (data.is_current) await c.env.DB.prepare('UPDATE billing_offerings SET is_current = 0 WHERE project_id = ?').bind(project.id).run();
    await c.env.DB.prepare(`
      INSERT INTO billing_offerings (id, project_id, identifier, display_name, description, placement, is_current, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, String(data.identifier), data.display_name || data.identifier, data.description || null, data.placement || 'default', data.is_current ? 1 : 0, JSON.stringify(data.metadata || {})).run();
    return c.json({ id }, 201);
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/offerings/:offeringId/packages', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const offering = await c.env.DB.prepare('SELECT id FROM billing_offerings WHERE id = ? AND project_id = ?').bind(c.req.param('offeringId'), project.id).first();
    if (!offering) throw new Error('Offering not found');
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO billing_packages (id, offering_id, identifier, package_type, position, metadata) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, offering.id, String(data.identifier), data.package_type || 'custom', Number(data.position || 0), JSON.stringify(data.metadata || {})).run();
    for (const productId of Array.isArray(data.product_ids) ? data.product_ids : []) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO billing_package_products (package_id, product_id)
        SELECT ?, id FROM billing_products WHERE id = ? AND project_id = ?
      `).bind(id, productId, project.id).run();
    }
    return c.json({ id }, 201);
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/customers', async (c) => {
  try {
    const project = await projectFor(c);
    const query = `%${String(c.req.query('q') || '').slice(0, 100)}%`;
    const rows = await c.env.DB.prepare(`
      SELECT c.*, GROUP_CONCAT(a.app_user_id) AS aliases
      FROM billing_customers c LEFT JOIN billing_customer_aliases a ON a.customer_id = c.id
      WHERE c.project_id = ? AND (c.primary_app_user_id LIKE ? OR a.app_user_id LIKE ?)
      GROUP BY c.id ORDER BY c.last_seen_at DESC LIMIT 100
    `).bind(project.id, query, query).all();
    return c.json({ data: rows.results });
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/customers/:customerId', async (c) => {
  try {
    const project = await projectFor(c);
    const customer = await c.env.DB.prepare('SELECT * FROM billing_customers WHERE id = ? AND project_id = ?').bind(c.req.param('customerId'), project.id).first();
    if (!customer) throw new Error('Customer not found');
    const transactions = await c.env.DB.prepare(`
      SELECT t.*, p.store_product_id FROM billing_transactions t LEFT JOIN billing_products p ON p.id = t.product_id
      WHERE t.customer_id = ? ORDER BY t.created_at DESC LIMIT 250
    `).bind(customer.id).all();
    return c.json({ customer, customer_info: await signedCustomerInfo(c.env, project.id, String(customer.id)), transactions: transactions.results });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/customers/:customerId/block', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const result = await c.env.DB.prepare('UPDATE billing_customers SET blocked = ?, updated_at = datetime(\'now\') WHERE id = ? AND project_id = ?')
      .bind(data.blocked === false ? 0 : 1, c.req.param('customerId'), project.id).run();
    if (!result.meta.changes) throw new Error('Customer not found');
    return c.json({ blocked: data.blocked === false ? false : true });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/customers/:customerId/entitlements/:entitlementId', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const customer = await c.env.DB.prepare('SELECT id FROM billing_customers WHERE id = ? AND project_id = ?').bind(c.req.param('customerId'), project.id).first();
    const entitlement = await c.env.DB.prepare('SELECT id FROM billing_entitlements WHERE id = ? AND project_id = ?').bind(c.req.param('entitlementId'), project.id).first();
    if (!customer || !entitlement) throw new Error('Customer or entitlement not found');
    await c.env.DB.prepare(`
      INSERT INTO billing_customer_entitlements (project_id, customer_id, entitlement_id, source, status, starts_at, expires_at, verification)
      VALUES (?, ?, ?, 'promotional', 'active', datetime('now'), ?, 'admin')
      ON CONFLICT(customer_id, entitlement_id, source) DO UPDATE SET status = 'active', expires_at = excluded.expires_at, updated_at = datetime('now')
    `).bind(project.id, customer.id, entitlement.id, data.expires_at || null).run();
    return c.json({ granted: true });
  } catch (error) { return fail(c, error); }
});

admin.delete('/:projectId/customers/:customerId/entitlements/:entitlementId', async (c) => {
  try {
    const project = await projectFor(c);
    await c.env.DB.prepare(`
      UPDATE billing_customer_entitlements SET status = 'revoked', updated_at = datetime('now')
      WHERE project_id = ? AND customer_id = ? AND entitlement_id = ? AND source = 'promotional'
    `).bind(project.id, c.req.param('customerId'), c.req.param('entitlementId')).run();
    return c.json({ revoked: true });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/webhooks', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const url = new URL(String(data.url));
    if (url.protocol !== 'https:') throw new Error('Webhook URL must use HTTPS');
    const clearSecret = String(data.signing_secret || crypto.randomUUID() + crypto.randomUUID());
    const encrypted = await encryptCredential(c.env, clearSecret);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_webhook_endpoints (id, project_id, name, url, signing_secret_encrypted, environments, event_types)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, data.name || url.hostname, url.toString(), encrypted, JSON.stringify(data.environments || ['production']), JSON.stringify(data.event_types || [])).run();
    return c.json({ id, signing_secret: clearSecret }, 201);
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/webhooks', async (c) => {
  try {
    const project = await projectFor(c);
    const rows = await c.env.DB.prepare(`
      SELECT id, name, url, environments, event_types, active, created_at, updated_at
      FROM billing_webhook_endpoints WHERE project_id = ? ORDER BY created_at DESC
    `).bind(project.id).all();
    return c.json({ data: rows.results });
  } catch (error) { return fail(c, error); }
});

admin.delete('/:projectId/webhooks/:id', async (c) => {
  try {
    const project = await projectFor(c);
    await c.env.DB.prepare('DELETE FROM billing_webhook_endpoints WHERE id = ? AND project_id = ?')
      .bind(c.req.param('id'), project.id).run();
    return c.json({ deleted: true });
  } catch (error) { return fail(c, error); }
});

admin.delete('/:projectId/products/:id', async (c) => {
  try {
    const project = await projectFor(c);
    const result = await c.env.DB.prepare('UPDATE billing_products SET active = 0, updated_at = datetime(\'now\') WHERE id = ? AND project_id = ?')
      .bind(c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw new Error('Product not found');
    return c.json({ archived: true });
  } catch (error) { return fail(c, error); }
});

admin.delete('/:projectId/entitlements/:id', async (c) => {
  try {
    const project = await projectFor(c);
    const result = await c.env.DB.prepare('UPDATE billing_entitlements SET active = 0, updated_at = datetime(\'now\') WHERE id = ? AND project_id = ?')
      .bind(c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw new Error('Entitlement not found');
    return c.json({ archived: true });
  } catch (error) { return fail(c, error); }
});

admin.delete('/:projectId/offerings/:id', async (c) => {
  try {
    const project = await projectFor(c);
    const result = await c.env.DB.prepare('UPDATE billing_offerings SET active = 0, is_current = 0, updated_at = datetime(\'now\') WHERE id = ? AND project_id = ?')
      .bind(c.req.param('id'), project.id).run();
    if (!result.meta.changes) throw new Error('Offering not found');
    return c.json({ archived: true });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/customers/:customerId/merge', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const source = await c.env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?')
      .bind(c.req.param('customerId'), project.id).first<{ primary_app_user_id: string }>();
    const target = await c.env.DB.prepare('SELECT primary_app_user_id FROM billing_customers WHERE id = ? AND project_id = ?')
      .bind(String(data.target_customer_id), project.id).first<{ primary_app_user_id: string }>();
    if (!source || !target) throw new Error('Source or target customer not found');
    const merged = await identifyCustomer(c.env.DB, project.id, source.primary_app_user_id, target.primary_app_user_id);
    return c.json({ customer_id: merged?.id });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/mirror/compare', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    const appUserId = String(data.app_user_id || '');
    const customer = await customerForAppUserId(c.env, project.id, appUserId);
    if (!customer) throw new Error('Customer not found');
    const opengrow = await customerInfo(c.env.DB, project.id, String(customer.id));
    const opengrowActive = Object.entries(opengrow.entitlements)
      .filter(([, value]) => (value as Record<string, unknown>).is_active === true)
      .map(([key]) => key).sort();
    const rc = data.revenuecat_customer_info || {};
    const rcRaw = rc.entitlements?.active || rc.entitlements || {};
    const revenueCatActive = Object.keys(rcRaw).filter((key) => {
      const value = rcRaw[key];
      return value && value.is_active !== false;
    }).sort();
    const missingInOpenGrow = revenueCatActive.filter((key) => !opengrowActive.includes(key));
    const extraInOpenGrow = opengrowActive.filter((key) => !revenueCatActive.includes(key));
    const differences = { missing_in_opengrow: missingInOpenGrow, extra_in_opengrow: extraInOpenGrow };
    const matches = missingInOpenGrow.length === 0 && extraInOpenGrow.length === 0;
    const id = crypto.randomUUID();
    await c.env.DB.prepare(`
      INSERT INTO billing_mirror_comparisons (
        id, project_id, customer_id, app_user_id, matches,
        opengrow_active_entitlements, revenuecat_active_entitlements, differences
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, project.id, customer.id, appUserId, matches ? 1 : 0, JSON.stringify(opengrowActive), JSON.stringify(revenueCatActive), JSON.stringify(differences)).run();
    return c.json({ id, matches, ...differences });
  } catch (error) { return fail(c, error); }
});

admin.get('/:projectId/mirror', async (c) => {
  try {
    const project = await projectFor(c);
    const summary = await c.env.DB.prepare(`
      SELECT COUNT(*) AS total, SUM(matches) AS matching,
             SUM(CASE WHEN matches = 0 THEN 1 ELSE 0 END) AS mismatching
      FROM billing_mirror_comparisons WHERE project_id = ?
    `).bind(project.id).first();
    const latest = await c.env.DB.prepare(`
      SELECT * FROM billing_mirror_comparisons WHERE project_id = ?
      ORDER BY created_at DESC LIMIT 100
    `).bind(project.id).all();
    return c.json({ summary, data: latest.results });
  } catch (error) { return fail(c, error); }
});

admin.post('/:projectId/credentials/test', async (c) => {
  try {
    const project = await projectFor(c);
    const data = await body(c);
    if (data.platform !== 'ios' && data.platform !== 'android') throw new Error('platform must be ios or android');
    return c.json(await testStoreCredentials(c.env, {
      projectId: project.id,
      platform: data.platform,
      environment: project.isTest ? 'sandbox' : 'production',
    }));
  } catch (error) { return fail(c, error); }
});

export default admin;
