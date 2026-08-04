import { Hono } from 'hono';
import type { AppVariables, Env } from '../types';
import { applyVerifiedPurchase, offeringsForCustomer, type BillingEnvironment } from '../lib/billing';
import { finalizeGooglePurchase, verifyAppleTransaction, verifyGooglePurchase } from '../lib/store-verification';
import { isPurchasesEnabled } from '../lib/deployment';
import {
  errorEnvelope,
  PAYWALL_EVENT_TYPES,
  purchasesError,
  resolvePurchaseConfiguration,
  type TargetingContext,
} from '../lib/purchases-v2';
import { createWebCheckoutSession, createWebPortalSession, redeemWebPurchase } from '../lib/web-billing';
import {
  billingServiceEnabled,
  callBillingService,
  customerInfoFromBillingAuthority,
  resolveCustomerFromBillingAuthority,
} from '../lib/billing-service';
import { recordDeviceCertificationResult } from '../lib/device-certification';

const sdk = new Hono<{ Bindings: Env; Variables: AppVariables }>();

async function body(c: any): Promise<Record<string, any>> {
  return c.req.json().catch(() => ({}));
}

async function context(c: any) {
  const projectId = c.get('projectId');
  if (!projectId) throw purchasesError('invalid_sdk_project', 'Invalid project for SDK credentials', 403);
  const project = await c.env.DB.prepare(`
    SELECT p.id, COALESCE(p.is_test, p.test, 0) AS is_test,
           COALESCE(s.purchases_enabled, 0) AS purchases_enabled,
           COALESCE(f.purchases_core, 1) AS purchases_core,
           COALESCE(f.paywalls, 1) AS paywalls,
           COALESCE(f.growth, 1) AS growth,
           COALESCE(f.web_billing, 1) AS web_billing,
           COALESCE(f.virtual_currencies, 1) AS virtual_currencies
    FROM projects p
    LEFT JOIN billing_project_settings s ON s.project_id = p.id
    LEFT JOIN billing_feature_flags f ON f.project_id = p.id
    WHERE p.id = ? LIMIT 1
  `).bind(String(projectId)).first() as { id: number; is_test: number; purchases_enabled: number; purchases_core: number; paywalls: number; growth: number; web_billing: number; virtual_currencies: number } | null;
  if (!project) throw purchasesError('invalid_sdk_project', 'Invalid project for SDK credentials', 403);
  if (!isPurchasesEnabled(c.env, project.purchases_enabled)) throw purchasesError('purchases_disabled', 'OpenGrow Purchases is not enabled for this project', 403);
  if (Number(project.purchases_core) !== 1) throw purchasesError('purchases_v2_not_enabled', 'Purchases v2 core is not enabled for this project', 403);
  const resolved = await resolveCustomerFromBillingAuthority(c.env, {
    projectId,
    authorization: c.req.header('Authorization'),
    anonymousId: c.req.header('X-OpenGrow-Anonymous-ID') || undefined,
  });
  return {
    projectId: String(projectId),
    environment: (Number(project.is_test) === 1 ? 'sandbox' : 'production') as BillingEnvironment,
    features: {
      paywalls: Number(project.paywalls) === 1,
      growth: Number(project.growth) === 1,
      webBilling: Number(project.web_billing) === 1,
      virtualCurrencies: Number(project.virtual_currencies) === 1,
    },
    ...resolved,
  };
}

function fail(c: any, error: unknown) {
  const value = error as { status?: number };
  console.error(JSON.stringify({ event: 'purchases_v2_sdk_failed', path: c.req.path, message: (error as Error)?.message || String(error) }));
  return c.json(errorEnvelope(error, c.req.header('cf-ray') || crypto.randomUUID()), value?.status || 422);
}

