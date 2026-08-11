import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { createFakeD1 } from "../test/fake-d1";
import adminRoutes from "./purchases-v2-admin";

describe("device certification administration", () => {
  it("creates a run with an expiring plaintext-once device challenge", async () => {
    const db = certificationDb();
    const response = await adminRoutes.request(
      "/10-prod/certification-runs",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenGrow-Internal-Actor": "7",
        },
        body: JSON.stringify({
          platform: "ios",
          environment: "sandbox",
          build_number: "104",
          app_version: "1.4.0",
          sdk_version: "2.1.3",
          device_model: "iPhone 16",
          os_version: "19.0",
        }),
      },
      baseEnv(db),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      data: Record<string, unknown>;
    };
    expect(payload.data).toMatchObject({
      id: "run-device-1",
      target_project_id: "21",
      device_result_endpoint:
        "https://sdk.example.com/purchases/v2/certification/device-results",
    });
    expect(payload.data.device_claim_token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(payload.data).not.toHaveProperty("challenge_hash");

    const challengeInsert = db.calls.find(
      (call) =>
        call.op === "run" &&
        call.sql.includes(
          "INSERT INTO billing_certification_device_challenges",
        ),
    )!;
    expect(challengeInsert.args[1]).toMatch(/^[a-f0-9]{64}$/u);
    expect(challengeInsert.args[1]).not.toBe(payload.data.device_claim_token);
    const audit = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("billing_admin_audit_logs"),
    )!;
    expect(String(audit.args[6])).not.toContain(
      String(payload.data.device_claim_token),
    );
  });

  it("lists immutable device results without returning raw evidence payloads", async () => {
    const db = certificationListDb();
    const response = await adminRoutes.request(
      "/10-prod/certification-runs",
      {
        headers: { "X-OpenGrow-Internal-Actor": "7" },
      },
      baseEnv(db),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Record<string, Array<Record<string, unknown>>>;
    };
    expect(payload.data.device_results).toEqual([
      expect.objectContaining({
        id: "device-result-1",
        run_id: "run-device-1",
        check_key: "apple.restore",
        outcome: "passed",
        evidence_sha256: "a".repeat(64),
      }),
    ]);
    expect(payload.data.device_results[0]).not.toHaveProperty("evidence_json");
  });

  it("requires a separate authenticated device result for provider-backed native evidence", async () => {
    const db = certificationObservationDb();
    const response = await adminRoutes.request(
      "/10-prod/certification-runs/run-device-1/observations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenGrow-Internal-Actor": "7",
        },
        body: JSON.stringify({
          check_key: "apple.weekly_purchase",
          outcome: "passed",
          reference_type: "billing_transaction",
          reference_id: "transaction-1",
        }),
      },
      baseEnv(db),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "device_result_id_invalid" },
    });
  });

  it("freezes provider and authenticated device evidence into one immutable observation", async () => {
    const evidenceJson = JSON.stringify({ source: "authenticated_sdk" });
    const db = certificationObservationDb(
      await sha256(evidenceJson),
      evidenceJson,
    );
    const response = await adminRoutes.request(
      "/10-prod/certification-runs/run-device-1/observations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenGrow-Internal-Actor": "7",
        },
        body: JSON.stringify({
          check_key: "apple.weekly_purchase",
          outcome: "passed",
          reference_type: "billing_transaction",
          reference_id: "transaction-1",
          device_result_id: "device-result-1",
        }),
      },
      baseEnv(db),
    );
    expect(response.status).toBe(201);
    const observationInsert = db.calls.find(
      (call) =>
        call.op === "run" &&
        call.sql.includes("INSERT INTO billing_certification_observations"),
    )!;
    const snapshot = JSON.parse(String(observationInsert.args[6]));
    expect(snapshot).toMatchObject({
      schema_version: 2,
      reference: { type: "billing_transaction", id: "transaction-1" },
      device_reference: {
        type: "test_run",
        id: "device-result-1",
        verified_record: {
          source: "authenticated_sdk",
          check_key: "apple.weekly_purchase",
        },
      },
    });
  });

  it("rejects paywall telemetry as proof of a native pending state", async () => {
    const db = certificationObservationDb();
    const response = await adminRoutes.request(
      "/10-prod/certification-runs/run-device-1/observations",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenGrow-Internal-Actor": "7",
        },
        body: JSON.stringify({
          check_key: "apple.pending",
          outcome: "passed",
          reference_type: "paywall_event",
          reference_id: "paywall-event-1",
        }),
      },
      baseEnv(db),
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "certification_reference_type_invalid" },
    });
  });
});

