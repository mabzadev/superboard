import { Hono } from 'hono';
import { AppVariables, Env } from '../types';
import { applyVerifiedPurchase, offeringsForCustomer, type BillingEnvironment } from '../lib/billing';
import { finalizeGooglePurchase, verifyAppleTransaction, verifyGooglePurchase } from '../lib/store-verification';
import { isPurchasesEnabled } from '../lib/deployment';
import {
  billingServiceEnabled,
  callBillingService,
  customerInfoFromBillingAuthority,
  identifyCustomerFromBillingAuthority,
  resolveCustomerFromBillingAuthority,
} from '../lib/billing-service';
import { restoreVerifiedPurchases } from '../lib/billing-restore';
import { readApiJson } from '../lib/request-body';

function brandedHeader(c: any, suffix: string): string | undefined {
  return c.req.header(`X-SuperBoard-${suffix}`) || c.req.header(`X-OpenGrow-${suffix}`);
}

const purchases = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function jsonBody(c: any): Promise<Record<string, any>> {
  return readApiJson(c.req.raw);
}

async function context(c: any) {
  const projectId = c.get('projectId');
  if (!projectId) throw new Error('Invalid project for SDK credentials');
  const project = await c.env.DB.prepare(`
    SELECT p.id, COALESCE(p.is_test, p.test, 0) AS is_test,
           COALESCE(s.purchases_enabled, 0) AS purchases_enabled
    FROM projects p LEFT JOIN billing_project_settings s ON s.project_id = p.id
    WHERE p.id = ? LIMIT 1
  `).bind(String(projectId)).first() as { id: number; is_test: number; purchases_enabled: number } | null;
  if (!project) throw new Error('Invalid project for SDK credentials');
  if (!isPurchasesEnabled(c.env, project.purchases_enabled)) {
    throw new Error('SuperBoard Purchases is not enabled for this project');
  }
  const anonymousId = brandedHeader(c, 'Anonymous-ID');
  const resolved = await resolveCustomerFromBillingAuthority(c.env, {
    projectId,
    authorization: c.req.header('Authorization'),
    anonymousId,
  });
  const environment: BillingEnvironment = Number(project.is_test) === 1 ? 'sandbox' : 'production';
  return { projectId, environment, ...resolved };
}

function purchaseError(c: any, error: unknown) {
  const message = error instanceof Error ? error.message : 'Purchase request failed';
  const status = /required|invalid|incomplete|not configured|not bound/i.test(message) ? 422
    : /blocked|not enabled/i.test(message) ? 403
      : /verification failed|identity token|issuer|JWKS|authenticate/i.test(message) ? 401
        : 500;
  console.error(JSON.stringify({ event: 'purchase_api_failed', path: c.req.path, message }));
  return c.json({ error: message }, status);
}

purchases.get('/offerings', async (c) => {
  try {
    const ctx = await context(c);
    const platform = c.get('sdkPlatform') || c.req.header('PLATFORM') || '';
    if (platform !== 'ios' && platform !== 'android') return c.json({ error: 'iOS or Android platform required' }, 422);
    const placement = c.req.query('placement') || 'default';
    const data = await offeringsForCustomer(c.env.DB, ctx.projectId, platform, ctx.environment, placement);
    return c.json({ ...data, customer_id: String(ctx.customer.id), environment: ctx.environment });
  } catch (error) {
    return purchaseError(c, error);
  }
});

purchases.get('/customer-info', async (c) => {
  try {
    const ctx = await context(c);
    return c.json({ ...(await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id))), customer_id: String(ctx.customer.id) });
  } catch (error) {
    return purchaseError(c, error);
  }
});

purchases.post('/identify', async (c) => {
  try {
    const projectId = c.get('projectId');
    if (!projectId) throw new Error('Invalid project for SDK credentials');
    const body = await jsonBody(c);
    const currentAppUserId = String(body.current_app_user_id || brandedHeader(c, 'Anonymous-ID') || '').trim();
    if (!currentAppUserId) return c.json({ error: 'current_app_user_id is required' }, 422);
    const info = await identifyCustomerFromBillingAuthority(c.env, {
      projectId,
      authorization: c.req.header('Authorization'),
      currentAppUserId,
    });
    return c.json({ ...info, customer_id: String(info.customer_id), created: false });
  } catch (error) {
    return purchaseError(c, error);
  }
});

