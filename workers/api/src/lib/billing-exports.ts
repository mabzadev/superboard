import type { BillingEnv } from '../types';

const DATASETS: Record<string, { sql: string; columns: string[] }> = {
  transactions: {
    sql: `
      SELECT t.id, t.store, t.environment, t.store_transaction_id, t.original_transaction_id,
        t.event_type, t.status, t.price_micros, t.currency, t.quantity, t.purchased_at,
        t.expires_at, t.created_at, p.store_product_id, c.primary_app_user_id
      FROM billing_transactions t
      LEFT JOIN billing_products p ON p.id = t.product_id
      LEFT JOIN billing_customers c ON c.id = t.customer_id
      WHERE t.project_id = ? ORDER BY t.created_at
    `,
    columns: ['id', 'store', 'environment', 'store_transaction_id', 'original_transaction_id', 'event_type', 'status', 'price_micros', 'currency', 'quantity', 'purchased_at', 'expires_at', 'created_at', 'store_product_id', 'primary_app_user_id'],
  },
  subscriptions: {
    sql: `
      SELECT s.id, s.store, s.environment, s.original_transaction_id, s.status, s.period_type,
        s.starts_at, s.expires_at, s.grace_expires_at, s.auto_renews, s.will_renew,
        s.created_at, s.updated_at, p.store_product_id, c.primary_app_user_id
      FROM billing_subscriptions s
      LEFT JOIN billing_products p ON p.id = s.product_id
      LEFT JOIN billing_customers c ON c.id = s.customer_id
      WHERE s.project_id = ? ORDER BY s.created_at
    `,
    columns: ['id', 'store', 'environment', 'original_transaction_id', 'status', 'period_type', 'starts_at', 'expires_at', 'grace_expires_at', 'auto_renews', 'will_renew', 'created_at', 'updated_at', 'store_product_id', 'primary_app_user_id'],
  },
  customers: {
    sql: `
      SELECT id, primary_app_user_id, anonymous, blocked, attributes, first_seen_at,
        last_seen_at, created_at, updated_at
      FROM billing_customers WHERE project_id = ? ORDER BY created_at
    `,
    columns: ['id', 'primary_app_user_id', 'anonymous', 'blocked', 'attributes', 'first_seen_at', 'last_seen_at', 'created_at', 'updated_at'],
  },
  virtual_currencies: {
    sql: `
      SELECT l.id, c.primary_app_user_id, l.currency_identifier, l.amount, l.reason,
        l.idempotency_key, l.created_at
      FROM billing_balance_ledger l
      JOIN billing_customers c ON c.id = l.customer_id
      WHERE l.project_id = ? ORDER BY l.created_at
    `,
    columns: ['id', 'primary_app_user_id', 'currency_identifier', 'amount', 'reason', 'idempotency_key', 'created_at'],
  },
};

function parseColumns(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function csv(value: unknown) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function processBillingExport(env: BillingEnv, exportId: string) {
  const job = await env.DB.prepare(`SELECT * FROM billing_export_jobs WHERE id = ? LIMIT 1`).bind(exportId).first<Record<string, any>>();
  if (!job) throw new Error('Billing export not found');
  if (!env.R2) throw new Error('R2 is not configured for billing exports');
  const dataset = DATASETS[String(job.dataset)];
  if (!dataset) throw new Error('Unsupported billing export dataset');
  if (job.format !== 'csv') throw new Error('Unsupported billing export format');
  await env.DB.prepare(`UPDATE billing_export_jobs SET status = 'running', started_at = datetime('now'), error_message = NULL WHERE id = ?`).bind(exportId).run();
  try {
    const result = await env.DB.prepare(dataset.sql).bind(String(job.project_id)).all<Record<string, unknown>>();
    const requested = parseColumns(job.columns);
    const columns = requested.length ? requested.filter((item) => dataset.columns.includes(item)) : dataset.columns;
    if (!columns.length) throw new Error('No valid export columns selected');
    const lines = [columns.join(','), ...(result.results || []).map((row) => columns.map((column) => csv(row[column])).join(','))];
    const key = `purchases/${job.project_id}/${job.dataset}/${new Date().toISOString().slice(0, 10)}/${job.id}.csv`;
    await env.R2.put(key, lines.join('\n'), {
      httpMetadata: { contentType: 'text/csv; charset=utf-8', contentDisposition: `attachment; filename="opengrow-${job.dataset}-${job.id}.csv"` },
      customMetadata: { project_id: String(job.project_id), dataset: String(job.dataset), rows: String(result.results?.length || 0) },
    });
    await env.DB.prepare(`UPDATE billing_export_jobs SET status = 'completed', r2_key = ?, row_count = ?, completed_at = datetime('now') WHERE id = ?`)
      .bind(key, result.results?.length || 0, exportId).run();
    return { id: exportId, key, rows: result.results?.length || 0 };
  } catch (error) {
    await env.DB.prepare(`UPDATE billing_export_jobs SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`)
      .bind((error as Error)?.message || String(error), exportId).run();
    throw error;
  }
}
