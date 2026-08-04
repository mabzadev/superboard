import type { BillingEnv } from '../types';
import { decryptCredential, scopedStoreCredential } from './secrets';
import { retrieveStripeCatalogProduct } from './stripe-catalog';
import { validateStripeCredentials, type StripeEnvironment } from './stripe-credentials';

function reconciliationError(code: string, message: string, retryable = true, retryDelaySeconds = 300) {
  return Object.assign(new Error(message), { code, retryable, retryDelaySeconds });
}

export async function reconcileStripeCatalog(
  env: BillingEnv,
  projectId: string,
  environment: StripeEnvironment,
  fetcher: typeof fetch = fetch,
) {
  const connection = await env.DB.prepare(`
    SELECT id, status, configuration_encrypted, billing_configuration_encrypted
    FROM billing_store_connections
    WHERE project_id = ? AND provider = 'stripe' AND environment = ? LIMIT 1
  `).bind(projectId, environment).first<Record<string, unknown>>();
  if (!connection || connection.status !== 'connected') {
    throw reconciliationError('stripe_connection_required', 'A tested Stripe connection is required for catalog reconciliation');
  }
  try {
    const encrypted = scopedStoreCredential(connection, env);
    if (!encrypted) throw reconciliationError('stripe_connection_credentials_unavailable', 'Stripe credentials are unavailable for catalog reconciliation');
    let credentials;
    try {
      credentials = validateStripeCredentials(JSON.parse(await decryptCredential(env, encrypted)), environment);
    } catch (error) {
      const tagged = error as { code?: string };
      if (tagged.code) throw error;
      throw reconciliationError('stripe_connection_credentials_invalid', 'Stripe credentials cannot be decrypted');
    }
    const products = await env.DB.prepare(`
      SELECT p.id, p.product_type, pp.id AS price_row_id, pp.provider_price_id
      FROM billing_products p
      JOIN billing_product_prices pp ON pp.product_id = p.id AND pp.active = 1
      WHERE p.project_id = ? AND p.store = 'stripe' AND p.environment = ?
        AND p.active = 1 AND p.product_type IN ('subscription', 'non_consumable', 'consumable')
      ORDER BY p.created_at ASC
      LIMIT 101
    `).bind(projectId, environment).all<Record<string, unknown>>();
    const rows = products.results || [];
    if (rows.length === 0) throw reconciliationError('stripe_catalog_empty', 'No active Stripe Price is available for reconciliation', false);
    if (rows.length > 100) throw reconciliationError('stripe_catalog_limit_exceeded', 'Stripe catalog exceeds the reconciliation safety limit', false);
    const verified = [];
    for (const row of rows) {
      const priceId = String(row.provider_price_id || '');
      const productType = String(row.product_type) as 'subscription' | 'non_consumable' | 'consumable';
      const imported = await retrieveStripeCatalogProduct({
        secretKey: credentials.secret_key,
        environment,
        priceId,
        productType,
        fetcher,
      });
      verified.push({ row, imported });
    }
    const verifiedAt = new Date().toISOString();
    await env.DB.batch([
      ...verified.flatMap(({ row, imported }) => [
        env.DB.prepare(`
          UPDATE billing_products
          SET display_name = ?, description = ?, product_type = ?, metadata = ?, active = 1, updated_at = datetime('now')
          WHERE id = ? AND project_id = ?
        `).bind(
          imported.displayName, imported.description, imported.productType,
          JSON.stringify(imported.productMetadata), String(row.id), projectId,
        ),
        env.DB.prepare(`
          UPDATE billing_product_prices
          SET currency = ?, price_micros = ?, billing_period = ?, trial_period = ?,
            metadata = ?, active = 1, updated_at = datetime('now')
          WHERE id = ? AND product_id = ?
        `).bind(
          imported.currency, imported.priceMicros, imported.billingPeriod, imported.trialPeriod,
          JSON.stringify(imported.priceMetadata), String(row.price_row_id), String(row.id),
        ),
      ]),
      env.DB.prepare(`
        UPDATE billing_store_connections
        SET last_synced_at = ?, last_error_code = NULL, last_error_message = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).bind(verifiedAt, String(connection.id)),
    ]);
    return { project_id: projectId, environment, verified_products: verified.length, verified_at: verifiedAt };
  } catch (error) {
    const tagged = error as { code?: string; message?: string };
    await env.DB.prepare(`
      UPDATE billing_store_connections
      SET last_error_code = ?, last_error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      String(tagged.code || 'stripe_catalog_reconciliation_failed').slice(0, 100),
      String(tagged.message || 'Stripe catalog reconciliation failed').slice(0, 1000),
      String(connection.id),
    ).run();
    throw error;
  }
}