function requestCountry(c: any) {
  const request = c.req.raw as Request & { cf?: { country?: string } };
  const value = String(request.cf?.country || c.req.header('CF-IPCountry') || '').toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

function targetingContext(c: any, customer: Record<string, unknown>): TargetingContext {
  let attributes: Record<string, unknown> = {};
  try { attributes = JSON.parse(String(customer.attributes || '{}')); } catch {}
  return {
    platform: c.get('sdkPlatform') || c.req.header('PLATFORM'),
    country: requestCountry(c),
    storefront: c.req.header('X-OpenGrow-Storefront'),
    appVersion: c.req.header('X-OpenGrow-App-Version'),
    sdkVersion: c.req.header('X-OpenGrow-SDK-Version'),
    campaign: c.req.header('X-OpenGrow-Campaign'),
    attributes,
  };
}

sdk.get('/configuration', async (c) => {
  try {
    const ctx = await context(c);
    const placement = c.req.query('placement') || 'default';
    const platform = c.get('sdkPlatform') || c.req.header('PLATFORM') || '';
    const resolved = await resolvePurchaseConfiguration(
      c.env.DB,
      ctx.projectId,
      String(ctx.customer.id),
      placement,
      targetingContext(c, ctx.customer),
      { growthEnabled: ctx.features.growth, paywallsEnabled: ctx.features.paywalls },
    );
    const offerings = await offeringsForCustomer(c.env.DB, ctx.projectId, platform, ctx.environment, placement);
    const selected = resolved.offeringIdentifier ? (offerings.all as Record<string, unknown>)[resolved.offeringIdentifier] : offerings.current;
    return c.json({
      schema_version: 2,
      environment: ctx.environment,
      customer_id: String(ctx.customer.id),
      placement: resolved.placement,
      targeting_rule_id: resolved.ruleId,
      experiment_assignment: resolved.assignment,
      offering: selected || null,
      offerings: offerings.all,
      paywall: resolved.paywall,
      fetched_at: new Date().toISOString(),
    }, 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) { return fail(c, error); }
});

sdk.get('/customer-info', async (c) => {
  try {
    const ctx = await context(c);
    return c.json(await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id)), 200, { 'Cache-Control': 'private, no-store' });
  } catch (error) { return fail(c, error); }
});

sdk.post('/receipts', async (c) => {
  try {
    const ctx = await context(c); const data = await body(c);
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<Record<string, unknown>>(c.env, '/internal/v1/receipts/verify', {
        project_id: ctx.projectId,
        customer_id: String(ctx.customer.id),
        environment: ctx.environment,
        store: data.store,
        signed_transaction: data.signed_transaction,
        purchase_token: data.purchase_token,
        product_id: data.product_id,
        product_type: data.product_type,
      });
      return c.json(result);
    }
    let purchase;
    let finalize: (() => Promise<void>) | null = null;
    if (data.store === 'apple') {
      if (!data.signed_transaction) throw purchasesError('receipt_required', 'signed_transaction is required');
      purchase = (await verifyAppleTransaction(c.env, {
        projectId: ctx.projectId,
        customerId: String(ctx.customer.id),
        signedTransaction: String(data.signed_transaction),
        environment: ctx.environment,
      })).purchase;
    } else if (data.store === 'google') {
      if (!data.purchase_token || !data.product_id) throw purchasesError('receipt_required', 'purchase_token and product_id are required');
      const verified = await verifyGooglePurchase(c.env, {
        projectId: ctx.projectId,
        customerId: String(ctx.customer.id),
        purchaseToken: String(data.purchase_token),
        storeProductId: String(data.product_id),
        productType: data.product_type,
        environment: ctx.environment,
      });
      purchase = verified.purchase;
      finalize = () => finalizeGooglePurchase(verified);
    } else {
      throw purchasesError('unsupported_receipt_store', 'Receipts currently support apple and google');
    }
    const result = await applyVerifiedPurchase(c.env, purchase);
    if (finalize) await finalize();
    return c.json({
      transaction_id: result.transactionId,
      duplicate: result.duplicate,
      status: purchase.status,
      finish_transaction: purchase.status !== 'pending',
      customer_info: await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id)),
    });
  } catch (error) { return fail(c, error); }
});

