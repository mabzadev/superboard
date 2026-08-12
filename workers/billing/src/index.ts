import { Hono } from "hono";
import type { BillingEnv } from "../../api/src/types";
import { billingWorkerReadiness } from "../../api/src/lib/billing-worker-readiness";
import {
  applyVerifiedPurchase,
  identifyCustomer,
} from "../../api/src/lib/billing";
import {
  dispatchBillingJob,
  isBillingQueueJob,
} from "../../api/src/lib/billing-dispatch";
import { quarantineBillingDeadLetter } from "../../api/src/lib/billing-dead-letters";
import {
  purchasesSigningJwks,
  resolveSdkCustomer,
  signedCustomerInfo,
  verifiedAppUserId,
} from "../../api/src/lib/billing-identity";
import { restoreVerifiedPurchases } from "../../api/src/lib/billing-restore";
import {
  ingestBillingProviderEvent,
  type BillingProviderIngressRequest,
} from "../../api/src/lib/billing-provider-ingress";
import { reconcileBillingState } from "../../api/src/lib/billing-jobs";
import {
  fetchStoreCatalog,
  finalizeGooglePurchase,
  classifyGooglePurchaseEnvironment,
  verifyAppleTransaction,
  verifyGooglePurchase,
} from "../../api/src/lib/store-verification";
import { parseReceiptRequest, publicError } from "./contracts";
import { readTextLimited } from "../../api/src/lib/http-limits";
import { encryptCredential } from "../../api/src/lib/secrets";
import {
  configuredSecrets,
  matchesAnySecret,
} from "@superboard/contracts/secret";
import purchasesAdminRoutes from "../../api/src/routes/purchases-admin";
import purchasesV2AdminRoutes from "../../api/src/routes/purchases-v2-admin";
import { drainAnalyticsFactOutbox } from "../../api/src/lib/analytics-facts";

type Bindings = Env & BillingEnv;
const app = new Hono<{ Bindings: Bindings }>();

app.get("/internal/v1/health", async (c) => {
  return c.json(await billingWorkerReadiness(c.env));
});

app.get("/internal/v1/jwks", (c) => {
  try {
    return c.json(purchasesSigningJwks(c.env));
  } catch {
    throw publicError(
      "signing_keys_unavailable",
      "Purchases signing keys are unavailable",
      503,
    );
  }
});

app.post("/internal/v1/customers/erase", async (c) => {
  const authorized = await matchesAnySecret(
    c.req.header("x-internal-token") || "",
    configuredSecrets(
      c.env.INTERNAL_API_TOKEN,
      c.env.INTERNAL_API_TOKEN_PREVIOUS,
    ),
  );
  if (!authorized) {
    throw publicError(
      "internal_auth_invalid",
      "Internal authentication failed",
      401,
    );
  }
  const body = await boundedRecord(c.req.raw);
  const projectId = requiredText(body.project_id, "project_id", 64);
  const userId = requiredText(
    body.application_user_id,
    "application_user_id",
    255,
  );
  const customer = await c.env.DB.prepare(
    `SELECT customer.id FROM billing_customers customer
     LEFT JOIN billing_customer_aliases alias ON alias.customer_id = customer.id
     WHERE customer.project_id = ?
       AND (customer.primary_app_user_id = ? OR alias.app_user_id = ?)
     LIMIT 1`,
  )
    .bind(projectId, userId, userId)
    .first<{ id: string }>();
  if (!customer) {
    return c.json({ data: { erased: true, customers_redacted: 0 } });
  }
  const digest = await sha256Hex(`${projectId}:${userId}`);
  const erasedUserId = `erased:${digest.slice(0, 32)}`;
  const emptyEvidenceHash = await sha256Hex("{}");
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM billing_customer_aliases WHERE project_id = ? AND customer_id = ?",
    ).bind(projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_transactions SET raw_payload = '{}'
       WHERE project_id = ? AND customer_id = ?`,
    ).bind(projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_events SET payload = '{}', error_message = NULL
       WHERE project_id = ? AND customer_id = ?`,
    ).bind(projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_paywall_events
       SET metadata = '{}', country = NULL
       WHERE project_id = ? AND customer_id = ?`,
    ).bind(projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_certification_device_results
       SET device_model = NULL, os_version = NULL, evidence_json = '{}',
           evidence_sha256 = ?
       WHERE target_project_id = ? AND customer_id = ?`,
    ).bind(emptyEvidenceHash, projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_legacy_customer_inventory
       SET app_user_id = ?
       WHERE project_id = ? AND customer_id = ?`,
    ).bind(erasedUserId, projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_legacy_subscription_inventory
       SET app_user_id = ?
       WHERE project_id = ? AND customer_id = ?`,
    ).bind(erasedUserId, projectId, customer.id),
    c.env.DB.prepare(
      `UPDATE billing_customers
       SET primary_app_user_id = ?, anonymous = 0, blocked = 1,
           attributes = '{}', updated_at = datetime('now')
       WHERE project_id = ? AND id = ?`,
    ).bind(erasedUserId, projectId, customer.id),
  ]);
  return c.json({
    data: {
      erased: true,
      customers_redacted: Number(results[7].meta.changes || 0),
      transactions_redacted: Number(results[1].meta.changes || 0),
      events_redacted:
        Number(results[2].meta.changes || 0) +
        Number(results[3].meta.changes || 0),
    },
  });
});

