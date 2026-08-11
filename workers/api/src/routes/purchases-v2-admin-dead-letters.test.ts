import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import adminRoutes from "./purchases-v2-admin";

describe("billing dead-letter administration", () => {
  it("lists quarantine metadata without exposing job payloads", async () => {
    const db = deadLetterDb((call) => {
      if (call.op === "all" && call.sql.includes("FROM billing_dead_letters")) {
        return [
          {
            id: "dead-1",
            queue_name: "opengrow-billing-dlq",
            job_type: "billing.google.voided.reconcile",
            job_payload_sha256: "a".repeat(64),
            job_valid: 1,
            delivery_attempts: 4,
            status: "quarantined",
            replay_available: 1,
          },
        ];
      }
      return undefined;
    });

    const response = await adminRoutes.request(
      "/10-prod/dead-letters",
      {
        headers: actorHeaders(),
      },
      baseEnv(db),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(payload.data[0]).toMatchObject({
      id: "dead-1",
      replay_available: 1,
    });
    expect(payload.data[0]).not.toHaveProperty("job_payload");
    expect(
      db.calls.find((call) => call.sql.includes("FROM billing_dead_letters"))
        ?.sql,
    ).not.toContain("job_payload,");
  });

  it("verifies integrity, atomically claims the job, queues it once, and audits the replay", async () => {
    const job = {
      type: "billing.google.voided.reconcile",
      projectId: "20",
    } as const;
    const serialized = JSON.stringify(job);
    const digest = await sha256Hex(serialized);
    const db = deadLetterDb((call) => {
      if (
        call.op === "first" &&
        call.sql.includes("FROM billing_dead_letters")
      ) {
        return {
          id: "dead-1",
          status: "quarantined",
          job_valid: 1,
          job_payload: serialized,
          job_payload_sha256: digest,
        };
      }
      if (call.op === "run") return true;
      return undefined;
    });
    const send = vi.fn().mockResolvedValue(undefined);

    const response = await adminRoutes.request(
      "/10-prod/dead-letters/dead-1/replay",
      {
        method: "POST",
        headers: actorHeaders(),
      },
      baseEnv(db, send),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ replay_queued: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(job);
    const claim = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("SET status = 'replay_queued'"),
    );
    expect(claim?.sql).toContain("status = 'quarantined'");
    const audit = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("billing_admin_audit_logs"),
    );
    expect(audit?.args).toContain("dead_letter.replay_queued");
  });

  it("returns the claim to quarantine when queue delivery fails", async () => {
    const job = {
      type: "billing.google.voided.reconcile",
      projectId: "20",
    } as const;
    const serialized = JSON.stringify(job);
    const digest = await sha256Hex(serialized);
    const db = deadLetterDb((call) => {
      if (
        call.op === "first" &&
        call.sql.includes("FROM billing_dead_letters")
      ) {
        return {
          id: "dead-1",
          status: "quarantined",
          job_valid: 1,
          job_payload: serialized,
          job_payload_sha256: digest,
        };
      }
      if (call.op === "run") return true;
      return undefined;
    });

    const response = await adminRoutes.request(
      "/10-prod/dead-letters/dead-1/replay",
      {
        method: "POST",
        headers: actorHeaders(),
      },
      baseEnv(db, vi.fn().mockRejectedValue(new Error("queue unavailable"))),
    );

    expect(response.status).toBe(503);
    const restore = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("SET status = 'quarantined'"),
    );
    expect(restore).toBeDefined();
    expect(
      db.calls.some((call) => call.sql.includes("billing_admin_audit_logs")),
    ).toBe(false);
  });

  it("allows an administrator to discard a quarantined job with an audit trail", async () => {
    const db = deadLetterDb((call) => (call.op === "run" ? true : undefined));

    const response = await adminRoutes.request(
      "/10-prod/dead-letters/dead-1/discard",
      {
        method: "POST",
        headers: actorHeaders(),
      },
      baseEnv(db),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ discarded: true });
    const discard = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("SET status = 'discarded'"),
    );
    expect(discard?.args).toEqual(["7", "dead-1", "20"]);
    const audit = db.calls.find(
      (call) =>
        call.op === "run" && call.sql.includes("billing_admin_audit_logs"),
    );
    expect(audit?.args).toContain("dead_letter.discarded");
  });
});

function deadLetterDb(handler: (call: FakeD1Call) => unknown) {
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
    return handler(call);
  });
}

function actorHeaders() {
  return { "X-OpenGrow-Internal-Actor": "7" };
}

function baseEnv(
  db: D1Database,
  send = vi.fn().mockResolvedValue(undefined),
): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    BILLING_QUEUE: { send } as unknown as Queue,
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

async function sha256Hex(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
