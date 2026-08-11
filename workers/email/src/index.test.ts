import { beforeEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@superboard/email-transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@superboard/email-transport")>()),
  sendSmtpMessage: smtp.send,
}));
import { EmailTransportError } from "@superboard/email-transport";
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
  dead_letters_quarantined: 2,
  dead_letters_replayed: 3,
  dead_letters_discarded: 1,
  transport_total: 5,
  transport_sending: 1,
  transport_sent: 2,
  transport_failed: 1,
  transport_outcome_unknown: 1,
  transport_attempts: 7,
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
                latest_migration: "0006_email_transport_outcome.sql",
              }
            : metrics;
        return { first, bind: () => ({ first }) };
      },
    } as unknown as D1Database,
    EMAIL_QUEUE: {
      send: async () => undefined,
      metrics: async () => ({
        backlogCount: 3,
        backlogBytes: 1_024,
        oldestMessageTimestamp: new Date("2026-08-10T09:59:00.000Z"),
      }),
    } as unknown as Queue<EmailQueueJob>,
    ENVIRONMENT: "production",
    D1_EXPECTED_MIGRATION: "0006_email_transport_outcome.sql",
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

function delegatedSmtpRequest() {
  return new Request("https://email.internal/internal/v1/transport/smtp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-token": "internal-secret",
    },
    body: JSON.stringify({
      idempotencyKey: "marketing.campaign:12:delivery-1:profile-1",
      source: "marketing",
      projectId: 12,
      referenceId: "delivery-1",
      profileId: "profile-1",
      publicConfig: {
        host: "smtp.example.test",
        port: 587,
        security: "starttls",
        username: "mailer",
        from_email: "sender@example.test",
        from_name: "OpenGrow",
        reply_to: null,
      },
      secret: { password: "private-password" },
      message: {
        to: "recipient@example.test",
        subject: "Welcome",
        text: "Personalized and tracked body",
        html: null,
      },
    }),
  });
}

