import { describe, expect, it } from "vitest";
import worker, { mapConversationItem } from "./index";
import { decryptSecret, encryptSecret } from "./secrets";
import type { Env } from "./types";

const env = {
  INTERNAL_API_TOKEN: "internal-secret",
  ENVIRONMENT: "test",
  D1_EXPECTED_MIGRATION: "0008_support_dead_letters.sql",
  CORS_ORIGIN: "https://dashboard.example.test",
  ALLOWED_PROJECT_IDS: "11,12",
  DB: {
    prepare: (query: string) => {
      const first = async () =>
        query.includes("d1_migrations")
          ? {
              applied_migration_count: 9,
              expected_migration_applied: 1,
              latest_migration: "0008_support_dead_letters.sql",
            }
          : {
              contacts: 8,
              conversations_total: 5,
              conversations_open: 2,
              conversations_pending: 1,
              conversations_closed: 2,
              messages: 17,
              attachments: 3,
              webhooks_pending: 2,
              webhooks_failed: 1,
              dead_letters_quarantined: 2,
              csat_responses: 4,
              csat_average: 4.5,
            };
      return { first, bind: () => ({ first }) };
    },
  },
} as Env;

describe("support worker", () => {
  it("publishes an unauthenticated health contract", async () => {
    const response = await worker.fetch(
      new Request("https://support.internal/internal/v1/health"),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        service: "support",
        version: "v1",
        status: "ok",
        metrics: {
          contacts: 8,
          conversations: { total: 5, open: 2, pending: 1, closed: 2 },
          messages: 17,
          attachments: 3,
          webhooks: { pending: 2, failed: 1 },
          deadLetters: { quarantined: 2 },
          csat: { responses: 4, average: 4.5 },
        },
        schema: {
          status: "current",
          expectedMigration: "0008_support_dead_letters.sql",
          latestMigration: "0008_support_dead_letters.sql",
          appliedMigrationCount: 9,
        },
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects missing gateway authentication", async () => {
    const response = await worker.fetch(
      new Request("https://support.internal/internal/v1/conversations", {
        headers: { "x-project-id": "12" },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "internal_auth_invalid" },
    });
  });

  it("rejects an incomplete project context before touching D1", async () => {
    const response = await worker.fetch(
      new Request("https://support.internal/internal/v1/conversations", {
        headers: {
          "x-internal-token": "internal-secret",
          "x-project-id": "12",
        },
      }),
      env,
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "project_context_invalid" },
    });
  });

  it("fails closed when the public client selects another project", async () => {
    const { requireProject } = await import("./auth");
    expect(() => requireProject(env, "99")).toThrowError(
      expect.objectContaining({ code: "project_not_allowed", status: 403 }),
    );
    expect(requireProject(env, "12")).toBe(12);
  });

  it("encrypts webhook secrets with authenticated encryption", async () => {
    const encrypted = await encryptSecret(
      "support-encryption-key",
      "support-private-secret",
    );
    expect(encrypted).not.toContain("support-private-secret");
    await expect(
      decryptSecret("support-encryption-key", encrypted),
    ).resolves.toBe("support-private-secret");
    await expect(
      decryptSecret("different-key", encrypted),
    ).rejects.toMatchObject({ code: "webhook_secret_invalid" });
  });

  it("maps canonical Support conversations to Unified Inbox items", () => {
    expect(
      mapConversationItem({
        id: "conversation-1",
        subject: "Need help",
        last_message_preview: "Hello",
        status: "pending",
        priority: "urgent",
        external_user_id: "customer-1",
        updated_at: "2026-08-07T10:00:00.000Z",
      }),
    ).toMatchObject({
      id: "conversation:conversation-1",
      source_type: "conversation",
      source_id: "conversation-1",
      status: "pending",
      priority: "urgent",
      customer_reference: "customer-1",
      destination: "/support/inbox?type=conversation&id=conversation-1",
    });
  });
});
