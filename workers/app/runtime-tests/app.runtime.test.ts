import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { signProjectContext } from "@superboard/contracts";
import { describe, expect, it } from "vitest";

const secret = "app-runtime-secret";

describe("App Worker with D1", () => {
  it("aggregates acquisition activity and returns a stable customer upsert id", async () => {
    const referrer = await createCustomer("referrer-a", "referrer-a");
    const invited = await createCustomer("invited-a", "invited-a");
    const repeated = await createCustomer("invited-a", "invited-a-repeat", {
      name: "Updated invited customer",
    });
    expect(repeated.id).toBe(invited.id);

    const replay = await mutate(
      "POST",
      "/internal/v1/customers",
      { external_id: "invited-a", name: "Updated invited customer" },
      "invited-a-repeat",
    );
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");

    const referral = await mutate(
      "POST",
      "/internal/v1/referrals",
      {
        code: "REFERRER-A",
        customer_id: referrer.id,
        invited_customer_id: invited.id,
        status: "converted",
        converted_at: "2026-08-07T12:00:00Z",
      },
      "referral-a",
    );
    expect(referral.status).toBe(200);

    const eventTypes = [
      "view",
      "open",
      "install",
      "reinstall",
      "reactivation",
      "app_open",
      "user_referred",
    ];
    const events: Array<Record<string, unknown>> = eventTypes.map(
      (type, index) => ({
        id: `event-a-${index}`,
        customer_id: invited.id,
        referrer_customer_id: referrer.id,
        type,
        platform: "ios",
        occurred_at: `2026-08-07T10:0${index}:00Z`,
      }),
    );
    events.push({
      id: "event-a-time",
      customer_id: invited.id,
      referrer_customer_id: referrer.id,
      type: "time_spent",
      platform: "ios",
      occurred_at: "2026-08-07 10:08:00",
      engagement_time: 45,
    });
    events.push({
      id: "event-a-purchase",
      customer_id: invited.id,
      referrer_customer_id: referrer.id,
      type: "purchase",
      platform: "ios",
      occurred_at: "2026-08-07T10:09:00Z",
      revenue_cents: 1499,
    });
    events.push({
      id: "event-a-refund",
      customer_id: invited.id,
      referrer_customer_id: referrer.id,
      type: "refund",
      platform: "ios",
      occurred_at: "2026-08-07T10:10:00Z",
      revenue_cents: 200,
    });
    expect(
      (
        await mutate(
          "POST",
          "/internal/v1/customer-events",
          { events },
          "events-a",
        )
      ).status,
    ).toBe(200);

    const customers = await json<{
      data: Array<Record<string, unknown>>;
      meta: { total: number };
    }>(
      await request(
        "GET",
        "/internal/v1/customers?from=2026-08-07&to=2026-08-07&platform=ios",
      ),
    );
    expect(
      customers.data.find((row) => row.external_id === "invited-a"),
    ).toMatchObject({
      total_views: 1,
      total_opens: 1,
      total_installs: 1,
      total_reinstalls: 1,
      total_reactivations: 1,
      total_app_opens: 1,
      total_user_referred: 1,
      total_time_spent: 45,
      total_revenue: 1299,
    });

    const referrals = await data<Array<Record<string, unknown>>>(
      await request(
        "GET",
        "/internal/v1/referrals?from=2026-08-07&to=2026-08-07&platform=ios",
      ),
    );
    expect(referrals.find((row) => row.code === "REFERRER-A")).toMatchObject({
      views: 1,
      opens: 1,
      installs: 1,
      reinstalls: 1,
      reactivations: 1,
      invited_users: 1,
      time_spent: 45,
      total_revenue: 1299,
    });

    const access = await mutate(
      "POST",
      "/internal/v1/access-key/rotate",
      {},
      "access-a",
    );
    expect((await data<{ secret: string }>(access)).secret).toMatch(/^og_app_/);
    expect(
      (
        await mutate(
          "PUT",
          "/internal/v1/setup/ios",
          {
            bundle_id: "com.example.app",
            team_id: "TEAM123",
            push_credential_reference: "secret://push/apns-main",
            store_credential_reference: "operator://store/app-store-main",
            minimum_version: "2.0.0",
            recommended_version: "2.1.0",
            maintenance_enabled: false,
            maintenance_message: "A short maintenance window is in progress.",
            store_url: "https://apps.example.test/vocostar",
          },
          "setup-a",
        )
      ).status,
    ).toBe(200);
    const configuration = await data<{
      configuration: Record<string, unknown>;
    }>(await request("GET", "/internal/v1/setup/ios"));
    expect(configuration.configuration).toMatchObject({
      push_credential_reference: "secret://push/apns-main",
      store_credential_reference: "operator://store/app-store-main",
    });
    expect(configuration.configuration).not.toHaveProperty("push_credential");
    const runtimePolicy = await data<Record<string, any>>(
      await request(
        "POST",
        "/internal/v1/runtime-policy/resolve",
        { app_version: "1.9.0", build: "190" },
        11,
        undefined,
        { PLATFORM: "ios" },
      ),
    );
    expect(runtimePolicy).toMatchObject({
      status: "update_required",
      update: {
        required: true,
        available: true,
        minimum_version: "2.0.0",
        recommended_version: "2.1.0",
      },
    });
    const rejectedSecret = await mutate(
      "PUT",
      "/internal/v1/setup/android",
      {
        package_name: "com.example.app",
        sha256: "AA:BB",
        store_credential: "private-key-material",
      },
      "setup-secret-rejected",
    );
    expect(rejectedSecret.status).toBe(422);
    await expect(rejectedSecret.json()).resolves.toMatchObject({
      error: { code: "configuration_secret_forbidden" },
    });
    const rejectedNestedSecret = await mutate(
      "PUT",
      "/internal/v1/setup/android",
      {
        package_name: "com.example.app",
        sha256: "AA:BB",
        provider: { private_key: "nested-private-key-material" },
      },
      "setup-nested-secret-rejected",
    );
    expect(rejectedNestedSecret.status).toBe(422);
    await expect(rejectedNestedSecret.json()).resolves.toMatchObject({
      error: {
        code: "configuration_secret_forbidden",
        details: { forbidden: ["configuration.provider.private_key"] },
      },
    });
    await expect(
      (
        await mutate("POST", "/internal/v1/setup/ios/test", {}, "setup-test-a")
      ).json(),
    ).resolves.toMatchObject({ data: { ok: true, platform: "ios" } });
  });

  it("isolates metrics for multiple referrers and invited customers", async () => {
    const referrer = await createCustomer("referrer-b", "referrer-b");
    const invited = await createCustomer("invited-b", "invited-b");
    await mutate(
      "POST",
      "/internal/v1/referrals",
      {
        code: "REFERRER-B",
        customer_id: referrer.id,
        invited_customer_id: invited.id,
        status: "converted",
      },
      "referral-b",
    );
    await mutate(
      "POST",
      "/internal/v1/customer-events",
      {
        events: [
          {
            id: "event-b-view",
            customer_id: invited.id,
            referrer_customer_id: referrer.id,
            type: "view",
            platform: "android",
            occurred_at: "2026-08-07T14:00:00Z",
          },
          {
            id: "event-b-purchase",
            customer_id: invited.id,
            referrer_customer_id: referrer.id,
            type: "purchase",
            platform: "android",
            occurred_at: "2026-08-07T14:01:00Z",
            revenue_cents: 500,
          },
        ],
      },
      "events-b",
    );

    const referrals = await data<Array<Record<string, unknown>>>(
      await request(
        "GET",
        "/internal/v1/referrals?from=2026-08-07&to=2026-08-07",
      ),
    );
    expect(referrals.find((row) => row.code === "REFERRER-A")).toMatchObject({
      views: 1,
      total_revenue: 1299,
    });
    expect(referrals.find((row) => row.code === "REFERRER-B")).toMatchObject({
      views: 1,
      total_revenue: 500,
    });
  });

  it("applies IANA timezone day boundaries and rejects invalid dates", async () => {
    const customer = await createCustomer(
      "timezone-customer",
      "timezone-customer",
    );
    const events = [
      ["before", "2026-08-06T21:59:59Z"],
      ["start", "2026-08-06T22:00:00Z"],
      ["end", "2026-08-07T21:59:59Z"],
      ["after", "2026-08-07T22:00:00Z"],
    ].map(([suffix, occurredAt]) => ({
      id: `timezone-${suffix}`,
      customer_id: customer.id,
      type: "view",
      platform: "web",
      occurred_at: occurredAt,
    }));
    expect(
      (
        await mutate(
          "POST",
          "/internal/v1/customer-events",
          { events },
          "timezone-events",
        )
      ).status,
    ).toBe(200);

    const result = await json<{ data: Array<Record<string, unknown>> }>(
      await request(
        "GET",
        "/internal/v1/customers?search=timezone-customer&from=2026-08-07&to=2026-08-07&timezone=Europe%2FZurich",
      ),
    );
    expect(result.data[0]).toMatchObject({ total_views: 2 });

    const malformedTimestamp = await mutate(
      "POST",
      "/internal/v1/customer-events",
      {
        events: [
          {
            id: "invalid-timestamp",
            customer_id: customer.id,
            type: "view",
            occurred_at: "not-a-date",
          },
        ],
      },
      "invalid-timestamp",
    );
    expect(malformedTimestamp.status).toBe(422);
    await expect(malformedTimestamp.json()).resolves.toMatchObject({
      error: { code: "timestamp_invalid" },
    });

    for (const path of [
      "/internal/v1/customers?from=2026-99-99",
      "/internal/v1/customers?timezone=Invalid%2FZone",
    ]) {
      const response = await request("GET", path);
      expect(response.status).toBe(422);
    }
  });

  it("enforces composite project foreign keys", async () => {
    const owned = await createCustomer("owned-project-11", "owned-project-11");
    const foreignEvent = await mutate(
      "POST",
      "/internal/v1/customer-events",
      {
        events: [
          {
            id: "foreign-event",
            customer_id: owned.id,
            type: "view",
            occurred_at: "2026-08-07T11:00:00Z",
          },
        ],
      },
      "foreign-events",
      12,
    );
    expect(foreignEvent.status).toBe(404);

    await expect(
      env.DB.prepare(
        "INSERT INTO customer_events (id,project_id,customer_id,event_type,occurred_at) VALUES (?,?,?,?,?)",
      )
        .bind(
          "direct-cross-project-event",
          "12",
          owned.id,
          "view",
          "2026-08-07T11:00:00Z",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "INSERT INTO referrals (id,project_id,customer_id,code) VALUES (?,?,?,?)",
      )
        .bind("direct-cross-project-referral", "12", owned.id, "CROSS")
        .run(),
    ).rejects.toThrow();
  });

  it("cascades customer deletion through referrals and customer events", async () => {
    const referrer = await createCustomer("delete-referrer", "delete-referrer");
    const invited = await createCustomer("delete-invited", "delete-invited");
    const referral = await data<{ id: string }>(
      await mutate(
        "POST",
        "/internal/v1/referrals",
        {
          code: "DELETE-ME",
          customer_id: referrer.id,
          invited_customer_id: invited.id,
        },
        "delete-referral",
      ),
    );
    await mutate(
      "POST",
      "/internal/v1/customer-events",
      {
        events: [
          {
            id: "delete-event",
            customer_id: invited.id,
            referrer_customer_id: referrer.id,
            type: "view",
            occurred_at: "2026-08-07T15:00:00Z",
          },
        ],
      },
      "delete-event",
    );

    expect(
      (
        await mutate(
          "DELETE",
          `/internal/v1/customers/${invited.id}`,
          undefined,
          "delete-customer",
        )
      ).status,
    ).toBe(200);
    expect(
      await env.DB.prepare("SELECT id FROM referrals WHERE id=?")
        .bind(referral.id)
        .first(),
    ).toBeNull();
    expect(
      await env.DB.prepare("SELECT id FROM customer_events WHERE id=?")
        .bind("delete-event")
        .first(),
    ).toBeNull();
  });

  it("erases every application-customer projection idempotently", async () => {
    const erased = await createCustomer(
      "application-erasure-subject",
      "application-erasure-customer",
    );
    const retained = await createCustomer(
      "application-erasure-retained",
      "application-erasure-retained-customer",
    );
    await mutate(
      "POST",
      "/internal/v1/referrals",
      {
        code: "APPLICATION-ERASURE",
        customer_id: retained.id,
        invited_customer_id: erased.id,
      },
      "application-erasure-referral",
    );
    await mutate(
      "POST",
      "/internal/v1/customer-events",
      {
        events: [
          {
            id: "application-erasure-event",
            customer_id: erased.id,
            referrer_customer_id: retained.id,
            type: "view",
            occurred_at: "2026-08-08T10:00:00Z",
          },
        ],
      },
      "application-erasure-event",
    );

    const first = await mutate(
      "DELETE",
      "/internal/v1/application/users/application-erasure-subject",
      undefined,
      "application-erasure-operation",
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      data: { erased: true, customers_deleted: 1 },
    });
    const replay = await mutate(
      "DELETE",
      "/internal/v1/application/users/application-erasure-subject",
      undefined,
      "application-erasure-operation",
    );
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");

    const [customers, referrals, events] = await env.DB.batch([
      env.DB.prepare(
        "SELECT external_id FROM customers WHERE project_id = 11 ORDER BY external_id",
      ),
      env.DB.prepare(
        "SELECT COUNT(*) total FROM referrals WHERE project_id = 11 AND invited_customer_id = ?",
      ).bind(erased.id),
      env.DB.prepare(
        "SELECT COUNT(*) total FROM customer_events WHERE project_id = 11 AND customer_id = ?",
      ).bind(erased.id),
    ]);
    expect(customers.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          external_id: "application-erasure-retained",
        }),
      ]),
    );
    expect(customers.results).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          external_id: "application-erasure-subject",
        }),
      ]),
    );
    expect(referrals.results[0]).toMatchObject({ total: 0 });
    expect(events.results[0]).toMatchObject({ total: 0 });
  });

  it("isolates project reads", async () => {
    const response = await request(
      "GET",
      "/internal/v1/customers?search=owned-project-11",
      undefined,
      12,
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
  });
});

