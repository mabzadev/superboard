import { Hono } from 'hono';
import type { BillingEnv } from '../../api/src/types';
import { applyVerifiedPurchase } from '../../api/src/lib/billing';
import { dispatchBillingJob, isBillingQueueJob } from '../../api/src/lib/billing-dispatch';
import { purchasesSigningJwks, signedCustomerInfo } from '../../api/src/lib/billing-identity';
import { reconcileBillingState } from '../../api/src/lib/billing-jobs';
import {
  fetchStoreCatalog,
  finalizeGooglePurchase,
  verifyAppleTransaction,
  verifyGooglePurchase,
} from '../../api/src/lib/store-verification';
import { billingSecretReadiness, parseReceiptRequest, publicError } from './contracts';
import { readTextLimited } from '../../api/src/lib/http-limits';
import { decryptCredential } from '../../api/src/lib/secrets';

type Bindings = Env & BillingEnv;
const app = new Hono<{ Bindings: Bindings }>();

app.get('/internal/v1/health', async (c) => {
  const secrets = billingSecretReadiness(c.env);
  const [stores, credentialCopies] = await Promise.all([
    c.env.DB.prepare(`
    SELECT provider, environment, COUNT(*) AS connections,
      SUM(CASE WHEN configuration_encrypted IS NOT NULL THEN 1 ELSE 0 END) AS configured
    FROM billing_store_connections
    WHERE provider IN ('apple', 'google', 'stripe')
    GROUP BY provider, environment ORDER BY provider, environment
    `).all<Record<string, unknown>>(),
    c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM ios_server_api_keys WHERE encrypted_key IS NOT NULL) AS apple_source,
        (SELECT COUNT(*) FROM ios_server_api_keys WHERE billing_encrypted_key IS NOT NULL) AS apple_billing,
        (SELECT COUNT(*) FROM android_server_api_keys WHERE encrypted_key IS NOT NULL) AS google_source,
        (SELECT COUNT(*) FROM android_server_api_keys WHERE billing_encrypted_key IS NOT NULL) AS google_billing
    `).first<Record<string, number>>(),
  ]);
  const copiesReady = Boolean(
    credentialCopies
    && credentialCopies.apple_source > 0
    && credentialCopies.google_source > 0
    && credentialCopies.apple_source === credentialCopies.apple_billing
    && credentialCopies.google_source === credentialCopies.google_billing
  );
  const decryptionReady = copiesReady ? await validateCredentialDecryption(c.env) : false;
  return c.json({
    status: 'ok', service: 'opengrow-billing', environment: c.env.ENVIRONMENT,
    execution: 'private-service-binding', ready_for_traffic: secrets.ready && copiesReady && decryptionReady,
    missing_secrets: secrets.missing, credential_copies_ready: copiesReady,
    credential_decryption_ready: decryptionReady,
    credential_copies: credentialCopies, store_connections: stores.results || [],
  });
});

app.get('/internal/v1/jwks', (c) => {
  try { return c.json(purchasesSigningJwks(c.env)); }
  catch { throw publicError('signing_keys_unavailable', 'Purchases signing keys are unavailable', 503); }
});

app.post('/internal/v1/jobs', async (c) => {
  const job: unknown = await boundedJson(c.req.raw);
  if (!isBillingQueueJob(job)) throw publicError('billing_job_invalid', 'A supported billing job is required');
  return c.json({ data: await dispatchBillingJob(c.env, job) });
});

app.post('/internal/v1/receipts/verify', async (c) => {
  const request = parseReceiptRequest(await boundedJson(c.req.raw));
  let purchase;
  let finalize: (() => Promise<void>) | null = null;
  if (request.store === 'apple') {
    purchase = (await verifyAppleTransaction(c.env, {
      projectId: request.project_id,
      customerId: request.customer_id,
      signedTransaction: request.signed_transaction!,
      environment: request.environment,
    })).purchase;
  } else {
    const verified = await verifyGooglePurchase(c.env, {
      projectId: request.project_id,
      customerId: request.customer_id,
      purchaseToken: request.purchase_token!,
      storeProductId: request.product_id!,
      productType: request.product_type!,
      environment: request.environment,
    });
    purchase = verified.purchase;
    finalize = () => finalizeGooglePurchase(verified);
  }
  const applied = await applyVerifiedPurchase(c.env, purchase);
  if (finalize) await finalize();
  return c.json({
    transaction_id: applied.transactionId,
    duplicate: applied.duplicate,
    status: purchase.status,
    finish_transaction: purchase.status !== 'pending',
    customer_info: await signedCustomerInfo(c.env, request.project_id, request.customer_id),
  });
});

app.post('/internal/v1/customer-info', async (c) => {
  const body = await boundedJson(c.req.raw) as Record<string, unknown>;
  const projectId = String(body.project_id || '');
  const customerId = String(body.customer_id || '');
  if (!projectId || !customerId) throw publicError('customer_context_invalid', 'project_id and customer_id are required');
  return c.json({ data: await signedCustomerInfo(c.env, projectId, customerId) });
});

app.post('/internal/v1/catalog/sync', async (c) => {
  const body = await boundedJson(c.req.raw) as Record<string, unknown>;
  const projectId = String(body.project_id || '');
  const platform = String(body.platform || '');
  if (!projectId || !['ios', 'android'].includes(platform)) {
    throw publicError('catalog_context_invalid', 'project_id and platform ios or android are required');
  }
  return c.json({ data: await fetchStoreCatalog(c.env, {
    projectId, platform: platform as 'ios' | 'android',
  }) });
});

app.post('/internal/v1/reconcile', async (c) => c.json({ data: await reconcileBillingState(c.env) }));

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId = c.req.header('cf-ray') || crypto.randomUUID();
  if (status >= 500) console.error(JSON.stringify({
    event: 'billing_request_failed', request_id: requestId,
    path: c.req.path, error: error instanceof Error ? error.message : String(error),
  }));
  return c.json({
    code: (error as { code?: string }).code || 'billing_internal_error',
    message: status >= 500 ? 'Billing is temporarily unavailable' : error.message,
    retryable: status >= 500,
    request_id: requestId,
  }, status as 400);
});

async function boundedJson(request: Request): Promise<unknown> {
  let text: string;
  try { text = await readTextLimited(request, 1_048_576, 'Request body is limited to 1 MB'); }
  catch { throw publicError('request_too_large', 'Request body is limited to 1 MB', 413); }
  try { return JSON.parse(text || '{}'); }
  catch { throw publicError('invalid_json', 'Request body must be valid JSON', 400); }
}

async function validateCredentialDecryption(env: Bindings): Promise<boolean> {
  try {
    const [apple, google] = await Promise.all([
      env.DB.prepare('SELECT billing_encrypted_key FROM ios_server_api_keys WHERE billing_encrypted_key IS NOT NULL LIMIT 1')
        .first<{ billing_encrypted_key: string }>(),
      env.DB.prepare('SELECT billing_encrypted_key FROM android_server_api_keys WHERE billing_encrypted_key IS NOT NULL LIMIT 1')
        .first<{ billing_encrypted_key: string }>(),
    ]);
    if (!apple || !google) return false;
    const [appleKey, googleJson] = await Promise.all([
      decryptCredential(env, apple.billing_encrypted_key),
      decryptCredential(env, google.billing_encrypted_key),
    ]);
    const googleKey = JSON.parse(googleJson) as Record<string, unknown>;
    return appleKey.includes('BEGIN PRIVATE KEY')
      && typeof googleKey.client_email === 'string'
      && String(googleKey.private_key || '').includes('BEGIN PRIVATE KEY');
  } catch (error) {
    console.error(JSON.stringify({
      event: 'billing_credential_readiness_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    if (!env.BILLING_QUEUE) return;
    ctx.waitUntil(env.BILLING_QUEUE.send({ type: 'billing.reconcile' }));
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        if (!isBillingQueueJob(message.body)) throw new Error('Unsupported billing queue job');
        const result = await dispatchBillingJob(env, message.body);
        console.log(JSON.stringify({ event: 'billing_job_completed', message_id: message.id, type: message.body.type, result }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({
          event: 'billing_job_failed', message_id: message.id,
          error: error instanceof Error ? error.message : String(error),
        }));
        message.retry({ delaySeconds: 60 });
      }
    }
  },
} satisfies ExportedHandler<Bindings>;
