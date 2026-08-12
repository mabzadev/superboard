import type { BillingEnv } from "../types";
import { entitlementIsActive } from "./billing-state";
import { recordCanonicalBillingEvent } from "./purchases-v2";
import { recordRefundCaseForPurchase } from "./refunds";
import {
  ANALYTICS_CANONICAL_EVENTS,
  type AnalyticsEventV1,
  type VerifiedPurchaseEventType,
} from "@superboard/contracts/analytics";
import {
  canonicalAnalyticsEventId,
  deliverAnalyticsFact,
  enqueueAnalyticsFactStatement,
} from "./analytics-facts";

export const BILLING_STATUSES = [
  "pending",
  "trialing",
  "active",
  "grace_period",
  "billing_issue",
  "paused",
  "cancelled",
  "expired",
  "revoked",
  "refunded",
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];
export type BillingStore = "apple" | "google" | "promotional";
export type BillingEnvironment = "sandbox" | "production";

export type VerifiedPurchase = {
  projectId: string | number;
  applicationId?: string | number | null;
  customerId?: string | null;
  store: Exclude<BillingStore, "promotional">;
  environment: BillingEnvironment;
  storeProductId: string;
  productType: "subscription" | "non_consumable" | "consumable";
  storeTransactionId: string;
  originalTransactionId?: string | null;
  orderId?: string | null;
  purchaseToken?: string | null;
  eventType: string;
  status: BillingStatus;
  priceMicros?: number | null;
  currency?: string | null;
  quantity?: number;
  purchasedAt?: string | null;
  eventOccurredAt?: string | null;
  expiresAt?: string | null;
  autoRenews?: boolean;
  periodType?: "normal" | "trial" | "intro";
  rawPayload: unknown;
  transfer?: boolean;
};

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export async function findCustomerByAppUserId(
  db: D1Database,
  projectId: string | number,
  appUserId: string,
) {
  return db
    .prepare(
      `
    SELECT c.*
    FROM billing_customer_aliases a
    JOIN billing_customers c ON c.id = a.customer_id
    WHERE a.project_id = ? AND a.app_user_id = ?
    LIMIT 1
  `,
    )
    .bind(String(projectId), appUserId)
    .first<Record<string, unknown>>();
}

export async function getOrCreateCustomer(
  db: D1Database,
  projectId: string | number,
  appUserId: string,
  anonymous: boolean,
) {
  const normalized = appUserId.trim();
  if (!normalized || normalized.length > 255)
    throw new Error("Invalid app user ID");
  const existing = await findCustomerByAppUserId(db, projectId, normalized);
  if (existing) {
    await db
      .prepare(
        'UPDATE billing_customers SET last_seen_at = datetime("now"), updated_at = datetime("now") WHERE id = ?',
      )
      .bind(existing.id)
      .run();
    return existing;
  }
  const customerId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `
      INSERT INTO billing_customers (id, project_id, primary_app_user_id, anonymous)
      VALUES (?, ?, ?, ?)
    `,
      )
      .bind(customerId, String(projectId), normalized, anonymous ? 1 : 0),
    db
      .prepare(
        `
      INSERT INTO billing_customer_aliases (project_id, customer_id, app_user_id, alias_type)
      VALUES (?, ?, ?, ?)
    `,
      )
      .bind(
        String(projectId),
        customerId,
        normalized,
        anonymous ? "anonymous" : "identified",
      ),
  ]);
  return db
    .prepare("SELECT * FROM billing_customers WHERE id = ?")
    .bind(customerId)
    .first<Record<string, unknown>>();
}

