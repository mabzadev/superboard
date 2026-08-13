import {
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleAnalyticsQueue } from "../src/ingestion";
import { evaluateAnalyticsAlerts } from "../src/automations";

const secret = "analytics-runtime-secret";

async function signedRequest(
  path: string,
  projectId: number,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
  role = "owner",
) {
  const context: InternalProjectContext = {
    module: "analytics",
    method,
    pathname: new URL(path, "https://analytics.internal").pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test",
    actorId: 2,
    role,
    requestId: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1_000),
  };
  const headers = new Headers({
    "content-type": "application/json",
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": context.projectRef,
    "x-instance-id": String(context.instanceId),
    "x-environment": context.environment,
    "x-actor-id": String(context.actorId),
    "x-role": context.role,
    "x-request-id": context.requestId,
    "x-context-issued-at": String(context.issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);
  return new Request(`https://analytics.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function projectEvent(
  projectId: number,
  eventId: string,
  messageId: string,
) {
  const batch = createMessageBatch("analytics-test-ingest", [
    {
      id: messageId,
      timestamp: new Date(),
      attempts: 1,
      body: {
        schema_version: 1,
        type: "analytics.event.project",
        project_id: String(projectId),
        event_id: eventId,
      },
    },
  ]);
  const execution = createExecutionContext();
  await handleAnalyticsQueue(batch, env);
  return getQueueResult(batch, execution);
}

describe("Analytics in the Workers runtime", () => {
  it("reports schema and non-sensitive pipeline health", async () => {
    const response = await SELF.fetch(
      "https://analytics.internal/internal/v1/health",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        service: "analytics",
        status: "ok",
        storage: { hot: "d1", archive: "r2", pipeline: "queue" },
        schema: {
          status: "current",
          expectedMigration: "0002_countly_capabilities.sql",
          latestMigration: "0002_countly_capabilities.sql",
        },
        metrics: {
          ingestion: {
            receipts: expect.any(Number),
            pending: expect.any(Number),
          },
          facts: {
            installations: expect.any(Number),
            purchases: expect.any(Number),
          },
        },
      },
    });
  });

  it("counts an installation and session once across ingestion and queue replays", async () => {
    const event = {
      schema_version: 1,
      event_id: "runtime-install-1",
      event_name: "superboard.analytics.installation.created.v1",
      occurred_at: new Date().toISOString(),
      source: "system",
      application_id: "runtime-app-1",
      app_instance_id: "private-runtime-installation-id",
      session_id: "private-runtime-session-id",
      properties: { attribution_id: "attribution-1" },
      context: { platform: "ios", app_version: "1.2.3" },
    };
    const accepted = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events",
        12,
        "POST",
        event,
        undefined,
        "system",
      ),
    );
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      data: { accepted: 1, duplicates: 0, rejected: 0 },
    });

    const duplicate = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events",
        12,
        "POST",
        event,
        undefined,
        "system",
      ),
    );
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: { accepted: 0, duplicates: 1, rejected: 0 },
    });

    const conflict = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events",
        12,
        "POST",
        {
          ...event,
          properties: { attribution_id: "different" },
        },
        undefined,
        "system",
      ),
    );
    expect(conflict.status).toBe(207);
    await expect(conflict.json()).resolves.toMatchObject({
      data: {
        rejected: 1,
        results: [{ status: "rejected", code: "analytics_event_id_conflict" }],
      },
    });

    const firstProjection = await projectEvent(
      12,
      event.event_id,
      "projection-1",
    );
    expect(firstProjection.explicitAcks).toEqual(["projection-1"]);
    const replayProjection = await projectEvent(
      12,
      event.event_id,
      "projection-2",
    );
    expect(replayProjection.explicitAcks).toEqual(["projection-2"]);

    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM analytics_installations
         WHERE project_id = '12' AND application_id = 'runtime-app-1'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(event_count) AS event_count
         FROM analytics_sessions WHERE project_id = '12'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1, event_count: 1 });
    await expect(
      env.DB.prepare(
        `SELECT SUM(event_count) AS total FROM analytics_daily_metrics
         WHERE project_id = '12' AND metric_name = 'event'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(status) AS status
         FROM analytics_marketing_signal_outbox
         WHERE project_id = '12' AND event_id = ?`,
      )
        .bind(event.event_id)
        .first(),
    ).resolves.toMatchObject({ total: 1, status: "delivered" });

    const receipt = await env.DB.prepare(
      `SELECT archive_key, status FROM analytics_event_receipts
       WHERE project_id = '12' AND event_id = ?`,
    )
      .bind(event.event_id)
      .first<{ archive_key: string; status: string }>();
    expect(receipt?.status).toBe("projected");
    const archived = await env.EVENT_ARCHIVE.get(receipt!.archive_key);
    const archivedText = await archived!.text();
    expect(archivedText).not.toContain("private-runtime-installation-id");
    expect(archivedText).not.toContain("private-runtime-session-id");
  });

  it("accepts only verified canonical purchase facts once", async () => {
    const event = {
      schema_version: 1,
      event_id: "runtime-purchase-1",
      event_name: "superboard.analytics.purchase.verified.v1",
      occurred_at: new Date().toISOString(),
      source: "billing",
      application_id: "runtime-app-1",
      properties: {
        billing_transaction_id: "billing-row-1",
        store: "apple",
        environment: "production",
        store_transaction_id: "store-transaction-1",
        event_type: "initial_purchase",
        product_id: "premium-yearly",
        amount_micros: 9_990_000,
        currency: "CHF",
      },
    };
    const accepted = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events",
        12,
        "POST",
        event,
        undefined,
        "system",
      ),
    );
    expect(accepted.status).toBe(202);
    await projectEvent(12, event.event_id, "purchase-projection-1");
    await projectEvent(12, event.event_id, "purchase-projection-2");
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(amount_micros) AS amount_micros
         FROM analytics_purchase_facts
         WHERE project_id = '12' AND store_transaction_id = 'store-transaction-1'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1, amount_micros: 9_990_000 });

    const secondCurrency = {
      ...event,
      event_id: "runtime-purchase-2",
      properties: {
        ...event.properties,
        billing_transaction_id: "billing-row-2",
        store_transaction_id: "store-transaction-2",
        amount_micros: 5_000_000,
        currency: "USD",
      },
    };
    expect(
      (
        await SELF.fetch(
          await signedRequest(
            "/internal/v1/events",
            12,
            "POST",
            secondCurrency,
            undefined,
            "system",
          ),
        )
      ).status,
    ).toBe(202);
    await projectEvent(12, secondCurrency.event_id, "purchase-projection-3");

    const refund = {
      ...event,
      event_id: "runtime-purchase-refund-1",
      properties: {
        ...event.properties,
        billing_transaction_id: "billing-row-refund-1",
        event_type: "refund",
      },
    };
    expect(
      (
        await SELF.fetch(
          await signedRequest(
            "/internal/v1/events",
            12,
            "POST",
            refund,
            undefined,
            "system",
          ),
        )
      ).status,
    ).toBe(202);
    await projectEvent(12, refund.event_id, "purchase-projection-refund-1");

    const overview = await SELF.fetch(
      await signedRequest("/internal/v1/overview", 12),
    );
    expect(overview.status).toBe(200);
    await expect(overview.json()).resolves.toMatchObject({
      data: {
        purchase_events: 3,
        successful_purchases: 2,
        net_revenue_micros: null,
        net_revenue_currency: null,
        net_revenue_by_currency: [
          { currency: "CHF", net_revenue_micros: 0 },
          { currency: "USD", net_revenue_micros: 5_000_000 },
        ],
      },
    });
  });

  it("projects Countly-style views, crashes and ratings exactly once", async () => {
    const events = [
      {
        schema_version: 1,
        event_id: "runtime-view-1",
        event_name: "[CLY]_view",
        occurred_at: new Date().toISOString(),
        source: "sdk",
        application_id: "runtime-app-capabilities",
        session_id: "private-view-session",
        user_id: "private-view-user",
        properties: {
          view_name: "Checkout",
          view_url: "/checkout",
          duration_seconds: 42,
        },
      },
      {
        schema_version: 1,
        event_id: "runtime-crash-1",
        event_name: "[CLY]_crash",
        occurred_at: new Date().toISOString(),
        source: "sdk",
        application_id: "runtime-app-capabilities",
        user_id: "private-crash-user",
        properties: {
          title: "CheckoutError",
          message: "Payment button failed",
          stack: "at Checkout.submit",
          fatal: true,
        },
        context: { platform: "ios", app_version: "2.0.0" },
      },
      {
        schema_version: 1,
        event_id: "runtime-rating-1",
        event_name: "[CLY]_star_rating",
        occurred_at: new Date().toISOString(),
        source: "sdk",
        application_id: "runtime-app-capabilities",
        user_id: "private-rating-user",
        properties: { rating: 5, comment: "Fast and clear" },
      },
    ];
    for (const event of events) {
      const accepted = await SELF.fetch(
        await signedRequest("/internal/v1/events", 22, "POST", event),
      );
      expect(accepted.status).toBe(202);
      await projectEvent(22, event.event_id, `${event.event_id}-projection-1`);
      await projectEvent(22, event.event_id, `${event.event_id}-projection-2`);
    }

    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(duration_seconds) AS duration_seconds
         FROM analytics_view_facts WHERE project_id = '22'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1, duration_seconds: 42 });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS groups, MAX(occurrence_count) AS occurrences,
                MAX(fatal) AS fatal
         FROM analytics_crash_groups WHERE project_id = '22'`,
      ).first(),
    ).resolves.toMatchObject({ groups: 1, occurrences: 1, fatal: 1 });
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(rating) AS rating
         FROM analytics_feedback_facts WHERE project_id = '22'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1, rating: 5 });

    const views = await SELF.fetch(
      await signedRequest("/internal/v1/views", 22),
    );
    expect(views.status).toBe(200);
    await expect(views.json()).resolves.toMatchObject({
      data: {
        items: [
          expect.objectContaining({
            view_name: "Checkout",
            views: 1,
            average_duration_seconds: 42,
          }),
        ],
      },
    });
    const analysis = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events/analyze?event_name=%5BCLY%5D_view&property=view_name",
        22,
      ),
    );
    expect(analysis.status).toBe(200);
    await expect(analysis.json()).resolves.toMatchObject({
      data: {
        event_name: "[CLY]_view",
        totals: { events: 1, users: 1 },
        properties: expect.arrayContaining(["view_name", "duration_seconds"]),
        segmentation: {
          property: "view_name",
          items: [{ value: "Checkout", events: 1, users: 1 }],
        },
      },
    });
  });

  it("provides idempotent dashboards and deterministic remote configuration", async () => {
    const dashboardPayload = {
      name: "Product health",
      description: "Activation and stability",
      visibility: "project",
      layout: { columns: 12 },
    };
    const dashboardRequest = () =>
      signedRequest(
        "/internal/v1/dashboards",
        31,
        "POST",
        dashboardPayload,
        "runtime-dashboard-create",
      );
    const created = await SELF.fetch(await dashboardRequest());
    expect(created.status).toBe(201);
    const dashboard = await created.json<{ data: { id: string } }>();
    const replayed = await SELF.fetch(await dashboardRequest());
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("idempotency-replayed")).toBe("true");
    await expect(replayed.json()).resolves.toMatchObject({
      data: { id: dashboard.data.id },
    });

    const config = await SELF.fetch(
      await signedRequest(
        "/internal/v1/remote-config/checkout_banner",
        31,
        "PUT",
        {
          environment: "test",
          value: { message: "Welcome" },
          conditions: [
            { field: "country", operator: "equals", value: "CH" },
            { rollout_percentage: 100 },
          ],
        },
        "runtime-config-upsert",
      ),
    );
    expect(config.status).toBe(201);
    const invalidConfig = await SELF.fetch(
      await signedRequest(
        "/internal/v1/remote-config/invalid_condition",
        31,
        "PUT",
        {
          environment: "test",
          value: true,
          conditions: [{ field: "country", operator: "unknown", value: "CH" }],
        },
        "runtime-config-invalid-condition",
      ),
    );
    expect(invalidConfig.status).toBe(400);
    const resolve = () =>
      signedRequest("/internal/v1/remote-config/resolve", 31, "POST", {
        app_instance_id: "private-device",
        context: { country: "CH" },
      });
    const first = await SELF.fetch(await resolve());
    const second = await SELF.fetch(await resolve());
    await expect(first.json()).resolves.toMatchObject({
      data: {
        values: { checkout_banner: { message: "Welcome" } },
        versions: { checkout_banner: 1 },
      },
    });
    await expect(second.json()).resolves.toMatchObject({
      data: {
        values: { checkout_banner: { message: "Welcome" } },
        versions: { checkout_banner: 1 },
      },
    });
  });

  it("applies collection and hot-retention settings without dropping canonical facts", async () => {
    const settings = await SELF.fetch(
      await signedRequest(
        "/internal/v1/settings",
        55,
        "PUT",
        {
          hot_retention_days: 7,
          timezone: "Europe/Zurich",
          data_collection_enabled: false,
        },
        "runtime-settings-collection-disabled",
      ),
    );
    expect(settings.status).toBe(200);

    const rejected = await SELF.fetch(
      await signedRequest("/internal/v1/events", 55, "POST", {
        schema_version: 1,
        event_id: "runtime-disabled-sdk-event",
        event_name: "screen.viewed",
        occurred_at: new Date().toISOString(),
        source: "sdk",
        application_id: "runtime-disabled-app",
        app_instance_id: "private-disabled-instance",
        properties: { view_name: "Disabled" },
      }),
    );
    expect(rejected.status).toBe(207);
    await expect(rejected.json()).resolves.toMatchObject({
      data: {
        accepted: 0,
        rejected: 1,
        results: [{ code: "analytics_collection_disabled" }],
      },
    });

    const canonical = {
      schema_version: 1,
      event_id: "runtime-disabled-canonical-installation",
      event_name: "superboard.analytics.installation.created.v1",
      occurred_at: new Date().toISOString(),
      source: "system",
      application_id: "runtime-disabled-app",
      app_instance_id: "private-canonical-instance",
      properties: {},
    };
    const accepted = await SELF.fetch(
      await signedRequest(
        "/internal/v1/events",
        55,
        "POST",
        canonical,
        undefined,
        "system",
      ),
    );
    expect(accepted.status).toBe(202);
    await projectEvent(55, canonical.event_id, "disabled-canonical-projection");
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total FROM analytics_installations
         WHERE project_id = '55' AND source_event_id = ?`,
      )
        .bind(canonical.event_id)
        .first(),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      env.DB.prepare(
        `SELECT CAST(ROUND(julianday(expires_at) - julianday(occurred_at)) AS INTEGER) AS retention_days
         FROM analytics_events_hot WHERE project_id = '55' AND event_id = ?`,
      )
        .bind(canonical.event_id)
        .first(),
    ).resolves.toMatchObject({ retention_days: 7 });
  });

  it("stops SDK collection for a disabled application", async () => {
    const initialEvent = {
      schema_version: 1,
      event_id: "runtime-active-application-event",
      event_name: "screen.viewed",
      occurred_at: new Date().toISOString(),
      source: "sdk",
      application_id: "runtime-toggle-app",
      app_instance_id: "private-toggle-instance",
      properties: { view_name: "Home" },
    };
    expect(
      (
        await SELF.fetch(
          await signedRequest("/internal/v1/events", 56, "POST", initialEvent),
        )
      ).status,
    ).toBe(202);
    await projectEvent(56, initialEvent.event_id, "toggle-app-projection");

    const disabled = await SELF.fetch(
      await signedRequest(
        "/internal/v1/applications/runtime-toggle-app",
        56,
        "PUT",
        { active: false },
        "runtime-disable-application",
      ),
    );
    expect(disabled.status).toBe(200);

    const rejected = await SELF.fetch(
      await signedRequest("/internal/v1/events", 56, "POST", {
        ...initialEvent,
        event_id: "runtime-disabled-application-event",
      }),
    );
    expect(rejected.status).toBe(207);
    await expect(rejected.json()).resolves.toMatchObject({
      data: {
        accepted: 0,
        results: [{ code: "analytics_application_disabled" }],
      },
    });
  });

  it("validates and evaluates alert rules with central email delivery", async () => {
    const invalid = await SELF.fetch(
      await signedRequest(
        "/internal/v1/alerts",
        44,
        "POST",
        {
          name: "Invalid recipient",
          alert_type: "crash_spike",
          definition: { window_minutes: 60, threshold: 1 },
          channels: [{ type: "email", to: "not-an-email" }],
        },
        "runtime-invalid-alert",
      ),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "analytics_alert_recipient_invalid" },
    });

    const created = await SELF.fetch(
      await signedRequest(
        "/internal/v1/alerts",
        44,
        "POST",
        {
          name: "No incoming data",
          alert_type: "no_data",
          definition: { window_minutes: 60 },
          channels: [{ type: "email", to: "analytics@example.com" }],
          cooldown_minutes: 60,
        },
        "runtime-no-data-alert",
      ),
    );
    expect(created.status).toBe(201);
    await evaluateAnalyticsAlerts(env);
    await expect(
      env.DB.prepare(
        `SELECT COUNT(*) AS total, MAX(notification_status) AS notification_status
         FROM analytics_alert_incidents WHERE project_id = '44'`,
      ).first(),
    ).resolves.toMatchObject({ total: 1, notification_status: "sent" });

    await evaluateAnalyticsAlerts(env);
    await expect(
      env.DB.prepare(
        "SELECT COUNT(*) AS total FROM analytics_alert_incidents WHERE project_id = '44'",
      ).first(),
    ).resolves.toMatchObject({ total: 1 });
  });

  it("rejects canonical financial facts from non-system callers", async () => {
    const response = await SELF.fetch(
      await signedRequest("/internal/v1/events", 12, "POST", {
        schema_version: 1,
        event_id: "spoofed-purchase-1",
        event_name: "superboard.analytics.purchase.verified.v1",
        occurred_at: new Date().toISOString(),
        source: "billing",
        application_id: "runtime-app-1",
        properties: {
          store: "apple",
          environment: "production",
          store_transaction_id: "spoofed-transaction",
          event_type: "initial_purchase",
        },
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "analytics_event_reserved" },
    });
  });

  it("keeps an erasure tombstone so an event replay cannot restore subject data", async () => {
    const event = {
      schema_version: 1,
      event_id: "runtime-erasure-event-1",
      event_name: "profile.viewed",
      occurred_at: new Date().toISOString(),
      source: "sdk",
      application_id: "runtime-app-1",
      user_id: "private-user-to-erase",
      properties: { section: "account" },
    };
    expect(
      (
        await SELF.fetch(
          await signedRequest("/internal/v1/events", 12, "POST", event),
        )
      ).status,
    ).toBe(202);
    await projectEvent(12, event.event_id, "erasure-projection-1");

    const erased = await SELF.fetch(
      await signedRequest(
        "/internal/v1/application/users/private-user-to-erase",
        12,
        "DELETE",
      ),
    );
    expect(erased.status).toBe(200);
    await expect(erased.json()).resolves.toMatchObject({
      data: { erased: true, erased_events: 1, erased_archives: 1 },
    });
    await expect(
      env.DB.prepare(
        `SELECT status, archive_key,
          (SELECT COUNT(*) FROM analytics_events_hot hot
           WHERE hot.project_id = receipt.project_id AND hot.event_id = receipt.event_id) AS hot_rows,
          (SELECT COUNT(*) FROM analytics_ingest_outbox outbox
           WHERE outbox.project_id = receipt.project_id AND outbox.event_id = receipt.event_id) AS outbox_rows,
          (SELECT COUNT(*) FROM analytics_marketing_signal_outbox signal
           WHERE signal.project_id = receipt.project_id AND signal.event_id = receipt.event_id) AS signal_rows
         FROM analytics_event_receipts receipt
         WHERE project_id = '12' AND event_id = ?`,
      )
        .bind(event.event_id)
        .first(),
    ).resolves.toMatchObject({
      status: "erased",
      archive_key: null,
      hot_rows: 0,
      outbox_rows: 0,
      signal_rows: 0,
    });

    const replay = await SELF.fetch(
      await signedRequest("/internal/v1/events", 12, "POST", event),
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      data: { accepted: 0, duplicates: 1, rejected: 0 },
    });
  });

  it("isolates projects and replays saved-report mutations", async () => {
    const payload = {
      report_type: "funnel",
      name: "Activation funnel",
      definition: { steps: ["app.opened", "account.created"] },
    };
    const createRequest = () =>
      signedRequest(
        "/internal/v1/reports",
        12,
        "POST",
        payload,
        "runtime-report-create",
      );
    const created = await SELF.fetch(await createRequest());
    expect(created.status).toBe(201);
    const createdBody = await created.json<{ data: { id: string } }>();
    const replayed = await SELF.fetch(await createRequest());
    expect(replayed.status).toBe(201);
    expect(replayed.headers.get("idempotency-replayed")).toBe("true");
    await expect(replayed.json()).resolves.toMatchObject({
      data: { id: createdBody.data.id },
    });

    const own = await SELF.fetch(
      await signedRequest("/internal/v1/reports", 12),
    );
    await expect(own.json()).resolves.toMatchObject({
      data: { items: [expect.objectContaining({ id: createdBody.data.id })] },
    });
    const other = await SELF.fetch(
      await signedRequest("/internal/v1/reports", 13),
    );
    await expect(other.json()).resolves.toEqual({ data: { items: [] } });
  });
});