purchases.post('/apple/transactions', async (c) => {
  try {
    const ctx = await context(c);
    const body = await jsonBody(c);
    if (typeof body.signed_transaction !== 'string' || !body.signed_transaction) {
      return c.json({ error: 'signed_transaction is required' }, 422);
    }
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<Record<string, any>>(c.env, '/internal/v1/receipts/verify', {
        project_id: String(ctx.projectId),
        customer_id: String(ctx.customer.id),
        environment: ctx.environment,
        store: 'apple',
        signed_transaction: body.signed_transaction,
      });
      return c.json({
        result: result.status === 'pending' ? 'pending' : 'purchased',
        finish_transaction: result.finish_transaction,
        transaction_id: result.transaction_id,
        duplicate: result.duplicate,
        customer_info: result.customer_info,
      });
    }
    const verified = await verifyAppleTransaction(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      signedTransaction: body.signed_transaction,
      environment: ctx.environment,
    });
    const result = await applyVerifiedPurchase(c.env, verified.purchase);
    return c.json({
      result: verified.purchase.status === 'pending' ? 'pending' : 'purchased',
      finish_transaction: verified.purchase.status !== 'pending',
      transaction_id: result.transactionId,
      duplicate: result.duplicate,
      customer_info: await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id)),
    });
  } catch (error) {
    return purchaseError(c, error);
  }
});

purchases.post('/google/purchases', async (c) => {
  try {
    const ctx = await context(c);
    const body = await jsonBody(c);
    if (!body.purchase_token || !body.product_id) {
      return c.json({ error: 'purchase_token and product_id are required' }, 422);
    }
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<Record<string, any>>(c.env, '/internal/v1/receipts/verify', {
        project_id: String(ctx.projectId),
        customer_id: String(ctx.customer.id),
        environment: ctx.environment,
        store: 'google',
        purchase_token: String(body.purchase_token),
        product_id: String(body.product_id),
        product_type: body.product_type,
      });
      return c.json({
        result: result.status === 'pending' ? 'pending' : 'purchased',
        finish_transaction: result.finish_transaction,
        transaction_id: result.transaction_id,
        duplicate: result.duplicate,
        customer_info: result.customer_info,
      });
    }
    const verified = await verifyGooglePurchase(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      purchaseToken: String(body.purchase_token),
      storeProductId: String(body.product_id),
      productType: body.product_type,
      environment: ctx.environment,
    });
    const result = await applyVerifiedPurchase(c.env, verified.purchase);
    await finalizeGooglePurchase(verified);
    return c.json({
      result: verified.purchase.status === 'pending' ? 'pending' : 'purchased',
      transaction_id: result.transactionId,
      duplicate: result.duplicate,
      customer_info: await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id)),
    });
  } catch (error) {
    return purchaseError(c, error);
  }
});

async function restore(c: any) {
  try {
    const ctx = await context(c);
    const body = await jsonBody(c);
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<{ data: Record<string, unknown> }>(c.env, '/internal/v1/receipts/restore', {
        project_id: String(ctx.projectId),
        customer_id: String(ctx.customer.id),
        environment: ctx.environment,
        apple_transactions: body.apple_transactions,
        google_purchases: body.google_purchases,
      });
      return c.json(result.data);
    }
    const results = await restoreVerifiedPurchases(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      environment: ctx.environment,
      appleTransactions: body.apple_transactions,
      googlePurchases: body.google_purchases,
    });
    return c.json({
      result: 'purchased',
      restored: results,
      customer_info: await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id)),
    });
  } catch (error) {
    return purchaseError(c, error);
  }
}

purchases.post('/restore', restore);
purchases.post('/sync', restore);

export default purchases;
