import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src/index";
import { applyVerifiedPurchase } from "../../api/src/lib/billing";
import type { BillingRuntimeEnv } from "./apply-migrations";

const projectId = "11";
const anonymousId = "$opengrow_anon_runtime";

describe("Billing authority in the Workers runtime", () => {
  beforeAll(async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(`
        INSERT OR IGNORE INTO instances (id, api_key, uri_scheme)
        VALUES (1, 'runtime-instance-key', 'runtime-app')
      `),
      testEnv.DB.prepare(`
        INSERT OR IGNORE INTO projects (id, name, identifier, instance_id, is_test)
        VALUES (11, 'Runtime project', 'runtime-project', 1, 1)
      `),
    ]);
  });

  it("reports isolated readiness without exposing secret material", async () => {
    const response = await SELF.fetch(
      "https://billing.internal/internal/v1/health",
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain("runtime-test-key-material");
    expect(raw).not.toContain("runtime-test-webhook-secret");
    expect(raw).not.toContain("billing-runtime-es256");

    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(payload).toMatchObject({
      status: "ok",
      service: "opengrow-billing",
      execution: "private-service-binding",
      missing_secrets: [],
      signing_authority_ready: true,
      ready_for_traffic: false,
    });
  });

  it("publishes only the public ES256 verification key", async () => {
    const response = await SELF.fetch(
      "https://billing.internal/internal/v1/jwks",
    );
    expect(response.status).toBe(200);
    const keySet = await response.json<JSONWebKeySet>();
    expect(keySet.keys).toHaveLength(1);
    expect(keySet.keys[0]).toMatchObject({
      alg: "ES256",
      crv: "P-256",
      kid: "billing-runtime-es256",
      key_ops: ["verify"],
      kty: "EC",
      use: "sig",
    });
    expect(keySet.keys[0]).not.toHaveProperty("d");
  });

  it("resolves one durable anonymous customer and signs its CustomerInfo", async () => {
    const first = await resolveCustomer();
    const second = await resolveCustomer();
    expect(second.customer.id).toBe(first.customer.id);
    expect(first).toMatchObject({ appUserId: anonymousId, identified: false });

    const infoResponse = await jsonRequest("/internal/v1/customer-info", {
      project_id: projectId,
      customer_id: first.customer.id,
    });
    expect(infoResponse.status).toBe(200);
    const infoPayload = await infoResponse.json<{
      data: {
        original_app_user_id: string;
        signature: string;
        signature_algorithm: string;
        signature_key_id: string;
      };
    }>();
    expect(infoPayload.data).toMatchObject({
      original_app_user_id: anonymousId,
      signature_algorithm: "ES256",
      signature_key_id: "billing-runtime-es256",
    });

    const jwksResponse = await SELF.fetch(
      "https://billing.internal/internal/v1/jwks",
    );
    const keySet = await jwksResponse.json<JSONWebKeySet>();
    const verified = await jwtVerify(
      infoPayload.data.signature,
      createLocalJWKSet(keySet),
      {
        audience: "opengrow-sdk",
        issuer: "opengrow-purchases",
        subject: anonymousId,
      },
    );
    expect(verified.payload).toMatchObject({
      project_id: projectId,
      customer_info: {
        customer_id: first.customer.id,
        original_app_user_id: anonymousId,
      },
    });

    const rows = await (env as BillingRuntimeEnv).DB.prepare(
      `
      SELECT COUNT(*) AS total FROM billing_customers
      WHERE project_id = ? AND primary_app_user_id = ?
    `,
    )
      .bind(projectId, anonymousId)
      .first<{ total: number }>();
    expect(rows?.total).toBe(1);
  });

  it("persists a provider event once before queue delivery", async () => {
    const request = {
      project_id: projectId,
      store: "google",
      environment: "sandbox",
      external_event_id: "evt-runtime-idempotent",
      event_type: "SUBSCRIPTION_RENEWED",
      payload: JSON.stringify({ id: "evt-runtime-idempotent" }),
      job: {
        type: "billing.google.notification",
        projectId,
        purchaseToken: "runtime-purchase-token",
        productId: "runtime-product-id",
        productType: "subscription",
        eventType: "SUBSCRIPTION_RENEWED",
        eventOccurredAt: "2026-08-04T08:00:00.000Z",
        environment: "sandbox",
      },
    };
    const firstResponse = await jsonRequest(
      "/internal/v1/provider-events/ingest",
      request,
    );
    const secondResponse = await jsonRequest(
      "/internal/v1/provider-events/ingest",
      request,
    );
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const first = await firstResponse.json<{ data: ProviderIngressResult }>();
    const second = await secondResponse.json<{ data: ProviderIngressResult }>();
    expect(first.data).toMatchObject({
      duplicate: false,
      queued: true,
      processed: false,
    });
    expect(second.data).toMatchObject({
      duplicate: true,
      queued: true,
      processed: false,
    });
    expect(second.data.event_id).toBe(first.data.event_id);

    const row = await (env as BillingRuntimeEnv).DB.prepare(
      `
      SELECT COUNT(*) AS total, MIN(status) AS status
      FROM billing_webhook_events
      WHERE project_id = ? AND store = 'google' AND environment = 'sandbox'
        AND external_event_id = 'evt-runtime-idempotent'
    `,
    )
      .bind(projectId)
      .first<{ total: number; status: string }>();
    expect(row).toEqual({ total: 1, status: "received" });
  });

  it("retries unsupported queue messages instead of losing them", async () => {
    const batch = createMessageBatch(billingQueueName(), [
      {
        id: "unsupported-runtime-job",
        timestamp: new Date(),
        attempts: 1,
        body: { type: "unsupported" },
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([
      { msgId: "unsupported-runtime-job" },
    ]);
  });

  it("quarantines dead-letter jobs durably before acknowledging them", async () => {
    const body = { type: "billing.google.voided.reconcile", projectId };
    const batch = createMessageBatch(billingDlqName(), [
      {
        id: "dead-letter-runtime-job",
        timestamp: new Date(),
        attempts: 8,
        body,
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["dead-letter-runtime-job"]);
    expect(result.retryMessages).toEqual([]);

    const row = await (env as BillingRuntimeEnv).DB.prepare(
      `
      SELECT project_id, queue_name, job_type, job_payload, job_payload_sha256,
        job_valid, delivery_attempts, status
      FROM billing_dead_letters WHERE id = 'dead-letter-runtime-job'
    `,
    ).first<{
      project_id: string;
      queue_name: string;
      job_type: string;
      job_payload: string;
      job_payload_sha256: string;
      job_valid: number;
      delivery_attempts: number;
      status: string;
    }>();
    expect(row).toMatchObject({
      project_id: projectId,
      queue_name: billingDlqName(),
      job_type: body.type,
      job_payload: JSON.stringify(body),
      job_valid: 1,
      delivery_attempts: 8,
      status: "quarantined",
    });
    expect(row?.job_payload_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("quarantines terminal financial failures before acknowledging them", async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers (id, project_id, primary_app_user_id)
        VALUES ('terminal-customer', ?, 'terminal-customer')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_products (
          id, project_id, store, environment, store_product_id, product_type
        ) VALUES (
          'terminal-product', ?, 'google', 'sandbox',
          'terminal-product', 'subscription'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_subscriptions (
          id, project_id, customer_id, product_id, store, environment,
          original_transaction_id, status
        ) VALUES (
          'terminal-subscription', ?, 'terminal-customer', 'terminal-product',
          'google', 'sandbox', 'terminal-transaction', 'active'
        )
      `,
      ).bind(projectId),
    ]);
    const body = {
      type: "billing.subscription.reconcile",
      subscriptionId: "terminal-subscription",
    } as const;
    const batch = createMessageBatch(billingQueueName(), [
      {
        id: "terminal-runtime-job",
        timestamp: new Date(),
        attempts: 1,
        body,
      },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toEqual(["terminal-runtime-job"]);
    expect(result.retryMessages).toEqual([]);

    const row = await testEnv.DB.prepare(
      `
      SELECT project_id, queue_name, job_type, job_valid, status
      FROM billing_dead_letters WHERE id = 'terminal-runtime-job'
    `,
    ).first<Record<string, unknown>>();
    expect(row).toEqual({
      project_id: projectId,
      queue_name: `${billingQueueName()}:terminal`,
      job_type: body.type,
      job_valid: 1,
      status: "quarantined",
    });
  });

  it("claims and closes an inactive entitlement delivery without retrying it", async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO billing_webhook_endpoints (
          id, project_id, name, url, signing_secret_encrypted,
          environments, event_types, active
        ) VALUES (
          'runtime-inactive-endpoint', ?, 'Inactive projection',
          'https://api.example.com/webhooks/opengrow/entitlements',
          'env:OPENGROW_ENTITLEMENT_WEBHOOK_SECRET', '["sandbox"]',
          '["customer.entitlement.changed"]', 0
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(`
        INSERT INTO billing_webhook_deliveries (
          id, endpoint_id, event_type, payload
        ) VALUES (
          'runtime-inactive-delivery', 'runtime-inactive-endpoint',
          'customer.entitlement.changed', '{"id":"runtime-inactive-delivery"}'
        )
      `),
    ]);

    const response = await jsonRequest("/internal/v1/jobs", {
      type: "billing.webhook.deliver",
      deliveryId: "runtime-inactive-delivery",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { skipped: true, status: "inactive" },
    });

    const delivery = await testEnv.DB.prepare(
      `
      SELECT status, attempts, error_message, claim_token, claim_expires_at
      FROM billing_webhook_deliveries WHERE id = 'runtime-inactive-delivery'
    `,
    ).first<Record<string, unknown>>();
    expect(delivery).toEqual({
      status: "skipped",
      attempts: 0,
      error_message: "Webhook endpoint is inactive",
      claim_token: null,
      claim_expires_at: null,
    });
  });

  it("transfers only the restored purchase chain and preserves unrelated customers", async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers (id, project_id, primary_app_user_id)
        VALUES ('transfer-old', ?, 'transfer-old')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers (id, project_id, primary_app_user_id)
        VALUES ('transfer-new', ?, 'transfer-new')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers (id, project_id, primary_app_user_id)
        VALUES ('transfer-unrelated', ?, 'transfer-unrelated')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_products (
          id, project_id, store, environment, store_product_id, product_type
        ) VALUES (
          'transfer-product', ?, 'google', 'sandbox',
          'premium-weekly-transfer', 'subscription'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_entitlements (id, project_id, identifier, display_name)
        VALUES ('transfer-premium', ?, 'premium', 'Premium')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(`
        INSERT INTO billing_product_entitlements (product_id, entitlement_id)
        VALUES ('transfer-product', 'transfer-premium')
      `),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customer_entitlements (
          project_id, customer_id, entitlement_id, product_id, source, status,
          expires_at, verification
        ) VALUES (?, 'transfer-old', 'transfer-premium', 'transfer-product',
          'purchase', 'active', '2030-01-01T00:00:00.000Z', 'verified')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customer_entitlements (
          project_id, customer_id, entitlement_id, product_id, source, status,
          expires_at, verification
        ) VALUES (?, 'transfer-unrelated', 'transfer-premium', 'transfer-product',
          'purchase', 'active', '2030-01-01T00:00:00.000Z', 'verified')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_subscriptions (
          id, project_id, customer_id, product_id, store, environment,
          original_transaction_id, status, latest_event_at
        ) VALUES (
          'transfer-old-subscription', ?, 'transfer-old', 'transfer-product',
          'google', 'sandbox', 'transfer-chain', 'active',
          '2026-08-03T10:00:00.000Z'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_subscriptions (
          id, project_id, customer_id, product_id, store, environment,
          original_transaction_id, status, latest_event_at
        ) VALUES (
          'transfer-unrelated-subscription', ?, 'transfer-unrelated',
          'transfer-product', 'google', 'sandbox', 'unrelated-chain', 'active',
          '2026-08-03T10:00:00.000Z'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_webhook_endpoints (
          id, project_id, name, url, signing_secret_encrypted,
          environments, event_types, active
        ) VALUES (
          'transfer-projection-endpoint', ?, 'Transfer projection',
          'https://api.example.com/webhooks/opengrow/entitlements',
          'env:OPENGROW_ENTITLEMENT_WEBHOOK_SECRET', '["sandbox"]',
          '["customer.entitlement.changed"]', 1
        )
      `,
      ).bind(projectId),
    ]);

    const restoredPurchase = {
      projectId,
      customerId: "transfer-new",
      store: "google",
      environment: "sandbox",
      storeProductId: "premium-weekly-transfer",
      productType: "subscription",
      storeTransactionId: "transfer-event-new",
      originalTransactionId: "transfer-chain",
      eventType: "RESTORED",
      status: "active",
      purchasedAt: "2026-08-04T10:00:00.000Z",
      expiresAt: "2030-01-01T00:00:00.000Z",
      eventOccurredAt: "2026-08-04T10:00:00.000Z",
      autoRenews: true,
      quantity: 1,
      transfer: true,
      rawPayload: { provider_verified: true },
    } as const;
    await applyVerifiedPurchase(testEnv, restoredPurchase);

    const entitlements = await testEnv.DB.prepare(
      `
      SELECT customer_id FROM billing_customer_entitlements
      WHERE product_id = 'transfer-product' AND status = 'active'
      ORDER BY customer_id
    `,
    ).all<{ customer_id: string }>();
    expect(entitlements.results).toEqual([
      { customer_id: "transfer-new" },
      { customer_id: "transfer-unrelated" },
    ]);
    const subscription = await testEnv.DB.prepare(
      `
      SELECT customer_id FROM billing_subscriptions
      WHERE project_id = ? AND store = 'google' AND environment = 'sandbox'
        AND original_transaction_id = 'transfer-chain'
    `,
    )
      .bind(projectId)
      .first<{ customer_id: string }>();
    expect(subscription?.customer_id).toBe("transfer-new");

    const transaction = await testEnv.DB.prepare(
      `
      SELECT id FROM billing_transactions
      WHERE project_id = ? AND store = 'google' AND environment = 'sandbox'
        AND store_transaction_id = 'transfer-event-new' AND event_type = 'RESTORED'
    `,
    )
      .bind(projectId)
      .first<{ id: string }>();
    expect(transaction?.id).toBeTruthy();
    const projectionCount = async (customerId: string) => {
      const row = await testEnv.DB.prepare(
        `
        SELECT COUNT(*) AS total FROM billing_webhook_deliveries
        WHERE transaction_id = ? AND event_type = 'customer.entitlement.changed'
          AND customer_id = ?
      `,
      )
        .bind(transaction!.id, customerId)
        .first<{ total: number }>();
      return Number(row?.total || 0);
    };
    expect(await projectionCount("transfer-new")).toBe(1);
    expect(await projectionCount("transfer-old")).toBe(1);

    await testEnv.DB.prepare(
      `
      DELETE FROM billing_webhook_deliveries
      WHERE transaction_id = ? AND customer_id = 'transfer-new'
    `,
    )
      .bind(transaction!.id)
      .run();
    await applyVerifiedPurchase(testEnv, restoredPurchase);
    expect(await projectionCount("transfer-new")).toBe(1);
  });

  it("keeps an entitlement active while any verified purchase source remains active", async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers (id, project_id, primary_app_user_id)
        VALUES ('multi-source-customer', ?, 'multi-source-customer')
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_products (
          id, project_id, store, environment, store_product_id, product_type
        ) VALUES (
          'multi-source-apple', ?, 'apple', 'sandbox',
          'premium-yearly-multi-source', 'subscription'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_products (
          id, project_id, store, environment, store_product_id, product_type
        ) VALUES (
          'multi-source-google', ?, 'google', 'sandbox',
          'premium-weekly-multi-source', 'subscription'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(`
        INSERT INTO billing_product_entitlements (product_id, entitlement_id)
        VALUES ('multi-source-apple', 'transfer-premium')
      `),
      testEnv.DB.prepare(`
        INSERT INTO billing_product_entitlements (product_id, entitlement_id)
        VALUES ('multi-source-google', 'transfer-premium')
      `),
    ]);

    await applyVerifiedPurchase(testEnv, {
      projectId,
      customerId: "multi-source-customer",
      store: "apple",
      environment: "sandbox",
      storeProductId: "premium-yearly-multi-source",
      productType: "subscription",
      storeTransactionId: "multi-source-apple-purchase",
      originalTransactionId: "multi-source-apple-chain",
      eventType: "SUBSCRIBED",
      status: "active",
      purchasedAt: "2026-08-04T10:00:00.000Z",
      expiresAt: "2031-08-04T10:00:00.000Z",
      eventOccurredAt: "2026-08-04T10:00:00.000Z",
      autoRenews: true,
      quantity: 1,
      rawPayload: { provider_verified: true },
    });
    await applyVerifiedPurchase(testEnv, {
      projectId,
      customerId: "multi-source-customer",
      store: "google",
      environment: "sandbox",
      storeProductId: "premium-weekly-multi-source",
      productType: "subscription",
      storeTransactionId: "multi-source-google-active",
      originalTransactionId: "multi-source-google-chain",
      eventType: "SUBSCRIPTION_RENEWED",
      status: "active",
      purchasedAt: "2026-08-04T11:00:00.000Z",
      expiresAt: "2030-08-04T11:00:00.000Z",
      eventOccurredAt: "2026-08-04T11:00:00.000Z",
      autoRenews: true,
      quantity: 1,
      rawPayload: { provider_verified: true },
    });
    const expired = await applyVerifiedPurchase(testEnv, {
      projectId,
      customerId: "multi-source-customer",
      store: "google",
      environment: "sandbox",
      storeProductId: "premium-weekly-multi-source",
      productType: "subscription",
      storeTransactionId: "multi-source-google-expired",
      originalTransactionId: "multi-source-google-chain",
      eventType: "SUBSCRIPTION_EXPIRED",
      status: "expired",
      purchasedAt: "2026-08-04T11:00:00.000Z",
      expiresAt: "2026-08-04T12:00:00.000Z",
      eventOccurredAt: "2026-08-05T12:00:00.000Z",
      autoRenews: false,
      quantity: 1,
      rawPayload: { provider_verified: true },
    });

    const entitlement = await testEnv.DB.prepare(
      `
      SELECT product_id, status, expires_at, will_renew
      FROM billing_customer_entitlements
      WHERE customer_id = 'multi-source-customer'
        AND entitlement_id = 'transfer-premium' AND source = 'purchase'
    `,
    ).first<Record<string, unknown>>();
    expect(entitlement).toEqual({
      product_id: "multi-source-apple",
      status: "active",
      expires_at: "2031-08-04T10:00:00.000Z",
      will_renew: 1,
    });
    const projection = await testEnv.DB.prepare(
      `
      SELECT payload FROM billing_webhook_deliveries
      WHERE transaction_id = ? AND customer_id = 'multi-source-customer'
        AND event_type = 'customer.entitlement.changed'
      ORDER BY created_at DESC LIMIT 1
    `,
    )
      .bind(expired.transactionId)
      .first<{ payload: string }>();
    expect(JSON.parse(projection!.payload)).toMatchObject({
      data: { premium: true, subscription: true },
    });
  });

  it("returns stable public errors for malformed requests", async () => {
    const response = await SELF.fetch(
      "https://billing.internal/internal/v1/customers/resolve",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "cf-ray": "runtime-request-id",
        },
        body: "{",
      },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "invalid_json",
      message: "Request body must be valid JSON",
      retryable: false,
      request_id: "runtime-request-id",
    });
  });

  it("pseudonymizes billing identity while retaining financial truth", async () => {
    const testEnv = env as BillingRuntimeEnv;
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customers
          (id, project_id, primary_app_user_id, anonymous, attributes)
        VALUES (
          'erasure-billing-customer', ?, 'erasure-billing-user', 1,
          '{"email":"private@example.test","locale":"fr"}'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_customer_aliases
          (id, project_id, customer_id, app_user_id)
        VALUES (
          'erasure-billing-alias', ?, 'erasure-billing-customer',
          'erasure-billing-alias-user'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_transactions (
          id, project_id, customer_id, store, environment,
          store_transaction_id, event_type, status, raw_payload
        ) VALUES (
          'erasure-billing-transaction', ?, 'erasure-billing-customer',
          'apple', 'sandbox', 'erasure-store-transaction', 'PURCHASED',
          'active', '{"email":"private@example.test","receipt":"secret"}'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_events (
          id, project_id, customer_id, provider, environment,
          external_event_id, event_type, occurred_at, payload, error_message
        ) VALUES (
          'erasure-billing-event', ?, 'erasure-billing-customer',
          'apple', 'sandbox', 'erasure-provider-event', 'PURCHASED',
          '2026-08-08T12:00:00.000Z',
          '{"email":"private@example.test"}', 'private provider detail'
        )
      `,
      ).bind(projectId),
      testEnv.DB.prepare(
        `
        INSERT INTO billing_paywall_events (
          id, project_id, customer_id, event_type, country, metadata, occurred_at
        ) VALUES (
          'erasure-paywall-event', ?, 'erasure-billing-customer',
          'impression', 'CH', '{"campaign":"private"}',
          '2026-08-08T12:00:00.000Z'
        )
      `,
      ).bind(projectId),
    ]);

    const unauthorized = await SELF.fetch(
      "https://billing.internal/internal/v1/customers/erase",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          application_user_id: "erasure-billing-user",
        }),
      },
    );
    expect(unauthorized.status).toBe(401);

    const eraseRequest = () =>
      SELF.fetch("https://billing.internal/internal/v1/customers/erase", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "billing-runtime-internal-token",
        },
        body: JSON.stringify({
          project_id: projectId,
          application_user_id: "erasure-billing-user",
        }),
      });
    const erased = await eraseRequest();
    expect(erased.status, await erased.clone().text()).toBe(200);
    await expect(erased.json()).resolves.toEqual({
      data: {
        erased: true,
        customers_redacted: 1,
        transactions_redacted: 1,
        events_redacted: 2,
      },
    });
    const repeated = await eraseRequest();
    await expect(repeated.json()).resolves.toEqual({
      data: { erased: true, customers_redacted: 0 },
    });

    const [customer, aliases, transaction, event, paywall] =
      await testEnv.DB.batch([
        testEnv.DB.prepare(`
          SELECT primary_app_user_id, anonymous, blocked, attributes
          FROM billing_customers WHERE id = 'erasure-billing-customer'
        `),
        testEnv.DB.prepare(`
          SELECT COUNT(*) total FROM billing_customer_aliases
          WHERE customer_id = 'erasure-billing-customer'
        `),
        testEnv.DB.prepare(`
          SELECT raw_payload FROM billing_transactions
          WHERE id = 'erasure-billing-transaction'
        `),
        testEnv.DB.prepare(`
          SELECT payload, error_message FROM billing_events
          WHERE id = 'erasure-billing-event'
        `),
        testEnv.DB.prepare(`
          SELECT country, metadata FROM billing_paywall_events
          WHERE id = 'erasure-paywall-event'
        `),
      ]);
    expect(customer.results[0]).toMatchObject({
      primary_app_user_id: expect.stringMatching(/^erased:[a-f0-9]{32}$/u),
      anonymous: 0,
      blocked: 1,
      attributes: "{}",
    });
    expect(aliases.results[0]).toMatchObject({ total: 0 });
    expect(transaction.results[0]).toMatchObject({ raw_payload: "{}" });
    expect(event.results[0]).toMatchObject({
      payload: "{}",
      error_message: null,
    });
    expect(paywall.results[0]).toMatchObject({ country: null, metadata: "{}" });
  });
});

function billingQueueName() {
  return String((env as BillingRuntimeEnv).BILLING_QUEUE_NAME);
}

function billingDlqName() {
  return String((env as BillingRuntimeEnv).BILLING_DLQ_NAME);
}

type ProviderIngressResult = {
  event_id: string;
  duplicate: boolean;
  queued: boolean;
  processed: boolean;
};

async function resolveCustomer() {
  const response = await jsonRequest("/internal/v1/customers/resolve", {
    project_id: projectId,
    anonymous_id: anonymousId,
  });
  expect(response.status).toBe(200);
  const payload = await response.json<{
    data: {
      customer: { id: string };
      appUserId: string;
      identified: boolean;
    };
  }>();
  return payload.data;
}

function jsonRequest(path: string, body: Record<string, unknown>) {
  return SELF.fetch(`https://billing.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