app.post("/internal/v1/jobs", async (c) => {
  const job: unknown = await boundedJson(c.req.raw);
  if (!isBillingQueueJob(job))
    throw publicError(
      "billing_job_invalid",
      "A supported billing job is required",
    );
  return c.json({ data: await dispatchBillingJob(c.env, job) });
});

app.post("/internal/v1/provider-events/ingest", async (c) => {
  const body = await boundedRecord(c.req.raw);
  const job =
    body.job && typeof body.job === "object" && !Array.isArray(body.job)
      ? (body.job as Record<string, unknown>)
      : {};
  const request = {
    projectId: requiredText(body.project_id, "project_id"),
    store: requiredText(body.store, "store"),
    environment: requiredText(body.environment, "environment"),
    externalEventId: requiredText(body.external_event_id, "external_event_id"),
    eventType: optionalText(body.event_type) || undefined,
    payload: requiredText(body.payload, "payload", 1_048_576),
    job,
  } as BillingProviderIngressRequest;
  return c.json({ data: await ingestBillingProviderEvent(c.env, request) });
});

app.post("/internal/v1/google/purchases/classify", async (c) => {
  const body = await boundedRecord(c.req.raw);
  const productType = requiredText(body.product_type, "product_type");
  if (!["subscription", "non_consumable", "consumable"].includes(productType)) {
    throw publicError(
      "product_type_invalid",
      "product_type must be subscription, non_consumable, or consumable",
    );
  }
  return c.json({
    data: await classifyGooglePurchaseEnvironment(c.env, {
      projectId: requiredText(body.project_id, "project_id"),
      purchaseToken: requiredText(body.purchase_token, "purchase_token"),
      storeProductId: requiredText(body.product_id, "product_id"),
      productType: productType as
        | "subscription"
        | "non_consumable"
        | "consumable",
    }),
  });
});