describe("Email Worker health", () => {
  beforeEach(() => {
    smtp.send.mockReset();
  });
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
        deadLetters: { quarantined: 2, replayed: 3, discarded: 1 },
        delegatedTransport: {
          total: 5,
          sent: 2,
          failed: 1,
          outcomeUnknown: 1,
          attempts: 7,
        },
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

  it("is the idempotent SMTP authority for delegated Marketing delivery", async () => {
    let row: {
      id: string;
      request_sha256: string;
      status: "sending" | "sent" | "failed" | "outcome_unknown";
      provider_message_id: string | null;
      provider_response: string | null;
      lease_expires_at: string | null;
    } | null = null;
    const persistedArguments: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            persistedArguments.push(args);
            return {
              first: async () => {
                if (
                  sql.includes(
                    "INSERT OR IGNORE INTO email_transport_deliveries",
                  )
                ) {
                  if (row) return null;
                  row = {
                    id: String(args[0]),
                    request_sha256: String(args[2]),
                    status: "sending",
                    provider_message_id: null,
                    provider_response: null,
                    lease_expires_at: String(args[7]),
                  };
                  return { id: row.id };
                }
                if (
                  sql.includes(
                    "FROM email_transport_deliveries WHERE idempotency_key",
                  )
                )
                  return row;
                return null;
              },
              run: async () => {
                if (sql.includes("SET status = 'sent'") && row) {
                  row.status = "sent";
                  row.provider_message_id = String(args[0]);
                  row.provider_response = String(args[1]);
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    smtp.send.mockResolvedValue({
      messageId: "provider-message-1",
      response: "accepted",
    });
    const env = environment({ DB: db });
    const first = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );
    const replay = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      status: "sent",
      messageId: "provider-message-1",
      replayed: true,
    });
    expect(smtp.send).toHaveBeenCalledTimes(1);
    const delegatedMessage = smtp.send.mock.calls[0]![2] as {
      messageId: string;
    };
    expect(delegatedMessage.messageId).toMatch(
      /^<opengrow-[a-f0-9]{48}@example\.test>$/,
    );
    expect(JSON.stringify(persistedArguments)).not.toContain(
      "private-password",
    );
  });

  it("never re-sends a key when D1 fails after provider acceptance", async () => {
    let status: "sending" | "outcome_unknown" = "sending";
    let sentPersistenceAttempted = false;
    const row = {
      id: "transport-1",
      request_sha256: "",
      status,
      provider_message_id: null as string | null,
      provider_response: null as string | null,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => {
                if (
                  sql.includes(
                    "INSERT OR IGNORE INTO email_transport_deliveries",
                  )
                ) {
                  if (row.request_sha256) return null;
                  row.request_sha256 = String(args[2]);
                  return { id: row.id };
                }
                if (
                  sql.includes(
                    "FROM email_transport_deliveries WHERE idempotency_key",
                  )
                )
                  return { ...row, status };
                return null;
              },
              run: async () => {
                if (sql.includes("SET status = 'sent'")) {
                  sentPersistenceAttempted = true;
                  throw new Error("D1 commit unavailable after SMTP 250");
                }
                if (sql.includes("SET status = 'outcome_unknown'")) {
                  status = "outcome_unknown";
                  row.provider_message_id = String(args[0]);
                  row.provider_response = String(args[1]);
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    smtp.send.mockResolvedValue({
      messageId: "provider-message-accepted",
      response: "accepted",
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = environment({ DB: db });

    const first = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );
    const reuse = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );

    expect(sentPersistenceAttempted).toBe(true);
    expect(first.status).toBe(503);
    await expect(first.json()).resolves.toEqual({
      error: "email_transport_outcome_unknown",
    });
    expect(reuse.status).toBe(409);
    await expect(reuse.json()).resolves.toEqual({
      error: "email_transport_outcome_unknown",
    });
    expect(status).toBe("outcome_unknown");
    expect(smtp.send).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("quarantines an unconfirmed provider outcome without re-sending the key", async () => {
    let status: "sending" | "outcome_unknown" = "sending";
    let requestHash = "";
    const lease = new Date(Date.now() + 60_000).toISOString();
    const db = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => {
                if (
                  sql.includes(
                    "INSERT OR IGNORE INTO email_transport_deliveries",
                  )
                ) {
                  if (requestHash) return null;
                  requestHash = String(args[2]);
                  return { id: "transport-1" };
                }
                if (
                  sql.includes(
                    "FROM email_transport_deliveries WHERE idempotency_key",
                  )
                ) {
                  return {
                    id: "transport-1",
                    request_sha256: requestHash,
                    status,
                    provider_message_id: null,
                    provider_response: null,
                    lease_expires_at: lease,
                  };
                }
                return null;
              },
              run: async () => {
                if (String(args[0]) === "outcome_unknown") {
                  status = "outcome_unknown";
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    smtp.send.mockRejectedValue(
      new EmailTransportError(
        "smtp_outcome_unknown",
        "SMTP acceptance could not be confirmed",
        503,
      ),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = environment({ DB: db });

    const first = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );
    const reuse = await worker.fetch(
      delegatedSmtpRequest(),
      env,
      {} as ExecutionContext,
    );

    expect(first.status).toBe(503);
    expect(reuse.status).toBe(409);
    expect(smtp.send).toHaveBeenCalledTimes(1);
    expect(status).toBe("outcome_unknown");
    log.mockRestore();
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

  it("returns a body-free operational projection through internal authentication", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              all: async () => ({
                results: sql.includes("FROM email_messages message")
                  ? [
                      {
                        id: "mail-1",
                        kind: "transactional",
                        project_id: 12,
                        template_key: "identity.verify",
                        subject: "Verify your email",
                        status: "failed",
                        transport: "smtp",
                        recipient_count: 1,
                        failed_recipients: 1,
                        attempts: 4,
                        last_error: "SMTP unavailable",
                        created_at: "2026-08-10T10:00:00.000Z",
                        updated_at: "2026-08-10T10:05:00.000Z",
                        sent_at: null,
                        html_body: "must-not-leak",
                      },
                    ]
                  : sql.includes("FROM email_transport_deliveries")
                    ? [
                        {
                          id: "transport-1",
                          source: "marketing",
                          project_id: 12,
                          reference_id: "delivery-1",
                          profile_id: "profile-1",
                          status: "outcome_unknown",
                          attempt_count: 1,
                          provider_message_id: "provider-message-1",
                          last_error: "D1 receipt persistence failed",
                          created_at: "2026-08-10T10:04:00.000Z",
                          updated_at: "2026-08-10T10:05:30.000Z",
                          sent_at: null,
                        },
                      ]
                    : [
                        {
                          id: "11111111-1111-4111-8111-111111111111",
                          source_queue: "email-delivery-dlq",
                          message_id: "queue-message-1",
                          job_type: "email.deliver",
                          payload_json: JSON.stringify({
                            type: "email.deliver",
                            messageId: "mail-1",
                          }),
                          replayable: 1,
                          attempts: 9,
                          status: "quarantined",
                          resolution: null,
                          received_at: "2026-08-10T10:06:00.000Z",
                          resolved_at: null,
                        },
                      ],
              }),
            };
          },
        };
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new Request(
        "https://email.internal/internal/v1/operations?status=failed",
        {
          headers: { "x-internal-token": "internal-secret" },
        },
      ),
      environment({ DB: db }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(body).toMatchObject({
      queue: {
        backlogCount: 3,
        backlogBytes: 1_024,
        oldestMessageAt: "2026-08-10T09:59:00.000Z",
      },
      messages: [
        {
          id: "mail-1",
          status: "failed",
          recipientCount: 1,
          failedRecipients: 1,
          attempts: 4,
        },
      ],
      transportDeliveries: [
        {
          id: "transport-1",
          source: "marketing",
          projectId: 12,
          referenceId: "delivery-1",
          profileId: "profile-1",
          status: "outcome_unknown",
          attempts: 1,
          providerMessageId: "provider-message-1",
          lastError: "D1 receipt persistence failed",
        },
      ],
      deadLetters: [
        {
          queueMessageId: "queue-message-1",
          emailMessageId: "mail-1",
          replayable: true,
          status: "quarantined",
        },
      ],
    });
  });

  it("claims and audits a replayable DLQ job before re-enqueueing it", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("SELECT id, payload_json")) {
                  return {
                    id: "11111111-1111-4111-8111-111111111111",
                    payload_json: JSON.stringify({
                      type: "email.deliver",
                      messageId: "mail-1",
                    }),
                    replayable: 1,
                    status: "quarantined",
                  };
                }
                if (sql.includes("UPDATE email_dead_letters")) {
                  return { id: "11111111-1111-4111-8111-111111111111" };
                }
                return null;
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const response = await worker.fetch(
      new Request(
        "https://email.internal/internal/v1/operations/dead-letters/11111111-1111-4111-8111-111111111111/replay",
        {
          method: "POST",
          headers: { "x-internal-token": "internal-secret" },
        },
      ),
      environment({
        DB: db,
        EMAIL_QUEUE: { send: queueSend } as unknown as Queue<EmailQueueJob>,
      }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      status: "replayed",
      messageId: "mail-1",
    });
    expect(queueSend).toHaveBeenCalledWith({
      type: "email.deliver",
      messageId: "mail-1",
    });
  });

  it("refuses to replay a redacted DLQ payload", async () => {
    const queueSend = vi.fn().mockResolvedValue(undefined);
    const db = {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({
                id: "11111111-1111-4111-8111-111111111111",
                payload_json: JSON.stringify({
                  type: "email.deliver",
                  messageId: "mail-1",
                  token: "[REDACTED]",
                }),
                replayable: 0,
                status: "quarantined",
              }),
            };
          },
        };
      },
    } as unknown as D1Database;
    const response = await worker.fetch(
      new Request(
        "https://email.internal/internal/v1/operations/dead-letters/11111111-1111-4111-8111-111111111111/replay",
        {
          method: "POST",
          headers: { "x-internal-token": "internal-secret" },
        },
      ),
      environment({
        DB: db,
        EMAIL_QUEUE: { send: queueSend } as unknown as Queue<EmailQueueJob>,
      }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "dead_letter_not_replayable",
    });
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("returns a failed replay to quarantine when Queue dispatch rejects it", async () => {
    let status = "quarantined";
    let resolution: string | null = null;
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              first: async () => {
                if (sql.includes("SELECT id, payload_json")) {
                  return {
                    id: "11111111-1111-4111-8111-111111111111",
                    payload_json: JSON.stringify({
                      type: "email.deliver",
                      messageId: "mail-1",
                    }),
                    replayable: 1,
                    status,
                  };
                }
                if (sql.includes("SET status = 'discarded'")) {
                  status = "discarded";
                  resolution = "replayed";
                  return { id: "11111111-1111-4111-8111-111111111111" };
                }
                return null;
              },
              run: async () => {
                if (sql.includes("SET status = 'quarantined'")) {
                  status = "quarantined";
                  resolution = null;
                }
                return { success: true, meta: { changes: 1 } };
              },
            };
          },
        };
      },
    } as unknown as D1Database;
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await worker.fetch(
      new Request(
        "https://email.internal/internal/v1/operations/dead-letters/11111111-1111-4111-8111-111111111111/replay",
        {
          method: "POST",
          headers: { "x-internal-token": "internal-secret" },
        },
      ),
      environment({
        DB: db,
        EMAIL_QUEUE: {
          send: vi.fn().mockRejectedValue(new Error("Queue unavailable")),
        } as unknown as Queue<EmailQueueJob>,
      }),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "dead_letter_replay_failed",
    });
    expect({ status, resolution }).toEqual({
      status: "quarantined",
      resolution: null,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("email_dead_letter_replay_failed"),
    );
    log.mockRestore();
  });
});

type StoredEmail = {
  id: string;
  status: string;
  transport: string;
  request_sha256: string;
};