async function createCustomer(
  externalId: string,
  key: string,
  extra: Record<string, unknown> = {},
) {
  return data<{ id: string; external_id: string }>(
    await mutate(
      "POST",
      "/internal/v1/customers",
      {
        external_id: externalId,
        platform: "ios",
        attributes: {},
        ...extra,
      },
      key,
    ),
  );
}

async function mutate(
  method: string,
  path: string,
  body: unknown,
  key: string,
  projectId = 11,
) {
  return request(method, path, body, projectId, key);
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  projectId = 11,
  key?: string,
  extraHeaders: Record<string, string> = {},
) {
  const pathname = new URL(path, "https://app.internal").pathname;
  const issuedAt = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "app" as const,
    method,
    pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test" as const,
    actorId: 2,
    role: "owner",
    requestId,
    issuedAt,
  };
  const headers = new Headers({
    "x-internal-token": secret,
    "x-project-id": String(projectId),
    "x-project-ref": "10-test",
    "x-instance-id": "10",
    "x-environment": "test",
    "x-actor-id": "2",
    "x-role": "owner",
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key) headers.set("idempotency-key", key);
  for (const [name, value] of Object.entries(extraHeaders))
    headers.set(name, value);
  return SELF.fetch(`https://app.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function data<T>(response: Response): Promise<T> {
  return (await json<{ data: T }>(response)).data;
}