export async function identifyCustomer(
  db: D1Database,
  projectId: string | number,
  currentAppUserId: string,
  targetAppUserId: string,
) {
  const source = await getOrCreateCustomer(
    db,
    projectId,
    currentAppUserId,
    currentAppUserId.startsWith("$opengrow_anon_"),
  );
  const target =
    (await findCustomerByAppUserId(db, projectId, targetAppUserId)) ||
    (await getOrCreateCustomer(db, projectId, targetAppUserId, false));
  if (!source || !target) throw new Error("Unable to identify customer");
  if (source.id === target.id) return target;

  const targetAnonymous = Number(target.anonymous) === 1;
  const sourceAnonymous = Number(source.anonymous) === 1;
  const destination = targetAnonymous && !sourceAnonymous ? source : target;
  const merged = destination.id === source.id ? target : source;

  await db.batch([
    db
      .prepare(
        "UPDATE OR IGNORE billing_customer_aliases SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE billing_transactions SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE billing_subscriptions SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE billing_events SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE billing_paywall_events SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE OR IGNORE billing_experiment_assignments SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "DELETE FROM billing_experiment_assignments WHERE customer_id = ?",
      )
      .bind(merged.id),
    db
      .prepare(
        "UPDATE OR IGNORE billing_customer_entitlements SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "UPDATE billing_balance_ledger SET customer_id = ? WHERE customer_id = ?",
      )
      .bind(destination.id, merged.id),
    db
      .prepare(
        "DELETE FROM billing_customer_entitlements WHERE customer_id = ?",
      )
      .bind(merged.id),
    db.prepare("DELETE FROM billing_customers WHERE id = ?").bind(merged.id),
    db
      .prepare(
        `
      UPDATE billing_customers
      SET primary_app_user_id = ?, anonymous = 0, last_seen_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `,
      )
      .bind(targetAppUserId, destination.id),
  ]);
  return db
    .prepare("SELECT * FROM billing_customers WHERE id = ?")
    .bind(destination.id)
    .first<Record<string, unknown>>();
}