function certificationObservationDb(
  deviceDigest?: string,
  deviceEvidenceJson?: string,
) {
  return createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM instance_roles"))
      return { role: "owner" };
    if (
      call.op === "first" &&
      call.sql.includes(
        "SELECT id, name, identifier, instance_id, is_test FROM projects",
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
    if (
      call.op === "all" &&
      call.sql.includes("SELECT id, is_test FROM projects")
    ) {
      return [
        { id: 20, is_test: 0 },
        { id: 21, is_test: 1 },
      ];
    }
    if (
      call.op === "first" &&
      call.sql.includes("FROM billing_certification_runs")
    ) {
      return {
        id: "run-device-1",
        release_project_id: "20",
        target_project_id: "21",
        environment: "sandbox",
        platform: "ios",
        build_number: "104",
        app_version: "1.4.0",
        sdk_version: "2.1.3",
        device_model: "iPhone 16",
        os_version: "19.0",
        status: "running",
        started_at: "2026-08-04T11:55:00.000Z",
      };
    }
    if (call.op === "first" && call.sql.includes("FROM billing_transactions")) {
      return {
        id: "transaction-1",
        store: "apple",
        environment: "sandbox",
        status: "active",
        event_type: "initial_purchase",
        verified_at: "2026-08-04T11:59:30.000Z",
        event_occurred_at: "2026-08-04T11:59:00.000Z",
        store_product_id: "weekly-plan",
        metadata: '{"subscription_period":"ONE_WEEK"}',
        package_types: "weekly",
        period_type: "normal",
      };
    }
    if (
      call.op === "first" &&
      call.sql.includes("FROM billing_certification_device_results")
    ) {
      if (!deviceDigest || !deviceEvidenceJson) return null;
      return {
        id: "device-result-1",
        run_id: "run-device-1",
        target_project_id: "21",
        customer_id: "customer-1",
        check_key: "apple.weekly_purchase",
        outcome: "passed",
        source_platform: "ios",
        application_identifier: "com.example.app",
        build_number: "104",
        app_version: "1.4.0",
        sdk_version: "2.1.3",
        device_model: "iPhone 16",
        os_version: "19.0",
        evidence_json: deviceEvidenceJson,
        evidence_sha256: deviceDigest,
        observed_at: "2026-08-04T11:59:15.000Z",
        received_at: "2026-08-04T11:59:16.000Z",
      };
    }
    if (call.op === "run") return true;
    return undefined;
  });
}

function certificationListDb() {
  return createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM instance_roles"))
      return { role: "owner" };
    if (
      call.op === "first" &&
      call.sql.includes(
        "SELECT id, name, identifier, instance_id, is_test FROM projects",
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
    if (
      call.op === "all" &&
      call.sql.includes("SELECT id, is_test FROM projects")
    ) {
      return [
        { id: 20, is_test: 0 },
        { id: 21, is_test: 1 },
      ];
    }
    if (
      call.op === "all" &&
      call.sql.includes("FROM billing_certification_device_results d")
    ) {
      return [
        {
          id: "device-result-1",
          run_id: "run-device-1",
          target_project_id: "21",
          customer_id: "customer-1",
          check_key: "apple.restore",
          outcome: "passed",
          source_platform: "ios",
          application_identifier: "com.example.app",
          build_number: "104",
          evidence_sha256: "a".repeat(64),
          observed_at: "2026-08-04T12:00:00.000Z",
          received_at: "2026-08-04T12:00:01.000Z",
        },
      ];
    }
    if (call.op === "all" && call.sql.includes("SELECT o.*")) return [];
    if (
      call.op === "all" &&
      call.sql.includes("FROM billing_certification_runs r")
    ) {
      return [
        {
          id: "run-device-1",
          status: "running",
          observation_count: 0,
          device_result_count: 1,
        },
      ];
    }
    return undefined;
  });
}

function certificationDb() {
  return createFakeD1((call) => {
    if (call.op === "first" && call.sql.includes("FROM instance_roles"))
      return { role: "owner" };
    if (
      call.op === "first" &&
      call.sql.includes(
        "SELECT id, name, identifier, instance_id, is_test FROM projects",
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
    if (
      call.op === "all" &&
      call.sql.includes("SELECT id, is_test FROM projects")
    ) {
      return [
        { id: 20, is_test: 0 },
        { id: 21, is_test: 1 },
      ];
    }
    if (
      call.op === "first" &&
      call.sql.includes("INSERT INTO billing_certification_runs")
    ) {
      return {
        id: "run-device-1",
        release_project_id: "20",
        target_project_id: "21",
        environment: "sandbox",
        platform: "ios",
        build_number: "104",
        app_version: "1.4.0",
        sdk_version: "2.1.3",
        device_model: "iPhone 16",
        os_version: "19.0",
        status: "running",
        started_at: "2026-08-04 12:00:00",
      };
    }
    if (call.op === "run") return true;
    return undefined;
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