sdk.post('/events', async (c) => {
  try {
    const ctx = await context(c); const data = await body(c);
    const events = Array.isArray(data.events) ? data.events : [data];
    if (events.length < 1 || events.length > 100) throw purchasesError('invalid_event_batch', 'Events batch must contain 1-100 events');
    const eventIds: string[] = [];
    const statements = events.map((event: Record<string, any>, index: number) => {
      if (!PAYWALL_EVENT_TYPES.includes(event.type)) throw purchasesError('invalid_event_type', `Unsupported paywall event: ${event.type}`);
      const id = String(event.id || crypto.randomUUID());
      eventIds[index] = id;
      const occurredAt = event.occurred_at && !Number.isNaN(Date.parse(event.occurred_at)) ? event.occurred_at : new Date().toISOString();
      return c.env.DB.prepare(`
        INSERT OR IGNORE INTO billing_paywall_events (
          id, project_id, customer_id, paywall_id, paywall_version_id, placement_identifier,
          experiment_id, variant_id, event_type, package_identifier, platform, country,
          app_version, sdk_version, metadata, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, ctx.projectId, String(ctx.customer.id), event.paywall_id || null, event.paywall_version_id || null,
        event.placement || null, event.experiment_id || null, event.variant_id || null, event.type,
        event.package_identifier || null, c.get('sdkPlatform') || c.req.header('PLATFORM') || null,
        requestCountry(c), c.req.header('X-OpenGrow-App-Version') || null, c.req.header('X-OpenGrow-SDK-Version') || null,
        JSON.stringify(event.metadata || {}), occurredAt,
      );
    });
    const results = await c.env.DB.batch(statements);
    if (c.env.EVENT_QUEUE) {
      for (const [index, event] of events.entries()) {
        const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? event.metadata as Record<string, unknown>
          : {};
        const sessionId = typeof metadata.session_id === 'string' ? metadata.session_id.trim() : '';
        if (!['closed', 'purchase_cancelled', 'purchase_failed'].includes(String(event.type))
          || !sessionId || sessionId.length > 128) continue;
        c.executionCtx.waitUntil(c.env.EVENT_QUEUE.send({
          type: 'growth.paywall-abandonment.evaluate',
          projectId: ctx.projectId,
          paywallEventId: eventIds[index],
        }, { delaySeconds: 30 }).catch((error) => {
          console.error(JSON.stringify({
            event: 'paywall_growth_projection_queue_failed',
            paywall_event_id: eventIds[index],
            error: error instanceof Error ? error.message : String(error),
          }));
        }));
      }
    }
    return c.json({ accepted: results.reduce((sum: number, item: any) => sum + Number(item.meta.changes || 0), 0), received: events.length }, 202);
  } catch (error) { return fail(c, error); }
});

sdk.post('/certification/device-results', async (c) => {
  try {
    const ctx = await context(c);
    if (!ctx.identified) {
      throw purchasesError(
        'device_certification_identity_required',
        'A verified application identity is required for device certification',
        401,
      );
    }
    const data = await body(c);
    const platform = c.get('sdkPlatform');
    if (!['ios', 'android', 'web'].includes(String(platform))) {
      throw purchasesError('device_certification_platform_invalid', 'iOS, Android, or Web SDK context is required');
    }
    const assertions = data.assertions && typeof data.assertions === 'object' && !Array.isArray(data.assertions)
      ? data.assertions as Record<string, unknown>
      : {};
    const result = await recordDeviceCertificationResult(c.env.DB, {
      id: String(data.id || ''),
      runId: String(data.run_id || ''),
      challenge: String(data.challenge || ''),
      checkKey: String(data.check_key || ''),
      outcome: String(data.outcome || '') as 'passed' | 'failed',
      customerId: String(ctx.customer.id),
      projectId: ctx.projectId,
      sourcePlatform: platform as 'ios' | 'android' | 'web',
      applicationIdentifier: String(c.get('sdkIdentifier') || ''),
      buildNumber: String(data.build_number || c.req.header('X-OpenGrow-Build-Number') || ''),
      appVersion: c.req.header('X-OpenGrow-App-Version') || null,
      sdkVersion: c.req.header('X-OpenGrow-SDK-Version') || null,
      deviceModel: data.device_model == null ? null : String(data.device_model),
      osVersion: data.os_version == null ? null : String(data.os_version),
      assertions,
      observedAt: data.observed_at == null ? null : String(data.observed_at),
    });
    return c.json({ data: result }, result.duplicate ? 200 : 201, {
      'Cache-Control': 'private, no-store',
    });
  } catch (error) { return fail(c, error); }
});

sdk.get('/virtual-currencies', async (c) => {
  try {
    const ctx = await context(c);
    if (!ctx.features.virtualCurrencies) throw purchasesError('virtual_currencies_not_enabled', 'Virtual currencies are not enabled for this project', 403);
    const rows = await c.env.DB.prepare(`
      SELECT vc.code, vc.display_name, vc.description, vc.icon,
        COALESCE(SUM(l.amount), 0) AS balance
      FROM billing_virtual_currencies vc
      LEFT JOIN billing_balance_ledger l ON l.project_id = vc.project_id
        AND l.customer_id = ? AND l.currency_identifier = vc.code
        AND (l.expires_at IS NULL OR datetime(l.expires_at) > datetime('now'))
      WHERE vc.project_id = ? AND vc.active = 1
      GROUP BY vc.id ORDER BY vc.code
    `).bind(String(ctx.customer.id), ctx.projectId).all<Record<string, unknown>>();
    return c.json({
      all: Object.fromEntries((rows.results || []).map((row) => [row.code, {
        code: row.code,
        name: row.display_name,
        description: row.description,
        icon: row.icon,
        balance: Number(row.balance || 0),
      }])),
      fetched_at: new Date().toISOString(),
    });
  } catch (error) { return fail(c, error); }
});

sdk.get('/customer-center', async (c) => {
  try {
    const ctx = await context(c);
    const info = await customerInfoFromBillingAuthority(c.env, ctx.projectId, String(ctx.customer.id));
    const subscriptions = (info.subscriptions || []) as Array<Record<string, any>>;
    return c.json({
      schema_version: 1,
      customer_info: info,
      actions: {
        restore: true,
        purchase_history: true,
        virtual_currencies: true,
        management_url: subscriptions.find((item) => item.management_url)?.management_url || null,
      },
    });
  } catch (error) { return fail(c, error); }
});

sdk.post('/checkout-sessions', async (c) => {
  try {
    const ctx = await context(c); const data = await body(c);
    if (!ctx.features.webBilling) throw purchasesError('web_billing_not_enabled', 'Web Billing is not enabled for this project', 403);
    if (!data.package_identifier || !data.success_url || !data.cancel_url) {
      throw purchasesError('checkout_fields_required', 'package_identifier, success_url and cancel_url are required');
    }
    const idempotencyKey = c.req.header('Idempotency-Key') || data.idempotency_key;
    if (!idempotencyKey) throw purchasesError('idempotency_key_required', 'Idempotency-Key header is required');
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<{ data: Record<string, unknown> }>(c.env, '/internal/v1/web/checkout-sessions', {
        project_id: ctx.projectId,
        customer_id: String(ctx.customer.id),
        package_identifier: String(data.package_identifier),
        offering_identifier: data.offering_identifier ? String(data.offering_identifier) : undefined,
        provider: data.provider ? String(data.provider) : undefined,
        environment: ctx.environment,
        success_url: String(data.success_url),
        cancel_url: String(data.cancel_url),
        idempotency_key: String(idempotencyKey),
      });
      return c.json(result.data);
    }
    return c.json(await createWebCheckoutSession(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      packageIdentifier: String(data.package_identifier),
      offeringIdentifier: data.offering_identifier ? String(data.offering_identifier) : undefined,
      provider: data.provider ? String(data.provider) : undefined,
      environment: ctx.environment,
      successUrl: String(data.success_url),
      cancelUrl: String(data.cancel_url),
      idempotencyKey: String(idempotencyKey),
    }));
  } catch (error) { return fail(c, error); }
});

sdk.post('/portal-sessions', async (c) => {
  try {
    const ctx = await context(c); const data = await body(c);
    if (!ctx.features.webBilling) throw purchasesError('web_billing_not_enabled', 'Web Billing is not enabled for this project', 403);
    if (!data.return_url) throw purchasesError('return_url_required', 'return_url is required');
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<{ data: Record<string, unknown> }>(c.env, '/internal/v1/web/portal-sessions', {
        project_id: ctx.projectId,
        customer_id: String(ctx.customer.id),
        environment: ctx.environment,
        return_url: String(data.return_url),
      });
      return c.json(result.data);
    }
    return c.json(await createWebPortalSession(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      environment: ctx.environment,
      returnUrl: String(data.return_url),
    }));
  } catch (error) { return fail(c, error); }
});

sdk.post('/redemptions', async (c) => {
  try {
    const ctx = await context(c); const data = await body(c);
    if (!ctx.features.webBilling) throw purchasesError('web_billing_not_enabled', 'Web Billing is not enabled for this project', 403);
    if (!data.code) throw purchasesError('redemption_code_required', 'Redemption code is required');
    if (billingServiceEnabled(c.env)) {
      const result = await callBillingService<{ data: Record<string, unknown> }>(c.env, '/internal/v1/web/redemptions', {
        project_id: ctx.projectId,
        customer_id: String(ctx.customer.id),
        code: String(data.code),
      });
      return c.json(result.data);
    }
    return c.json(await redeemWebPurchase(c.env, {
      projectId: ctx.projectId,
      customerId: String(ctx.customer.id),
      code: String(data.code),
    }));
  } catch (error) { return fail(c, error); }
});

export default sdk;