app.post("/internal/v1/receipts/verify", async (c) => {
  const request = parseReceiptRequest(await boundedJson(c.req.raw));
  let purchase;
  let finalize: (() => Promise<void>) | null = null;
  if (request.store === "apple") {
    purchase = (
      await verifyAppleTransaction(c.env, {
        projectId: request.project_id,
        customerId: request.customer_id,
        signedTransaction: request.signed_transaction!,
        environment: request.environment,
      })
    ).purchase;
  } else {
    const verified = await verifyGooglePurchase(c.env, {
      projectId: request.project_id,
      customerId: request.customer_id,
      purchaseToken: request.purchase_token!,
      storeProductId: request.product_id!,
      productType: request.product_type,
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
    finish_transaction: purchase.status !== "pending",
    customer_info: await signedCustomerInfo(
      c.env,
      request.project_id,
      request.customer_id,
    ),
  });
});

app.post("/internal/v1/customer-info", async (c) => {
  const body = (await boundedJson(c.req.raw)) as Record<string, unknown>;
  const projectId = String(body.project_id || "");
  const customerId = String(body.customer_id || "");
  if (!projectId || !customerId)
    throw publicError(
      "customer_context_invalid",
      "project_id and customer_id are required",
    );
  return c.json({
    data: await signedCustomerInfo(c.env, projectId, customerId),
  });
});

app.post("/internal/v1/customers/resolve", async (c) => {
  const body = await boundedRecord(c.req.raw);
  const projectId = requiredText(body.project_id, "project_id");
  const authorization = optionalText(body.authorization);
  const anonymousId = optionalText(body.anonymous_id);
  try {
    return c.json({
      data: await resolveSdkCustomer(c.env, {
        projectId,
        authorization: authorization || undefined,
        anonymousId: anonymousId || undefined,
      }),
    });
  } catch (error) {
    throw publicError(
      "customer_identity_invalid",
      error instanceof Error ? error.message : "Customer identity is invalid",
      401,
    );
  }
});

app.post("/internal/v1/customers/identify", async (c) => {
  const body = await boundedRecord(c.req.raw);
  const projectId = requiredText(body.project_id, "project_id");
  const currentAppUserId = requiredText(
    body.current_app_user_id,
    "current_app_user_id",
  );
  const authorization = optionalText(body.authorization);
  let targetAppUserId: string | null;
  try {
    targetAppUserId = await verifiedAppUserId(
      c.env,
      projectId,
      authorization || undefined,
    );
  } catch (error) {
    throw publicError(
      "customer_identity_invalid",
      error instanceof Error ? error.message : "Customer identity is invalid",
      401,
    );
  }
  if (!targetAppUserId)
    throw publicError(
      "identity_required",
      "A verified identity token is required",
      401,
    );
  const customer = await identifyCustomer(
    c.env.DB,
    projectId,
    currentAppUserId,
    targetAppUserId,
  );
  return c.json({
    data: await signedCustomerInfo(c.env, projectId, String(customer?.id)),
  });
});

app.post("/internal/v1/receipts/restore", async (c) => {
  const body = await boundedRecord(c.req.raw);
  const projectId = requiredText(body.project_id, "project_id");
  const customerId = requiredText(body.customer_id, "customer_id");
  const environment =
    body.environment === "production"
      ? "production"
      : body.environment === "sandbox"
        ? "sandbox"
        : null;
  if (!environment)
    throw publicError(
      "restore_environment_invalid",
      "environment must be sandbox or production",
    );
  const restored = await restoreVerifiedPurchases(c.env, {
    projectId,
    customerId,
    environment,
    appleTransactions: body.apple_transactions,
    googlePurchases: body.google_purchases,
  });
  return c.json({
    data: {
      result: "purchased",
      restored,
      customer_info: await signedCustomerInfo(c.env, projectId, customerId),
    },
  });
});

app.post("/internal/v1/credentials/encrypt", async (c) => {
  const body = (await boundedJson(c.req.raw)) as Record<string, unknown>;
  const credential = typeof body.credential === "string" ? body.credential : "";
  if (!credential || credential.length > 65_536) {
    throw publicError(
      "credential_invalid",
      "A credential of at most 64 KB is required",
    );
  }
  return c.json({
    data: { ciphertext: await encryptCredential(c.env, credential) },
  });
});

app.post("/internal/v1/catalog/sync", async (c) => {
  const body = (await boundedJson(c.req.raw)) as Record<string, unknown>;
  const projectId = String(body.project_id || "");
  const platform = String(body.platform || "");
  if (!projectId || !["ios", "android"].includes(platform)) {
    throw publicError(
      "catalog_context_invalid",
      "project_id and platform ios or android are required",
    );
  }
  return c.json({
    data: await fetchStoreCatalog(c.env, {
      projectId,
      platform: platform as "ios" | "android",
    }),
  });
});

app.post("/internal/v1/reconcile", async (c) =>
  c.json({ data: await reconcileBillingState(c.env) }),
);

app.route("/internal/v1/admin/billing", purchasesAdminRoutes);
app.route("/internal/v1/admin/purchases/projects", purchasesV2AdminRoutes);
app.route("/internal/v1/admin/purchases/projects", purchasesAdminRoutes);

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId = c.req.header("cf-ray") || crypto.randomUUID();
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "billing_request_failed",
        request_id: requestId,
        path: c.req.path,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return c.json(
    {
      code: (error as { code?: string }).code || "billing_internal_error",
      message:
        status >= 500 ? "Billing is temporarily unavailable" : error.message,
      retryable: status >= 500,
      request_id: requestId,
    },
    status as 400,
  );
});