async function getOrCreateProduct(db: D1Database, purchase: VerifiedPurchase) {
  const existing = await db
    .prepare(
      `
    SELECT * FROM billing_products
    WHERE project_id = ? AND store = ? AND environment = ? AND store_product_id = ?
    LIMIT 1
  `,
    )
    .bind(
      String(purchase.projectId),
      purchase.store,
      purchase.environment,
      purchase.storeProductId,
    )
    .first<Record<string, unknown>>();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `
    INSERT INTO billing_products (
      id, project_id, application_id, store, environment, store_product_id, product_type, display_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .bind(
      id,
      String(purchase.projectId),
      purchase.applicationId ? String(purchase.applicationId) : null,
      purchase.store,
      purchase.environment,
      purchase.storeProductId,
      purchase.productType,
      purchase.storeProductId,
    )
    .run();
  return db
    .prepare("SELECT * FROM billing_products WHERE id = ?")
    .bind(id)
    .first<Record<string, unknown>>();
}

type EntitlementCandidate = {
  product_id: string;
  status: string;
  starts_at: string | null;
  expires_at: string | null;
  will_renew: number;
  observed_at: string | null;
};

async function projectCustomerEntitlement(
  db: D1Database,
  params: {
    projectId: string;
    customerId: string;
    entitlementId: string;
    fallbackProductId: string;
    fallbackStartsAt?: string | null;
    fallbackExpiresAt?: string | null;
  },
) {
  const candidates = await db
    .prepare(
      `
    WITH latest_non_consumables AS (
      SELECT t.product_id, t.status, t.purchased_at AS starts_at, t.expires_at,
        0 AS will_renew, t.event_occurred_at AS observed_at,
        ROW_NUMBER() OVER (
          PARTITION BY t.project_id, t.store, t.environment, t.original_transaction_id
          ORDER BY datetime(COALESCE(t.event_occurred_at, t.verified_at)) DESC, t.id DESC
        ) AS event_rank
      FROM billing_transactions t
      JOIN billing_products p ON p.id = t.product_id AND p.product_type = 'non_consumable'
      JOIN billing_product_entitlements pe
        ON pe.product_id = t.product_id AND pe.entitlement_id = ?
      WHERE t.project_id = ? AND t.customer_id = ?
    )
    SELECT s.product_id, s.status, s.starts_at, s.expires_at, s.will_renew,
      COALESCE(s.latest_event_at, s.updated_at) AS observed_at
    FROM billing_subscriptions s
    JOIN billing_product_entitlements pe
      ON pe.product_id = s.product_id AND pe.entitlement_id = ?
    WHERE s.project_id = ? AND s.customer_id = ?
    UNION ALL
    SELECT product_id, status, starts_at, expires_at, will_renew, observed_at
    FROM latest_non_consumables WHERE event_rank = 1
  `,
    )
    .bind(
      params.entitlementId,
      params.projectId,
      params.customerId,
      params.entitlementId,
      params.projectId,
      params.customerId,
    )
    .all<EntitlementCandidate>();
  const activeCandidates = (candidates.results || [])
    .filter((candidate) =>
      entitlementIsActive(candidate.status, candidate.expires_at),
    )
    .sort((left, right) => {
      const leftExpiry = left.expires_at
        ? Date.parse(left.expires_at)
        : Number.POSITIVE_INFINITY;
      const rightExpiry = right.expires_at
        ? Date.parse(right.expires_at)
        : Number.POSITIVE_INFINITY;
      if (leftExpiry !== rightExpiry) return rightExpiry - leftExpiry;
      return (
        Date.parse(right.observed_at || "") - Date.parse(left.observed_at || "")
      );
    });
  const selected = activeCandidates[0];
  await db
    .prepare(
      `
    INSERT INTO billing_customer_entitlements (
      project_id, customer_id, entitlement_id, product_id, source, status,
      starts_at, expires_at, will_renew, verification
    ) VALUES (?, ?, ?, ?, 'purchase', ?, COALESCE(?, datetime('now')), ?, ?, 'verified')
    ON CONFLICT(customer_id, entitlement_id, source) DO UPDATE SET
      product_id = excluded.product_id,
      status = excluded.status,
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      will_renew = excluded.will_renew,
      verification = 'verified',
      updated_at = datetime('now')
  `,
    )
    .bind(
      params.projectId,
      params.customerId,
      params.entitlementId,
      selected?.product_id || params.fallbackProductId,
      selected?.status || "inactive",
      selected?.starts_at || params.fallbackStartsAt || null,
      selected?.expires_at || params.fallbackExpiresAt || null,
      selected ? Number(selected.will_renew || 0) : 0,
    )
    .run();
}

async function syncEntitlements(
  db: D1Database,
  purchase: VerifiedPurchase,
  productId: string,
) {
  if (!purchase.customerId || purchase.productType === "consumable")
    return [] as string[];
  const mappings = await db
    .prepare(
      `
    SELECT e.id
    FROM billing_product_entitlements pe
    JOIN billing_entitlements e ON e.id = pe.entitlement_id
    WHERE pe.product_id = ? AND e.active = 1
  `,
    )
    .bind(productId)
    .all<{ id: string }>();
  for (const entitlement of mappings.results || []) {
    await projectCustomerEntitlement(db, {
      projectId: String(purchase.projectId),
      customerId: purchase.customerId,
      entitlementId: entitlement.id,
      fallbackProductId: productId,
      fallbackStartsAt: purchase.purchasedAt,
      fallbackExpiresAt: purchase.expiresAt,
    });
  }
  return (mappings.results || []).map((entitlement) => entitlement.id);
}

async function creditProductCurrencies(
  db: D1Database,
  purchase: VerifiedPurchase,
  product: Record<string, unknown>,
  transactionId: string,
) {
  if (!purchase.customerId || !["active", "trialing"].includes(purchase.status))
    return;
  const configured = await db
    .prepare(
      `
    SELECT vc.code, vcp.grant_amount, vcp.trial_grant_amount, vcp.grant_cadence,
      vcp.expires_after_seconds
    FROM billing_virtual_currency_products vcp
    JOIN billing_virtual_currencies vc ON vc.id = vcp.currency_id AND vc.active = 1
    WHERE vcp.product_id = ?
  `,
    )
    .bind(String(product.id))
    .all<Record<string, unknown>>();
  if ((configured.results || []).length > 0) {
    for (const currency of configured.results || []) {
      const cadence = String(currency.grant_cadence || "purchase");
      if (cadence === "renewal" && !/renew/i.test(purchase.eventType)) continue;
      if (cadence === "initial" && /renew/i.test(purchase.eventType)) continue;
      const baseAmount =
        purchase.status === "trialing" && currency.trial_grant_amount != null
          ? Number(currency.trial_grant_amount)
          : Number(currency.grant_amount || 0);
      const units = baseAmount * Math.max(1, purchase.quantity || 1);
      if (!Number.isSafeInteger(units) || units <= 0) continue;
      const expiresAt =
        Number(currency.expires_after_seconds || 0) > 0
          ? new Date(
              Date.now() + Number(currency.expires_after_seconds) * 1000,
            ).toISOString()
          : null;
      await db
        .prepare(
          `
        INSERT OR IGNORE INTO billing_balance_ledger (
          project_id, customer_id, product_id, transaction_id, currency_identifier,
          amount, reason, idempotency_key, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .bind(
          String(purchase.projectId),
          purchase.customerId,
          product.id,
          transactionId,
          currency.code,
          units,
          purchase.status === "trialing" ? "trial_grant" : "purchase_grant",
          `${purchase.store}:${purchase.environment}:${purchase.storeTransactionId}:${currency.code}:credit`,
          expiresAt,
        )
        .run();
    }
    return;
  }
  if (purchase.productType !== "consumable") return;
  const metadata = parseJson(product.metadata);
  const currencyIdentifier =
    typeof metadata.currency_identifier === "string"
      ? metadata.currency_identifier
      : purchase.storeProductId;
  const units =
    Number(metadata.credit_amount || 1) * Math.max(1, purchase.quantity || 1);
  await db
    .prepare(
      `
    INSERT OR IGNORE INTO billing_balance_ledger (
      project_id, customer_id, product_id, transaction_id, currency_identifier,
      amount, reason, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, 'purchase', ?)
  `,
    )
    .bind(
      String(purchase.projectId),
      purchase.customerId,
      product.id,
      transactionId,
      currencyIdentifier,
      units,
      `${purchase.store}:${purchase.environment}:${purchase.storeTransactionId}:credit`,
    )
    .run();
}

