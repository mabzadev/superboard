import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../types";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import admin from "./admin";

const CUTOVER_TOKEN = "cutover-token-for-routing-tests";
const PROJECT_REF = "42-test";
const WINDOW_ID = "window-0001";
const PLAN_ID = "a".repeat(64);
const VERIFICATION_CHECKSUM = "b".repeat(64);

describe("Flows per-project legacy routing cutover", () => {
  it("requires cutover authorization, idempotency and exact verification evidence", async () => {
    const { environment } = testEnvironment();
    const application = testApplication();

    const unauthorized = await application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      { method: "GET" },
      environment,
    );
    expect(unauthorized.status).toBe(403);

    const missingIdempotency = await application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders(),
        body: JSON.stringify(validBody()),
      },
      environment,
    );
    expect(missingIdempotency.status).toBe(422);

    const missingEvidence = await application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders({ "idempotency-key": "routing-evidence-1" }),
        body: JSON.stringify({ enabled: true, window_id: WINDOW_ID }),
      },
      environment,
    );
    expect(missingEvidence.status).toBe(422);
    await expect(missingEvidence.json()).resolves.toMatchObject({
      error: { code: "flows_routing_evidence_invalid" },
    });
  });

  it("refuses routing changes unless the exact cutover window remains frozen", async () => {
    const { environment } = testEnvironment({
      maintenance: { enabled: 1, window_id: "another-window" },
    });
    const response = await testApplication().request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders({ "idempotency-key": "routing-frozen-1" }),
        body: JSON.stringify(validBody()),
      },
      environment,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "flows_routing_requires_freeze" },
    });
  });

  it("cannot enable routing before the private Flows binding is present", async () => {
    const { environment } = testEnvironment({
      maintenance: { enabled: 1, window_id: WINDOW_ID },
    });
    environment.FLOWS_MODULE = undefined;
    const response = await testApplication().request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders({ "idempotency-key": "routing-binding-1" }),
        body: JSON.stringify(validBody()),
      },
      environment,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "flows_service_unavailable", retryable: true },
    });
  });

  it("activates one project, exposes evidence, and replays the exact command only", async () => {
    const fixture = testEnvironment({
      maintenance: { enabled: 1, window_id: WINDOW_ID },
    });
    const application = testApplication();
    const request = () => application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders({ "idempotency-key": "routing-command-0001" }),
        body: JSON.stringify(validBody()),
      },
      fixture.environment,
    );

    const first = await request();
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toEqual({
      data: {
        project_ref: PROJECT_REF,
        project_id: 7,
        enabled: true,
        window_id: WINDOW_ID,
        plan_id: PLAN_ID,
        verification_checksum_sha256: VERIFICATION_CHECKSUM,
      },
    });
    expect(fixture.auditCount()).toBe(1);

    const status = await application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      { headers: authorizedHeaders() },
      fixture.environment,
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      data: {
        enabled: true,
        window_id: WINDOW_ID,
        plan_id: PLAN_ID,
        verification_checksum_sha256: VERIFICATION_CHECKSUM,
      },
    });

    const replay = await request();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotency-replayed")).toBe("true");
    expect(fixture.auditCount()).toBe(1);

    const conflict = await application.request(
      `/api/v1/admin/module-cutover/flows-routing/${PROJECT_REF}`,
      {
        method: "PUT",
        headers: authorizedHeaders({ "idempotency-key": "routing-command-0001" }),
        body: JSON.stringify(validBody({ enabled: false })),
      },
      fixture.environment,
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "idempotency_key_conflict" },
    });
    expect(fixture.auditCount()).toBe(1);
  });
});

function testApplication() {
  const application = new Hono<{ Bindings: Env }>();
  application.route("/api/v1/admin", admin);
  return application;
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    window_id: WINDOW_ID,
    plan_id: PLAN_ID,
    verification_checksum_sha256: VERIFICATION_CHECKSUM,
    ...overrides,
  };
}

function authorizedHeaders(overrides: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${CUTOVER_TOKEN}`,
    "content-type": "application/json",
    ...overrides,
  };
}

function testEnvironment(options: {
  maintenance?: { enabled: number; window_id: string | null } | null;
} = {}) {
  let routingState: Record<string, unknown> | null = null;
  let command: {
    idempotency_key: string;
    payload_checksum_sha256: string;
    response_json: string;
  } | null = null;
  let audits = 0;
  const DB = createFakeD1((call: FakeD1Call) => {
    if (call.sql.includes("SELECT id, instance_id, is_test")) {
      return {
        id: 7,
        instance_id: 42,
        is_test: 1,
        name: "Test project",
        identifier: "test-project",
      };
    }
    if (call.sql.includes("FROM flows_legacy_cutover_commands")) {
      if (!command || call.args[1] !== command.idempotency_key) return null;
      return command;
    }
    if (call.sql.includes("FROM module_cutover_maintenance")) {
      return options.maintenance ?? null;
    }
    if (
      call.sql.includes("FROM flows_legacy_cutover_state") &&
      call.op === "first"
    ) {
      return routingState;
    }
    if (call.sql.includes("INSERT INTO flows_legacy_cutover_state")) {
      routingState = {
        enabled: call.args[1],
        window_id: call.args[2],
        plan_id: call.args[3],
        verification_checksum_sha256: call.args[4],
        updated_by: call.args[5],
        updated_at: "2026-08-13T12:00:00.000Z",
      };
      return true;
    }
    if (call.sql.includes("INSERT INTO module_cutover_audit")) {
      audits += 1;
      return true;
    }
    if (call.sql.includes("INSERT INTO flows_legacy_cutover_commands")) {
      command = {
        idempotency_key: String(call.args[1]),
        payload_checksum_sha256: String(call.args[2]),
        response_json: String(call.args[3]),
      };
      return true;
    }
    throw new Error(`Unexpected D1 query: ${call.sql}`);
  });
  return {
    environment: {
      DB,
      OPENGROW_CUTOVER_TOKEN: CUTOVER_TOKEN,
      FLOWS_MODULE: {
        fetch: async () => new Response(null, { status: 204 }),
      } as Fetcher,
    } as Env,
    auditCount: () => audits,
  };
}