async function boundedJson(request: Request): Promise<unknown> {
  let text: string;
  try {
    text = await readTextLimited(
      request,
      2_359_296,
      "Private request body is limited to 2.25 MB",
    );
  } catch {
    throw publicError(
      "request_too_large",
      "Private request body is limited to 2.25 MB",
      413,
    );
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw publicError("invalid_json", "Request body must be valid JSON", 400);
  }
}

async function boundedRecord(
  request: Request,
): Promise<Record<string, unknown>> {
  const value = await boundedJson(request);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw publicError(
      "request_object_required",
      "Request body must be a JSON object",
      400,
    );
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength = 4096) {
  const result = optionalText(value, maxLength);
  if (!result) throw publicError(`${field}_required`, `${field} is required`);
  return result;
}

function optionalText(value: unknown, maxLength = 4096) {
  if (typeof value !== "string") return "";
  const result = value.trim();
  if (result.length > maxLength)
    throw publicError(
      "text_value_too_large",
      `Text value is limited to ${maxLength} characters`,
      413,
    );
  return result;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      drainAnalyticsFactOutbox(env).then((summary) => {
        if (summary.inspected > 0) {
          console.log(
            JSON.stringify({ event: "analytics_fact_outbox_drained", summary }),
          );
        }
      }),
    );
    if (!env.BILLING_QUEUE) return;
    ctx.waitUntil(env.BILLING_QUEUE.send({ type: "billing.reconcile" }));
  },
  async queue(batch, env, ctx) {
    if (batch.queue === env.BILLING_DLQ_NAME) {
      for (const message of batch.messages) {
        try {
          const result = await quarantineBillingDeadLetter(
            env,
            batch.queue,
            message,
          );
          console.error(
            JSON.stringify({
              event: "billing_job_quarantined",
              message_id: message.id,
              job_type: result.job_type,
              project_id: result.project_id,
              duplicate: result.duplicate,
              replay_available: result.replay_available,
            }),
          );
          message.ack();
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "billing_dead_letter_persistence_failed",
              message_id: message.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          message.retry({ delaySeconds: 60 });
        }
      }
      return;
    }
    if (batch.queue !== env.BILLING_QUEUE_NAME) {
      console.error(
        JSON.stringify({ event: "billing_queue_unknown", queue: batch.queue }),
      );
      batch.retryAll({ delaySeconds: 60 });
      return;
    }
    for (const message of batch.messages) {
      try {
        if (!isBillingQueueJob(message.body))
          throw new Error("Unsupported billing queue job");
        const job = message.body;
        const result = await dispatchBillingJob(env, job);
        console.log(
          JSON.stringify({
            event: "billing_job_completed",
            message_id: message.id,
            type: job.type,
            result,
          }),
        );
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "billing_job_failed",
            message_id: message.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        const tagged = error as {
          retryable?: boolean;
          retryDelaySeconds?: number;
        };
        if (tagged?.retryable === false) {
          try {
            const quarantine = await quarantineBillingDeadLetter(
              env,
              `${batch.queue}:terminal`,
              message,
            );
            console.error(
              JSON.stringify({
                event: "billing_terminal_job_quarantined",
                message_id: message.id,
                job_type: quarantine.job_type,
                project_id: quarantine.project_id,
                duplicate: quarantine.duplicate,
                replay_available: quarantine.replay_available,
              }),
            );
            message.ack();
          } catch (quarantineError) {
            console.error(
              JSON.stringify({
                event: "billing_terminal_quarantine_failed",
                message_id: message.id,
                error:
                  quarantineError instanceof Error
                    ? quarantineError.message
                    : String(quarantineError),
              }),
            );
            message.retry({ delaySeconds: 60 });
          }
        } else
          message.retry({
            delaySeconds: Math.max(
              30,
              Math.min(3600, Number(tagged?.retryDelaySeconds || 60)),
            ),
          });
      }
    }
  },
} satisfies ExportedHandler<Bindings>;