type OutboundWebhookEvent = {
  projectId: string | number;
  environment: BillingEnvironment;
  eventType: string;
  transactionId?: string | null;
  payload: Record<string, unknown>;
};

async function queueOutboundWebhookEvent(
  env: BillingEnv,
  event: OutboundWebhookEvent,
) {
  const endpoints = await env.DB.prepare(
    `
    SELECT id, environments, event_types
    FROM billing_webhook_endpoints
    WHERE project_id = ? AND active = 1
  `,
  )
    .bind(String(event.projectId))
    .all<Record<string, unknown>>();
  const deliveries: Array<{ id: string; endpointId: string; payload: string }> =
    [];
  for (const endpoint of endpoints.results || []) {
    const environments = Array.isArray(endpoint.environments)
      ? endpoint.environments
      : JSON.parse(String(endpoint.environments || "[]"));
    const eventTypes = Array.isArray(endpoint.event_types)
      ? endpoint.event_types
      : JSON.parse(String(endpoint.event_types || "[]"));
    if (environments.length > 0 && !environments.includes(event.environment))
      continue;
    if (eventTypes.length > 0 && !eventTypes.includes(event.eventType))
      continue;
    const deliveryId = crypto.randomUUID();
    const payload = JSON.stringify({
      id: deliveryId,
      type: event.eventType,
      api_version: "2026-08-03",
      project_id: String(event.projectId),
      transaction_id: event.transactionId || null,
      environment: event.environment,
      occurred_at: new Date().toISOString(),
      ...event.payload,
    });
    deliveries.push({
      id: deliveryId,
      endpointId: String(endpoint.id),
      payload,
    });
  }
  if (deliveries.length === 0) return;
  const customerId =
    typeof event.payload.customer_id === "string"
      ? event.payload.customer_id
      : null;
  await env.DB.batch(
    deliveries.map((delivery) =>
      env.DB.prepare(
        `
    INSERT INTO billing_webhook_deliveries (
      id, endpoint_id, transaction_id, customer_id, event_type, payload
    ) VALUES (?, ?, ?, ?, ?, ?)
  `,
      ).bind(
        delivery.id,
        delivery.endpointId,
        event.transactionId || null,
        customerId,
        event.eventType,
        delivery.payload,
      ),
    ),
  );
  if (env.BILLING_QUEUE) {
    await Promise.all(
      deliveries.map(async (delivery) => {
        try {
          await env.BILLING_QUEUE!.send({
            type: "billing.webhook.deliver",
            deliveryId: delivery.id,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await env.DB.prepare(
            `
          UPDATE billing_webhook_deliveries
          SET error_message = ?, next_attempt_at = datetime('now')
          WHERE id = ? AND status = 'pending'
        `,
          )
            .bind("Initial queue dispatch failed", delivery.id)
            .run();
          console.error(
            JSON.stringify({
              event: "billing_webhook_queue_dispatch_failed",
              delivery_id: delivery.id,
              endpoint_id: delivery.endpointId,
              error: message,
            }),
          );
        }
      }),
    );
  }
}

async function queuePurchaseWebhook(
  env: BillingEnv,
  purchase: VerifiedPurchase,
  transactionId: string,
) {
  await queueOutboundWebhookEvent(env, {
    projectId: purchase.projectId,
    environment: purchase.environment,
    eventType: purchase.eventType,
    transactionId,
    payload: {
      customer_id: purchase.customerId,
      store: purchase.store,
      product_id: purchase.storeProductId,
      status: purchase.status,
    },
  });
}

/**
 * Emits the single authoritative entitlement projection consumed by the application backend.
 * The delivery layer signs the exact body and timestamp with the endpoint HMAC
 * secret, so consumers never need access to a Billing signing private key.
 */
export async function queueCustomerEntitlementChanged(
  env: BillingEnv,
  params: {
    projectId: string | number;
    customerId: string;
    environment: BillingEnvironment;
    transactionId?: string | null;
    reason: string;
  },
) {
  const info = await customerInfo(env.DB, params.projectId, params.customerId);
  const entitlements = info.entitlements as Record<
    string,
    { is_active?: boolean }
  >;
  const subscriptions = info.active_subscriptions as string[];
  await queueOutboundWebhookEvent(env, {
    projectId: params.projectId,
    environment: params.environment,
    eventType: "customer.entitlement.changed",
    transactionId: params.transactionId,
    payload: {
      customer_id: params.customerId,
      app_user_id: info.original_app_user_id,
      reason: params.reason,
      data: {
        premium: entitlements.premium?.is_active === true,
        subscription: subscriptions.length > 0,
        entitlements: info.entitlements,
        active_subscriptions: subscriptions,
        request_date: info.request_date,
      },
    },
  });
}

export async function applyVerifiedPurchase(
  env: BillingEnv,
  purchase: VerifiedPurchase,
) {
  if (!BILLING_STATUSES.includes(purchase.status))
    throw new Error(`Unsupported billing status: ${purchase.status}`);
  const product = await getOrCreateProduct(env.DB, purchase);
  if (!product?.id) throw new Error("Unable to resolve billing product");
  const transactionId = crypto.randomUUID();
  const analyticsEventType = verifiedPurchaseAnalyticsEventType(purchase);
  const analyticsIdentity = [
    purchase.projectId,
    purchase.store,
    purchase.environment,
    purchase.storeTransactionId,
    analyticsEventType,
  ].join(":");
  const analyticsEventId = await canonicalAnalyticsEventId(
    "purchase",
    analyticsIdentity,
  );
  // Keep the domain identity readable and stable so historical backfills and
  // live verification converge on the same producer-outbox row.
  const analyticsFactKey = `purchase:${analyticsIdentity}`;
  const analyticsEvent: AnalyticsEventV1 = {
    schema_version: 1,
    event_id: analyticsEventId,
    event_name: ANALYTICS_CANONICAL_EVENTS.purchaseVerified,
    occurred_at:
      purchase.eventOccurredAt ||
      purchase.purchasedAt ||
      new Date().toISOString(),
    source: "billing",
    application_id: purchase.applicationId
      ? String(purchase.applicationId)
      : `project-${purchase.projectId}`,
    properties: {
      store: purchase.store,
      environment: purchase.environment,
      store_transaction_id: purchase.storeTransactionId,
      event_type: analyticsEventType,
      product_id: purchase.storeProductId,
      ...(purchase.priceMicros == null
        ? {}
        : { amount_micros: purchase.priceMicros }),
      ...(purchase.currency ? { currency: purchase.currency } : {}),
    },
  };
  const [insert] = await env.DB.batch([
    env.DB.prepare(
      `
    INSERT OR IGNORE INTO billing_transactions (
      id, project_id, application_id, customer_id, product_id, store, environment,
      store_transaction_id, original_transaction_id, order_id, purchase_token,
      event_type, status, price_micros, currency, quantity, purchased_at,
      expires_at, event_occurred_at, verified_at, raw_payload
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `,
    ).bind(
      transactionId,
      String(purchase.projectId),
      purchase.applicationId ? String(purchase.applicationId) : null,
      purchase.customerId || null,
      String(product.id),
      purchase.store,
      purchase.environment,
      purchase.storeTransactionId,
      purchase.originalTransactionId || purchase.storeTransactionId,
      purchase.orderId || null,
      purchase.purchaseToken || null,
      purchase.eventType,
      purchase.status,
      purchase.priceMicros ?? null,
      purchase.currency || null,
      Math.max(1, purchase.quantity || 1),
      purchase.purchasedAt || null,
      purchase.expiresAt || null,
      purchase.eventOccurredAt ||
        purchase.purchasedAt ||
        new Date().toISOString(),
      JSON.stringify(purchase.rawPayload),
    ),
    enqueueAnalyticsFactStatement(env.DB, {
      projectId: purchase.projectId,
      factKey: analyticsFactKey,
      event: analyticsEvent,
    }),
  ]);

  const stored = await env.DB.prepare(
    `
    SELECT id FROM billing_transactions
    WHERE project_id = ? AND store = ? AND environment = ? AND store_transaction_id = ? AND event_type = ?
    LIMIT 1
  `,
  )
    .bind(
      String(purchase.projectId),
      purchase.store,
      purchase.environment,
      purchase.storeTransactionId,
      purchase.eventType,
    )
    .first<{ id: string }>();
  if (!stored) throw new Error("Unable to persist verified transaction");

  const transferredCustomerIds =
    purchase.customerId && purchase.transfer === true
      ? await env.DB.prepare(
          `
        SELECT DISTINCT customer_id
        FROM (
          SELECT customer_id
          FROM billing_subscriptions
          WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
          UNION ALL
          SELECT customer_id
          FROM billing_transactions
          WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
        )
        WHERE customer_id IS NOT NULL AND customer_id <> ?
      `,
        )
          .bind(
            String(purchase.projectId),
            purchase.store,
            purchase.environment,
            purchase.originalTransactionId || purchase.storeTransactionId,
            String(purchase.projectId),
            purchase.store,
            purchase.environment,
            purchase.originalTransactionId || purchase.storeTransactionId,
            purchase.customerId,
          )
          .all<{ customer_id: string }>()
      : { results: [] as Array<{ customer_id: string }> };

  let subscriptionAccepted = true;
  if (purchase.productType === "subscription") {
    await env.DB.prepare(
      `
      INSERT INTO billing_subscriptions (
        project_id, application_id, customer_id, product_id, store, environment,
        original_transaction_id, latest_transaction_id, status, period_type,
        starts_at, expires_at, latest_event_at, auto_renews, will_renew
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, store, environment, original_transaction_id) DO UPDATE SET
        application_id = COALESCE(excluded.application_id, billing_subscriptions.application_id),
        customer_id = COALESCE(excluded.customer_id, billing_subscriptions.customer_id),
        product_id = excluded.product_id,
        latest_transaction_id = excluded.latest_transaction_id,
        status = excluded.status,
        period_type = excluded.period_type,
        starts_at = COALESCE(excluded.starts_at, billing_subscriptions.starts_at),
        expires_at = excluded.expires_at,
        latest_event_at = excluded.latest_event_at,
        auto_renews = excluded.auto_renews,
        will_renew = excluded.will_renew,
        updated_at = datetime('now')
      WHERE datetime(COALESCE(excluded.latest_event_at, '1970-01-01')) >=
            datetime(COALESCE(billing_subscriptions.latest_event_at, '1970-01-01'))
    `,
    )
      .bind(
        String(purchase.projectId),
        purchase.applicationId ? String(purchase.applicationId) : null,
        purchase.customerId || null,
        String(product.id),
        purchase.store,
        purchase.environment,
        purchase.originalTransactionId || purchase.storeTransactionId,
        stored.id,
        purchase.status,
        purchase.periodType ||
          (purchase.status === "trialing" ? "trial" : "normal"),
        purchase.purchasedAt || null,
        purchase.expiresAt || null,
        purchase.eventOccurredAt ||
          purchase.purchasedAt ||
          new Date().toISOString(),
        purchase.autoRenews ? 1 : 0,
        purchase.autoRenews &&
          !["cancelled", "expired", "revoked", "refunded"].includes(
            purchase.status,
          )
          ? 1
          : 0,
      )
      .run();
    const current = await env.DB.prepare(
      `
      SELECT latest_transaction_id FROM billing_subscriptions
      WHERE project_id = ? AND store = ? AND environment = ? AND original_transaction_id = ?
    `,
    )
      .bind(
        String(purchase.projectId),
        purchase.store,
        purchase.environment,
        purchase.originalTransactionId || purchase.storeTransactionId,
      )
      .first<{ latest_transaction_id: string }>();
    subscriptionAccepted = current?.latest_transaction_id === stored.id;
  }

  const transferredFrom: string[] = [];
  if (
    purchase.customerId &&
    purchase.transfer === true &&
    subscriptionAccepted
  ) {
    for (const previous of transferredCustomerIds.results || []) {
      transferredFrom.push(previous.customer_id);
    }
  }
  const mappedEntitlementIds = subscriptionAccepted
    ? await syncEntitlements(env.DB, purchase, String(product.id))
    : [];
  for (const previousCustomerId of transferredFrom) {
    for (const entitlementId of mappedEntitlementIds) {
      await projectCustomerEntitlement(env.DB, {
        projectId: String(purchase.projectId),
        customerId: previousCustomerId,
        entitlementId,
        fallbackProductId: String(product.id),
        fallbackExpiresAt: purchase.expiresAt,
      });
    }
  }
  await creditProductCurrencies(env.DB, purchase, product, stored.id);
  await recordCanonicalBillingEvent(env, purchase, stored.id);
  await recordRefundCaseForPurchase(env, purchase, stored.id);
  if (insert.meta.changes > 0) {
    await queuePurchaseWebhook(env, purchase, stored.id);
  }
  if (purchase.customerId) {
    const existingProjection =
      insert.meta.changes > 0
        ? null
        : await env.DB.prepare(
            `
          SELECT id FROM billing_webhook_deliveries
          WHERE transaction_id = ? AND event_type = 'customer.entitlement.changed'
            AND customer_id = ?
          LIMIT 1
        `,
          )
            .bind(stored.id, purchase.customerId)
            .first<{ id: string }>();
    if (!existingProjection) {
      await queueCustomerEntitlementChanged(env, {
        projectId: purchase.projectId,
        customerId: purchase.customerId,
        environment: purchase.environment,
        transactionId: stored.id,
        reason: purchase.eventType,
      });
    }
  }
  for (const previousCustomerId of transferredFrom) {
    await queueCustomerEntitlementChanged(env, {
      projectId: purchase.projectId,
      customerId: previousCustomerId,
      environment: purchase.environment,
      transactionId: stored.id,
      reason: "purchase_transferred",
    });
  }
  await deliverAnalyticsFact(env, purchase.projectId, analyticsFactKey);
  return { transactionId: stored.id, duplicate: insert.meta.changes === 0 };
}

function verifiedPurchaseAnalyticsEventType(
  purchase: VerifiedPurchase,
): VerifiedPurchaseEventType {
  const eventType = purchase.eventType.toLowerCase();
  if (eventType.includes("chargeback")) return "chargeback";
  if (
    eventType.includes("refund") ||
    purchase.status === "refunded" ||
    purchase.status === "revoked"
  ) {
    return "refund";
  }
  if (eventType.includes("cancel") || purchase.status === "cancelled") {
    return "cancellation";
  }
  if (eventType.includes("renew")) return "renewal";
  if (
    eventType.includes("trial") &&
    (eventType.includes("convert") || purchase.status === "active")
  ) {
    return "trial_converted";
  }
  return "initial_purchase";
}

export async function customerInfo(
  db: D1Database,
  projectId: string | number,
  customerId: string,
) {
  const customer = await db
    .prepare("SELECT * FROM billing_customers WHERE id = ? AND project_id = ?")
    .bind(customerId, String(projectId))
    .first<Record<string, unknown>>();
  if (!customer) throw new Error("Customer not found");
  const aliases = await db
    .prepare(
      "SELECT app_user_id FROM billing_customer_aliases WHERE customer_id = ? ORDER BY created_at",
    )
    .bind(customerId)
    .all<{ app_user_id: string }>();
  const rows = await db
    .prepare(
      `
    SELECT ce.*, e.identifier, p.store_product_id, p.store
    FROM billing_customer_entitlements ce
    JOIN billing_entitlements e ON e.id = ce.entitlement_id
    LEFT JOIN billing_products p ON p.id = ce.product_id
    WHERE ce.customer_id = ?
    ORDER BY e.identifier
  `,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();
  const subscriptions = await db
    .prepare(
      `
    SELECT s.*, p.store_product_id
    FROM billing_subscriptions s
    LEFT JOIN billing_products p ON p.id = s.product_id
    WHERE s.customer_id = ?
    ORDER BY COALESCE(s.expires_at, s.updated_at) DESC
  `,
    )
    .bind(customerId)
    .all<Record<string, unknown>>();
  const balances = await db
    .prepare(
      `
    SELECT currency_identifier, COALESCE(SUM(amount), 0) AS balance
    FROM billing_balance_ledger
    WHERE customer_id = ? AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
    GROUP BY currency_identifier
  `,
    )
    .bind(customerId)
    .all<{ currency_identifier: string; balance: number }>();
  const entitlements: Record<string, unknown> = {};
  for (const row of rows.results || []) {
    entitlements[String(row.identifier)] = {
      identifier: row.identifier,
      is_active: entitlementIsActive(
        String(row.status),
        row.expires_at as string | null,
      ),
      status: row.status,
      product_id: row.store_product_id,
      store: row.store,
      starts_at: row.starts_at,
      expires_at: row.expires_at,
      will_renew: Number(row.will_renew) === 1,
      verification: row.verification,
    };
  }
  const subscriptionRows: Array<Record<string, unknown>> = (
    subscriptions.results || []
  ).map((row) => ({
    ...row,
    management_url:
      row.store === "apple"
        ? "https://apps.apple.com/account/subscriptions"
        : row.store === "google"
          ? "https://play.google.com/store/account/subscriptions"
          : null,
  }));
  return {
    original_app_user_id: customer.primary_app_user_id,
    aliases: (aliases.results || []).map((row) => row.app_user_id),
    request_date: new Date().toISOString(),
    entitlements,
    active_subscriptions: subscriptionRows
      .filter((row) =>
        entitlementIsActive(
          String(row.status),
          row.expires_at as string | null,
        ),
      )
      .map((row) => row.store_product_id),
    subscriptions: subscriptionRows,
    balances: Object.fromEntries(
      (balances.results || []).map((row) => [
        row.currency_identifier,
        Number(row.balance),
      ]),
    ),
  };
}

export async function offeringsForCustomer(
  db: D1Database,
  projectId: string | number,
  platform: string,
  environment: string,
  placement = "default",
) {
  const offerings = await db
    .prepare(
      `
    SELECT * FROM billing_offerings
    WHERE project_id = ? AND active = 1 AND placement = ?
    ORDER BY is_current DESC, created_at ASC
  `,
    )
    .bind(String(projectId), placement)
    .all<Record<string, unknown>>();
  const result: Record<string, unknown> = {};
  for (const offering of offerings.results || []) {
    const packages = await db
      .prepare(
        `
      SELECT bp.id, bp.identifier, bp.package_type, bp.position, bp.metadata,
             p.id AS product_record_id, p.store_product_id, p.product_type, p.store, p.metadata AS product_metadata
      FROM billing_packages bp
      JOIN billing_package_products bpp ON bpp.package_id = bp.id
      JOIN billing_products p ON p.id = bpp.product_id
      WHERE bp.offering_id = ? AND p.active = 1
        AND (
          (? = 'ios' AND p.store = 'apple')
          OR (? = 'android' AND p.store = 'google')
        )
        AND p.environment = ?
      ORDER BY bp.position ASC
    `,
      )
      .bind(offering.id, platform, platform, environment)
      .all<Record<string, unknown>>();
    result[String(offering.identifier)] = {
      identifier: offering.identifier,
      display_name: offering.display_name,
      description: offering.description,
      placement: offering.placement,
      metadata: parseJson(offering.metadata),
      packages: (packages.results || []).map((row) => ({
        identifier: row.identifier,
        package_type: row.package_type,
        product: {
          id: row.product_record_id,
          store_product_id: row.store_product_id,
          product_type: row.product_type,
          store: row.store,
          metadata: parseJson(row.product_metadata),
        },
        metadata: parseJson(row.metadata),
      })),
    };
  }
  const current =
    Object.values(result).find((value) => {
      const identifier = (value as Record<string, unknown>).identifier;
      return (offerings.results || []).some(
        (row) => row.identifier === identifier && Number(row.is_current) === 1,
      );
    }) ||
    Object.values(result)[0] ||
    null;
  return { current, all: result };
}
