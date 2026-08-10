import { describe, expect, it, vi } from "vitest";
import worker from "./index";

const metrics = {
  messages_total: 12,
  messages_transactional: 7,
  messages_marketing: 4,
  messages_test: 1,
  messages_captured: 0,
  messages_queued: 2,
  messages_sending: 1,
  messages_sent: 8,
  messages_failed: 1,
  deliveries_total: 15,
  deliveries_queued: 2,
  deliveries_sending: 1,
  deliveries_sent: 11,
  deliveries_failed: 1,
  delivery_attempts: 17,
};

function environment(overrides: Partial<Env> = {}): Env {
  return {
    DB: {
      prepare: (query: string) => {
        const first = async () =>
          query.includes("d1_migrations")
            ? {
                applied_migration_count: 3,
                expected_migration_applied: 1,
                latest_migration: "0003_email_idempotency.sql",
              }
            : metrics;
        return { first, bind: () => ({ first }) };
      },
    } as unknown as D1Database,
    EMAIL_QUEUE: {
      send: async () => undefined,
    } as unknown as Queue<EmailQueueJob>,
    ENVIRONMENT: "production",
    D1_EXPECTED_MIGRATION: "0003_email_idempotency.sql",
    MAIL_TRANSPORT: "smtp",
    MAIL_FROM_NAME: "OpenGrow",
    MAIL_FROM_ADDRESS: "noreply@example.test",
    EMAIL_INTERNAL_TOKEN: "internal-secret",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURITY: "starttls",
    ...overrides,
  };
}

describe("Email Worker health", () => {
  it("reports configuration plus transactional and marketing delivery state", async () => {
    const response = await worker.fetch(
      new Request("https://email.internal/health"),
      environment(),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "email",
      status: "ok",
      transport: "smtp",
      configuration: {
        senderConfigured: true,
        internalAuthenticationConfigured: true,
        queueConfigured: true,
        smtpConfigured: true,
      },
      metrics: {
        messages: { total: 12, transactional: 7, marketing: 4, failed: 1 },
        deliveries: { total: 15, queued: 2, failed: 1, attempts: 17 },
      },
    });
  });

  it("accepts the previous internal token during a bounded rotation", async () => {
    const response = await worker.fetch(
      new Request("https://email.internal/internal/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "previous-internal-secret",
        },
        body: "{}",
      }),
      environment({
        EMAIL_INTERNAL_TOKEN: "new-internal-secret",
        EMAIL_INTERNAL_TOKEN_PREVIOUS: "previous-internal-secret",
      }),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.not.toMatchObject({
      error: "unauthorized",
    });
  });

  it("deduplicates identical business events and rejects key reuse with another payload", async () => {
    const messages = new Map<string, StoredEmail>();
    const byKey = new Map<string, StoredEmail>();
    const deliveries: Array<{ messageId: string; recipient: string }> = [];
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => {
                if (
                  sql.includes("WHERE environment = ? AND idempotency_key = ?")
                ) {
                  return (
                    byKey.get(`${String(args[0])}:${String(args[1])}`) || null
                  );
                }
                return null;
              },
              run: async () => ({ success: true, meta: { changes: 0 } }),
              _sql: sql,
              _args: args,
            };
          },
        };
      },
      async batch(statements: Array<{ _sql: string; _args: unknown[] }>) {
        for (const statement of statements) {
          if (statement._sql.includes("INSERT OR IGNORE INTO email_messages")) {
            const args = statement._args;
            const key = `${String(args[1])}:${String(args[6])}`;
            if (!byKey.has(key)) {
              const stored: StoredEmail = {
                id: String(args[0]),
                status: String(args[16]),
                transport: String(args[2]),
                request_sha256: String(args[7]),
              };
              messages.set(stored.id, stored);
              byKey.set(key, stored);
            }
          } else if (statement._sql.includes("INSERT INTO email_deliveries")) {
            if (messages.has(String(statement._args[6]))) {
              deliveries.push({
                messageId: String(statement._args[1]),
                recipient: String(statement._args[2]),
              });
            }
          }
        }
        return [];
      },
    } as unknown as D1Database;
    const env = environment({
      DB: db,
      EMAIL_QUEUE: { send: queueSend } as unknown as Queue<EmailQueueJob>,
    });
    const request = (subject: string) =>
      new Request("https://email.internal/internal/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "internal-secret",
        },
        body: JSON.stringify({
          kind: "transactional",
          idempotencyKey: "identity.verify:token-1",
          to: "owner@example.com",
          subject,
          text: "Verify your address",
        }),
      });

    const first = await worker.fetch(
      request("Verify email"),
      env,
      {} as ExecutionContext,
    );
    const replay = await worker.fetch(
      request("Verify email"),
      env,
      {} as ExecutionContext,
    );
    const conflict = await worker.fetch(
      request("Different message"),
      env,
      {} as ExecutionContext,
    );

    expect(first.status).toBe(202);
    const firstReceipt = (await first.json()) as { id: string };
    await expect(replay.json()).resolves.toMatchObject({
      id: firstReceipt.id,
      replayed: true,
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({
      error: "idempotency_conflict",
    });
    expect(messages.size).toBe(1);
    expect(deliveries).toHaveLength(1);
    expect(queueSend).toHaveBeenCalledTimes(2);
  });

  it("fails closed when development capture is not protected", async () => {
    const response = await worker.fetch(
      new Request("https://email.internal/health"),
      environment({
        ENVIRONMENT: "development",
        MAIL_TRANSPORT: "capture",
        MAIL_PREVIEW_TOKEN: undefined,
      }),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "misconfigured",
    });
  });

  it("persists and redacts a DLQ message before acknowledging it", async () => {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              run: async () => {
                statements.push({ sql, args });
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const message = {
      id: "email-dead-letter-1",
      body: {
        type: "email.deliver",
        messageId: "mail-1",
        token: "private-mail-token",
      },
      attempts: 9,
      ack: vi.fn(),
      retry: vi.fn(),
    };

    await worker.queue(
      { queue: "email-dlq", messages: [message] } as any,
      environment({
        DB: db,
        EMAIL_DLQ_NAME: "email-dlq",
      }),
    );

    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
    const inserted = statements.find(({ sql }) =>
      sql.includes("INSERT OR IGNORE INTO email_dead_letters"),
    );
    expect(inserted?.args[4]).toBe(
      '{"type":"email.deliver","messageId":"mail-1","token":"[REDACTED]"}',
    );
    expect(inserted?.args[7]).toBe(0);
  });
});

type StoredEmail = {
  id: string;
  status: string;
  transport: string;
  request_sha256: string;
};
