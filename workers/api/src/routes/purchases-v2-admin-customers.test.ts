import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";

vi.mock("../lib/billing-identity", async (load) => {
  const actual =
    await load<typeof import("../lib/billing-identity")>();
  return {
    ...actual,
    signedCustomerInfo: vi.fn().mockResolvedValue({
      original_app_user_id: "user-1",
      aliases: [],
      entitlements: {},
      active_subscriptions: [],
      subscriptions: [],
      balances: {},
      signature: "signed-proof",
      signature_algorithm: "ES256",
      signature_key_id: "key-1",
    }),
  };
});

import adminRoutes from "./purchases-v2-admin";

describe("billing customer administration", () => {
  it("returns project/customer-scoped paywall activity with customer detail", async () => {
    const db = customerDb((call) => {
      if (
        call.op === "first" &&
        call.sql.includes("FROM billing_customers WHERE id = ?")
      ) {
        return {
          id: "customer-1",
          project_id: "20",
          primary_app_user_id: "user-1",
          blocked: 0,
        };
      }
      if (call.op === "all" && call.sql.includes("billing_paywall_events")) {
        return [
          {
            id: "paywall-event-1",
            paywall_id: "paywall-1",
            placement_identifier: "main",
            event_type: "purchase_started",
            occurred_at: "2026-08-09T10:00:00.000Z",
          },
        ];
      }
      if (call.op === "all") return [];
      return undefined;
    });

    const response = await adminRoutes.request(
      "/10-prod/customers/customer-1",
      { headers: { "X-OpenGrow-Internal-Actor": "7" } },
      baseEnv(db)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      customer: { id: "customer-1" },
      paywall_events: [
        {
          id: "paywall-event-1",
          event_type: "purchase_started",
        },
      ],
    });
    const query = db.calls.find(
      (call) => call.op === "all" && call.sql.includes("billing_paywall_events")
    );
    expect(query?.args).toEqual(["20", "customer-1"]);
  });
});

function customerDb(handler: (call: FakeD1Call) => unknown) {
  return createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM instance_roles"))
      return { role: "owner" };
    if (
      call.op === "first" &&
      call.sql.includes(
        "SELECT id, name, identifier, instance_id, is_test FROM projects"
      )
    ) {
      return {
        id: 20,
        name: "Production",
        identifier: "production",
        instance_id: 10,
        is_test: 0,
      };
    }
    return handler(call);
  });
}

function baseEnv(db: D1Database): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: "production",
    API_DOMAIN: "api.example.com",
    SHORTLINK_DOMAIN: "go.example.com",
    SDK_DOMAIN: "sdk.example.com",
    CORS_ORIGIN: "*",
    JWT_SECRET: "test",
    CREDENTIAL_KEY_SCOPE: "billing",
    AUTH_GATEWAY_ISSUER: "https://auth.example.com",
    AUTH_GATEWAY_AUDIENCE: "opengrow",
    AUTH_GATEWAY_JWKS_URL: "https://auth.example.com/.well-known/jwks.json",
  };
}
