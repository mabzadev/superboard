import { describe, expect, it } from "vitest";
import {
  signProjectContext,
  type InternalProjectContext,
} from "@opengrow/contracts/project-context";
import worker, { serializeSubscriber } from "./index";
import { encryptJson, decryptJson } from "./secrets";
import { buildMessage } from "./smtp";
import type { Env, SmtpPublicConfig } from "./types";

const env = {
  INTERNAL_API_TOKEN: "internal-secret",
  ENVIRONMENT: "test",
  D1_EXPECTED_MIGRATION: "0009_application_preferences.sql",
} as Env;
const healthEnv = {
  ...env,
  DB: {
    prepare: (query: string) => {
      const first = async () =>
        query.includes("opengrow_health_check")
          ? { opengrow_health_check: 1 }
          : query.includes("d1_migrations")
            ? {
                applied_migration_count: 9,
                expected_migration_applied: 1,
                latest_migration: "0009_application_preferences.sql",
              }
            : {
                subscribers_total: 20,
                subscribers_confirmed: 18,
                campaigns_total: 3,
                campaigns_running: 1,
                deliveries_total: 50,
                deliveries_successful: 45,
                deliveries_failed: 2,
                outbox_pending: 1,
              };
      return { first, bind: () => ({ first }) };
    },
  },
} as unknown as Env;

async function signedRequest(path: string, method = "GET") {
  const context: InternalProjectContext = {
    module: "marketing",
    method,
    pathname: path,
    projectId: 12,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test",
    actorId: 2,
    role: "owner",
    requestId: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  const signature = await signProjectContext(context, env.INTERNAL_API_TOKEN);
  return new Request(`https://marketing.internal${path}`, {
    method,
    headers: {
      "x-internal-token": env.INTERNAL_API_TOKEN,
      "x-project-id": String(context.projectId),
      "x-project-ref": context.projectRef,
      "x-instance-id": String(context.instanceId),
      "x-environment": context.environment,
      "x-actor-id": String(context.actorId),
      "x-role": context.role,
      "x-request-id": context.requestId,
      "x-context-issued-at": String(context.issuedAt),
      "x-context-version": "1",
      "x-context-signature": signature,
    },
  });
}

describe("marketing worker", () => {
  it("publishes a v1 health contract", async () => {
    const response = await worker.fetch(
      new Request("https://marketing.internal/internal/v1/health"),
      healthEnv,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      data: {
        service: "marketing",
        version: "v1",
        status: "ok",
        storage: "d1",
        metrics: {
          audience: { subscribers: 20, confirmedConsent: 18 },
          content: { campaigns: 3, running: 1 },
          deliveries: { total: 50, successful: 45, failed: 2 },
          outbox: { pending: 1, deadLetter: 0 },
        },
        schema: {
          status: "current",
          expectedMigration: "0009_application_preferences.sql",
          latestMigration: "0009_application_preferences.sql",
          appliedMigrationCount: 9,
        },
      },
    });
  });

  it("reports a degraded health state when D1 is unavailable", async () => {
    const response = await worker.fetch(
      new Request("https://marketing.internal/internal/v1/health"),
      {
        ...env,
        DB: {
          prepare: () => ({
            first: async () => {
              throw new Error("private failure");
            },
          }),
        },
      } as unknown as Env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("database_health_unavailable");
    expect(body).not.toContain("private failure");
  });

  it("accepts a signed gateway context and rejects unsigned requests", async () => {
    const valid = await worker.fetch(
      await signedRequest("/internal/v1"),
      env,
      {} as ExecutionContext,
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({
      data: { service: "marketing" },
    });
    const invalid = await worker.fetch(
      new Request("https://marketing.internal/internal/v1"),
      env,
      {} as ExecutionContext,
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({
      error: { code: "internal_auth_invalid" },
    });
  });

  it("returns the common error envelope for unknown signed routes", async () => {
    const response = await worker.fetch(
      await signedRequest("/internal/v1/not-a-route"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "route_not_found", retryable: false },
    });
  });

  it("encrypts SMTP credentials and never exposes plaintext", async () => {
    const encrypted = await encryptJson("encryption-key", {
      password: "private-password",
    });
    expect(encrypted).not.toContain("private-password");
    await expect(decryptJson("encryption-key", encrypted)).resolves.toEqual({
      password: "private-password",
    });
  });

  it("serializes subscribers with a public allowlist", () => {
    const serialized = serializeSubscriber({
      id: "subscriber-1",
      project_id: 12,
      email: "pending@example.com",
      name: "Pending",
      status: "enabled",
      consent_status: "pending",
      consent_source: "form",
      attributes_json: '{"plan":"pro"}',
      list_ids_json: '["list-1"]',
      optin_token_hash: "private-token-verifier",
      optin_token_expires_at: "2030-01-01T00:00:00.000Z",
      encrypted_payload: "private-outbox-payload",
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: null,
    });
    expect(serialized).toEqual({
      id: "subscriber-1",
      email: "pending@example.com",
      name: "Pending",
      status: "enabled",
      consent_status: "pending",
      consent_source: "form",
      attributes: { plan: "pro" },
      list_ids: ["list-1"],
      consented_at: undefined,
      unsubscribed_at: undefined,
      created_at: "2026-08-07T00:00:00.000Z",
      updated_at: null,
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /project_id|optin_token|attributes_json|list_ids_json|encrypted_payload/,
    );
  });

  it("builds injection-safe multipart messages", () => {
    const config: SmtpPublicConfig = {
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "mailer",
      from_email: "hello@example.com",
      from_name: "OpenGrow\r\nBcc: attacker@example.com",
      reply_to: null,
    };
    const message = buildMessage(config, {
      to: "customer@example.com",
      subject: "Welcome",
      html: "<b>Hello</b>",
      text: "Hello",
    });
    expect(message.raw).toContain("multipart/alternative");
    expect(message.raw).not.toContain("\r\nBcc: attacker@example.com");
  });
});
