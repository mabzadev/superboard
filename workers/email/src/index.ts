import {
  EMAIL_SERVICE_DEAD_LETTERS_PATH,
  EMAIL_SERVICE_OPERATIONS_PATH,
  EMAIL_SERVICE_SEND_PATH,
  EMAIL_SERVICE_SMTP_TRANSPORT_PATH,
} from "@superboard/contracts/email";
import type {
  EmailDeadLetterOperation,
  EmailOperation,
  EmailOperationsPage,
  EmailServiceReceipt,
  EmailSmtpTransportReceipt,
  EmailSmtpTransportRequest,
  EmailTransportOperation,
} from "@superboard/contracts/email";
import {
  RequestBodyError,
  readJsonLimited,
} from "@superboard/contracts/request-body";
import {
  DEAD_LETTER_MAX_RECORDS,
  deadLetterPayload,
} from "@superboard/contracts/dead-letter";
import {
  configuredSecrets,
  matchesAnySecret,
} from "@superboard/contracts/secret";
import { inspectSqlSchemaHealth } from "@superboard/contracts/health";
import {
  EmailTransportError,
  sendSmtpMessage,
} from "@superboard/email-transport";
import {
  EmailValidationError,
  parseEmailMessage,
  parseEmailSmtpTransportRequest,
  secretsEqual,
} from "./validation";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return health(env);
    if (request.method === "GET" && url.pathname === "/") return previewShell();
    if (
      request.method === "POST" &&
      url.pathname === EMAIL_SERVICE_SMTP_TRANSPORT_PATH
    ) {
      return deliverDelegatedSmtp(request, env);
    }
    if (url.pathname.startsWith(EMAIL_SERVICE_OPERATIONS_PATH)) {
      if (!(await internalAuthorized(request, env)))
        return json({ error: "unauthorized" }, 401);
      if (
        request.method === "GET" &&
        url.pathname === EMAIL_SERVICE_OPERATIONS_PATH
      )
        return listEmailOperations(env, url);
      const decision = new RegExp(
        `^${EMAIL_SERVICE_DEAD_LETTERS_PATH}/([a-f0-9-]{36})/(replay|discard)$`,
      ).exec(url.pathname);
      if (request.method === "POST" && decision) {
        return decision[2] === "replay"
          ? replayEmailDeadLetter(env, decision[1])
          : discardEmailDeadLetter(env, decision[1]);
      }
      return json({ error: "not_found" }, 404);
    }
    if (url.pathname.startsWith("/api/")) {
      if (!(await previewAuthorized(request, env)))
        return json({ error: "unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/api/messages")
        return listMessages(env, url);
      const id = /^\/api\/messages\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
      if (request.method === "GET" && id) return readMessage(env, id);
      if (request.method === "DELETE" && url.pathname === "/api/messages")
        return clearCaptured(env);
      return json({ error: "not_found" }, 404);
    }
    if (request.method === "POST" && url.pathname === EMAIL_SERVICE_SEND_PATH) {
      return enqueueMessage(request, env);
    }
    return json({ error: "not_found" }, 404);
  },

  async queue(batch: MessageBatch<EmailQueueJob>, env: Env): Promise<void> {
    if (batch.queue === env.EMAIL_DLQ_NAME) {
      for (const message of batch.messages) {
        try {
          const result = await quarantineEmailDeadLetter(
            env.DB,
            batch.queue,
            message,
          );
          console.error(
            JSON.stringify({
              event: "email_job_quarantined",
              message_id: message.id,
              job_type: result.jobType,
              replayable: result.replayable,
              duplicate: result.duplicate,
            }),
          );
          message.ack();
        } catch (error) {
          console.error(
            JSON.stringify({
              event: "email_dead_letter_persistence_failed",
              message_id: message.id,
              error: error instanceof Error ? error.message : String(error),
            }),
          );
          message.retry({ delaySeconds: 60 });
        }
      }
      return;
    }
    for (const message of batch.messages) {
      try {
        if (
          message.body?.type !== "email.deliver" ||
          typeof message.body.messageId !== "string"
        ) {
          message.ack();
          continue;
        }
        await deliverMessage(env, message.body.messageId);
        message.ack();
      } catch (error) {
        console.error("email_delivery_failed", {
          queueMessageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry({
          delaySeconds: Math.min(900, 2 ** Math.min(message.attempts, 9)),
        });
      }
    }
  },
} satisfies ExportedHandler<Env, EmailQueueJob>;

async function enqueueMessage(request: Request, env: Env): Promise<Response> {
  if (!(await internalAuthorized(request, env)))
    return json({ error: "unauthorized" }, 401);
  try {
    const input = parseEmailMessage(await readJsonLimited(request, 600_000));
    const id = crypto.randomUUID();
    const status = env.MAIL_TRANSPORT === "capture" ? "captured" : "queued";
    const now = new Date().toISOString();
    const requestSha256 = await emailRequestSha256(input);
    const messageInsert = input.idempotencyKey
      ? env.DB.prepare(
          `
        INSERT OR IGNORE INTO email_messages
          (id, environment, transport, kind, project_id, template_key, idempotency_key, request_sha256,
           from_name, from_address, reply_to, subject, text_body, html_body, headers_json, metadata_json,
           status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).bind(
          id,
          env.ENVIRONMENT,
          env.MAIL_TRANSPORT,
          input.kind,
          input.projectId,
          input.templateKey,
          input.idempotencyKey,
          requestSha256,
          env.MAIL_FROM_NAME,
          env.MAIL_FROM_ADDRESS,
          input.replyTo || env.MAIL_REPLY_TO || null,
          input.subject,
          input.text,
          input.html,
          JSON.stringify(input.headers),
          JSON.stringify(input.metadata),
          status,
          now,
          now,
        )
      : env.DB.prepare(
          `
        INSERT INTO email_messages
          (id, environment, transport, kind, project_id, template_key, idempotency_key, request_sha256,
           from_name, from_address,
           reply_to, subject, text_body, html_body, headers_json, metadata_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        ).bind(
          id,
          env.ENVIRONMENT,
          env.MAIL_TRANSPORT,
          input.kind,
          input.projectId,
          input.templateKey,
          null,
          requestSha256,
          env.MAIL_FROM_NAME,
          env.MAIL_FROM_ADDRESS,
          input.replyTo || env.MAIL_REPLY_TO || null,
          input.subject,
          input.text,
          input.html,
          JSON.stringify(input.headers),
          JSON.stringify(input.metadata),
          status,
          now,
          now,
        );
    await env.DB.batch([
      messageInsert,
      ...input.to.map((recipient) =>
        env.DB.prepare(
          `
        INSERT INTO email_deliveries (id, message_id, recipient, status, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM email_messages WHERE id = ?)
      `,
        ).bind(crypto.randomUUID(), id, recipient, status, now, now, id),
      ),
    ]);
    const stored = input.idempotencyKey
      ? await env.DB.prepare(
          `
          SELECT id, status, transport, request_sha256 FROM email_messages
          WHERE environment = ? AND idempotency_key = ?
        `,
        )
          .bind(env.ENVIRONMENT, input.idempotencyKey)
          .first<StoredReceipt>()
      : {
          id,
          status,
          transport: env.MAIL_TRANSPORT,
          request_sha256: requestSha256,
        };
    if (!stored)
      throw new Error("Idempotent email insert could not be resolved");
    if (stored.request_sha256 !== requestSha256) {
      return json({ error: "idempotency_conflict" }, 409);
    }
    const replayed = stored.id !== id;
    if (stored.status !== "captured" && stored.status !== "sent") {
      if (stored.status === "failed") {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE email_messages SET status = 'queued', last_error = NULL, updated_at = ? WHERE id = ? AND status = 'failed'`,
          ).bind(now, stored.id),
          env.DB.prepare(
            `UPDATE email_deliveries SET status = 'queued', last_error = NULL, updated_at = ? WHERE message_id = ? AND status = 'failed'`,
          ).bind(now, stored.id),
        ]);
      }
      // Re-sending the tiny queue command is safe: delivery acquisition below is
      // conditional, so concurrent or at-least-once Queue messages cannot both send.
      await env.EMAIL_QUEUE.send({
        type: "email.deliver",
        messageId: stored.id,
      });
    }
    const receipt: EmailServiceReceipt = {
      id: stored.id,
      status: receiptStatus(stored.status),
      transport: stored.transport,
      ...(replayed ? { replayed: true } : {}),
    };
    return json(receipt, 202);
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json({ error: error.code }, error.status);
    if (error instanceof EmailValidationError)
      return json({ error: error.code }, 422);
    console.error("email_enqueue_failed", error);
    return json({ error: "email_enqueue_failed" }, 500);
  }
}

async function deliverDelegatedSmtp(
  request: Request,
  env: Env,
): Promise<Response> {
  if (!(await internalAuthorized(request, env)))
    return json({ error: "unauthorized" }, 401);
  let input: EmailSmtpTransportRequest;
  try {
    input = parseEmailSmtpTransportRequest(
      await readJsonLimited(request, 600_000),
      env.ENVIRONMENT,
    );
  } catch (error) {
    if (error instanceof RequestBodyError)
      return json({ error: error.code }, error.status);
    if (error instanceof EmailValidationError)
      return json({ error: error.code }, 422);
    throw error;
  }
  const requestSha256 = await sha256(stableJson(input));
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const leaseExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const inserted = await env.DB.prepare(
    `
    INSERT OR IGNORE INTO email_transport_deliveries
      (id, idempotency_key, request_sha256, source, project_id, reference_id, profile_id,
       status, attempt_count, lease_expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'sending', 1, ?, ?, ?)
    RETURNING id
  `,
  )
    .bind(
      id,
      input.idempotencyKey,
      requestSha256,
      input.source,
      input.projectId,
      input.referenceId,
      input.profileId,
      leaseExpiresAt,
      now,
      now,
    )
    .first<{ id: string }>();
  let deliveryId = inserted?.id || id;
  if (!inserted) {
    const existing = await env.DB.prepare(
      `
      SELECT id, request_sha256, status, provider_message_id, provider_response,
             lease_expires_at
      FROM email_transport_deliveries WHERE idempotency_key = ?
    `,
    )
      .bind(input.idempotencyKey)
      .first<EmailTransportDeliveryRow>();
    if (!existing) return json({ error: "email_transport_claim_failed" }, 503);
    if (existing.request_sha256 !== requestSha256)
      return json({ error: "idempotency_conflict" }, 409);
    if (
      existing.status === "sent" &&
      existing.provider_message_id &&
      existing.provider_response != null
    ) {
      return json(transportReceipt(existing, true), 200);
    }
    if (existing.status === "outcome_unknown") {
      return json({ error: "email_transport_outcome_unknown" }, 409);
    }
    if (existing.status === "sending") {
      if (existing.lease_expires_at && existing.lease_expires_at <= now) {
        await env.DB.prepare(
          `
          UPDATE email_transport_deliveries
          SET status = 'outcome_unknown', last_error = 'Transport lease expired without a durable provider outcome',
              lease_expires_at = NULL, updated_at = ?
          WHERE id = ? AND status = 'sending' AND lease_expires_at <= ?
        `,
        )
          .bind(now, existing.id, now)
          .run();
        return json({ error: "email_transport_outcome_unknown" }, 409);
      }
      return json({ error: "email_transport_in_progress" }, 409);
    }
    const acquired = await env.DB.prepare(
      `
      UPDATE email_transport_deliveries
      SET status = 'sending', attempt_count = attempt_count + 1, last_error = NULL,
          lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND request_sha256 = ? AND status = 'failed'
      RETURNING id
    `,
    )
      .bind(leaseExpiresAt, now, existing.id, requestSha256)
      .first<{ id: string }>();
    if (!acquired) return json({ error: "email_transport_in_progress" }, 409);
    deliveryId = acquired.id;
  }
  let result: { messageId: string; response: string };
  try {
    result = await sendSmtpMessage(input.publicConfig, input.secret, {
      ...input.message,
      messageId: await deterministicMessageId(
        input.idempotencyKey,
        input.publicConfig.from_email,
      ),
    });
  } catch (error) {
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 4_000);
    const outcomeUnknown =
      error instanceof EmailTransportError &&
      error.code === "smtp_outcome_unknown";
    await env.DB.prepare(
      `
      UPDATE email_transport_deliveries
      SET status = ?, last_error = ?, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'sending'
    `,
    )
      .bind(
        outcomeUnknown ? "outcome_unknown" : "failed",
        reason,
        new Date().toISOString(),
        deliveryId,
      )
      .run();
    console.error(
      JSON.stringify({
        event: outcomeUnknown
          ? "email_transport_outcome_unknown"
          : "email_transport_failed",
        source: input.source,
        project_id: input.projectId,
        reference_id: input.referenceId,
        profile_id: input.profileId,
        error: error instanceof EmailTransportError ? error.code : reason,
      }),
    );
    return error instanceof EmailTransportError
      ? json(
          {
            error: error.code,
            ...(error.details ? { details: error.details } : {}),
          },
          error.status,
        )
      : json({ error: "email_transport_failed" }, 503);
  }

  const sentAt = new Date().toISOString();
  const providerResponse = result.response.slice(0, 4_000);
  try {
    const persisted = await env.DB.prepare(
      `
      UPDATE email_transport_deliveries
      SET status = 'sent', provider_message_id = ?, provider_response = ?, last_error = NULL,
          lease_expires_at = NULL, sent_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending'
    `,
    )
      .bind(result.messageId, providerResponse, sentAt, sentAt, deliveryId)
      .run();
    if (Number(persisted.meta.changes || 0) !== 1) {
      throw new Error("Accepted SMTP receipt was not persisted");
    }
  } catch (error) {
    const reason = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 4_000);
    await env.DB.prepare(
      `
      UPDATE email_transport_deliveries
      SET status = 'outcome_unknown', provider_message_id = ?, provider_response = ?,
          last_error = ?, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'sending'
    `,
    )
      .bind(
        result.messageId,
        providerResponse,
        reason,
        new Date().toISOString(),
        deliveryId,
      )
      .run()
      .catch(() => undefined);
    console.error(
      JSON.stringify({
        event: "email_transport_persistence_outcome_unknown",
        source: input.source,
        project_id: input.projectId,
        reference_id: input.referenceId,
        profile_id: input.profileId,
        provider_message_id: result.messageId,
        error: reason,
      }),
    );
    return json({ error: "email_transport_outcome_unknown" }, 503);
  }
  const receipt: EmailSmtpTransportReceipt = {
    id: deliveryId,
    status: "sent",
    messageId: result.messageId,
    response: providerResponse,
  };
  return json(receipt, 201);
}

function transportReceipt(
  row: EmailTransportDeliveryRow,
  replayed: boolean,
): EmailSmtpTransportReceipt {
  return {
    id: row.id,
    status: "sent",
    messageId: String(row.provider_message_id),
    response: String(row.provider_response),
    ...(replayed ? { replayed: true } : {}),
  };
}

async function deliverMessage(env: Env, messageId: string): Promise<void> {
  if (env.MAIL_TRANSPORT !== "smtp")
    throw new Error("SMTP delivery received by a non-SMTP target");
  const message = await env.DB.prepare(
    `SELECT * FROM email_messages WHERE id = ?`,
  )
    .bind(messageId)
    .first<EmailRow>();
  if (!message) return;
  const deliveries = (
    await env.DB.prepare(
      `
    SELECT id, recipient, status, attempt_count FROM email_deliveries
    WHERE message_id = ? AND status NOT IN ('sent', 'captured') ORDER BY created_at
  `,
    )
      .bind(messageId)
      .all<DeliveryRow>()
  ).results;
  if (deliveries.length === 0) {
    await markMessageSent(env.DB, messageId);
    return;
  }
  const smtp = smtpConfiguration(env, message);
  await env.DB.prepare(
    `UPDATE email_messages SET status = 'sending', updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), messageId)
    .run();
  for (const delivery of deliveries) {
    const now = new Date().toISOString();
    const acquired = await env.DB.prepare(
      `
      UPDATE email_deliveries
      SET status = 'sending', attempt_count = attempt_count + 1, updated_at = ?
      WHERE id = ? AND status IN ('queued', 'failed')
      RETURNING attempt_count
    `,
    )
      .bind(now, delivery.id)
      .first<{ attempt_count: number }>();
    if (!acquired) continue;
    let result: { messageId: string; response: string };
    try {
      result = await sendSmtpMessage(smtp.public, smtp.secret, {
        to: delivery.recipient,
        subject: message.subject,
        text: message.text_body,
        html: message.html_body,
        headers: safeJson(message.headers_json),
        messageId: await deterministicMessageId(
          `email.delivery:${message.id}:${delivery.id}`,
          message.from_address,
        ),
      });
    } catch (error) {
      const reason = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 4_000);
      const outcomeUnknown =
        error instanceof EmailTransportError &&
        error.code === "smtp_outcome_unknown";
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE email_deliveries SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          outcomeUnknown ? "sending" : "failed",
          outcomeUnknown ? `outcome_unknown: ${reason}` : reason,
          now,
          delivery.id,
        ),
        env.DB.prepare(
          `UPDATE email_messages SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
        ).bind(
          outcomeUnknown ? "sending" : "failed",
          outcomeUnknown ? `outcome_unknown: ${reason}` : reason,
          now,
          messageId,
        ),
      ]);
      throw error;
    }
    try {
      const persisted = await env.DB.prepare(
        `
        UPDATE email_deliveries
        SET status = 'sent', provider_message_id = ?, provider_response = ?, last_error = NULL,
            sent_at = ?, updated_at = ? WHERE id = ? AND status = 'sending'
      `,
      )
        .bind(result.messageId, result.response, now, now, delivery.id)
        .run();
      if (Number(persisted.meta.changes || 0) !== 1) {
        throw new Error("Accepted SMTP delivery receipt was not persisted");
      }
    } catch (error) {
      const reason = `outcome_unknown: ${(error instanceof Error
        ? error.message
        : String(error)
      ).slice(0, 3_900)}`;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE email_deliveries SET provider_message_id = ?, provider_response = ?, last_error = ?, updated_at = ? WHERE id = ? AND status = 'sending'`,
        ).bind(
          result.messageId,
          result.response.slice(0, 4_000),
          reason,
          now,
          delivery.id,
        ),
        env.DB.prepare(
          `UPDATE email_messages SET status = 'sending', last_error = ?, updated_at = ? WHERE id = ?`,
        ).bind(reason, now, messageId),
      ]).catch(() => []);
      throw new Error("SMTP delivery outcome requires manual reconciliation");
    }
  }
  await markMessageSent(env.DB, messageId);
}

function smtpConfiguration(env: Env, message: EmailRow) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT);
  const security = env.SMTP_SECURITY || "starttls";
  if (
    !host ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port === 25
  ) {
    throw new Error("SMTP_HOST and a supported SMTP_PORT are required");
  }
  if (!new Set(["tls", "starttls", "plain"]).has(security))
    throw new Error("SMTP_SECURITY is invalid");
  if (env.ENVIRONMENT === "production" && security === "plain")
    throw new Error("Plain SMTP is forbidden in production");
  return {
    public: {
      host,
      port,
      security,
      username: env.SMTP_USERNAME || null,
      from_email: message.from_address,
      from_name: message.from_name,
      reply_to: message.reply_to,
    },
    secret: { password: env.SMTP_PASSWORD || null },
  };
}

async function markMessageSent(db: D1Database, id: string) {
  const now = new Date().toISOString();
  await db
    .prepare(
      `
    UPDATE email_messages SET status = 'sent', last_error = NULL, sent_at = ?, updated_at = ?
    WHERE id = ? AND NOT EXISTS (
      SELECT 1 FROM email_deliveries WHERE message_id = ? AND status NOT IN ('sent', 'captured')
    )
  `,
    )
    .bind(now, now, id, id)
    .run();
}

async function emailRequestSha256(
  input: ReturnType<typeof parseEmailMessage>,
): Promise<string> {
  const canonical = stableJson({
    ...input,
    idempotencyKey: undefined,
    to: [...input.to].sort(),
    headers: Object.fromEntries(
      Object.entries(input.headers || {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function deterministicMessageId(
  idempotencyKey: string,
  fromAddress: string,
): Promise<string> {
  const digest = await sha256(`opengrow-email-transport:${idempotencyKey}`);
  const domain =
    fromAddress
      .split("@")[1]
      ?.toLowerCase()
      .replace(/[^a-z0-9.-]/g, "")
      .slice(0, 253) || "opengrow.local";
  return `<opengrow-${digest.slice(0, 48)}@${domain}>`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function receiptStatus(status: string): EmailServiceReceipt["status"] {
  if (status === "captured" || status === "sent") return status;
  return "queued";
}

async function health(env: Env): Promise<Response> {
  let configuration: ReturnType<typeof emailConfigurationHealth>;
  try {
    configuration = emailConfigurationHealth(env);
  } catch {
    return json(
      {
        service: "email",
        status: "misconfigured",
        environment: env.ENVIRONMENT,
        transport: env.MAIL_TRANSPORT,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
  try {
    const [metrics, schema] = await Promise.all([
      emailHealth(env.DB),
      inspectSqlSchemaHealth(env.DB, env.D1_EXPECTED_MIGRATION),
    ]);
    const current = schema.status === "current";
    return json(
      {
        service: "email",
        status: current ? "ok" : "degraded",
        environment: env.ENVIRONMENT,
        transport: env.MAIL_TRANSPORT,
        configuration,
        schema,
        ...(current ? {} : { reason: "database_schema_not_current" }),
        metrics,
        timestamp: new Date().toISOString(),
      },
      current ? 200 : 503,
    );
  } catch {
    return json(
      {
        service: "email",
        status: "degraded",
        environment: env.ENVIRONMENT,
        transport: env.MAIL_TRANSPORT,
        timestamp: new Date().toISOString(),
      },
      503,
    );
  }
}

export async function emailHealth(db: D1Database) {
  const row = await db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM email_messages) AS messages_total,
      (SELECT COUNT(*) FROM email_messages WHERE kind = 'transactional') AS messages_transactional,
      (SELECT COUNT(*) FROM email_messages WHERE kind = 'marketing') AS messages_marketing,
      (SELECT COUNT(*) FROM email_messages WHERE kind = 'test') AS messages_test,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'captured') AS messages_captured,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'queued') AS messages_queued,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'sending') AS messages_sending,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'sent') AS messages_sent,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'failed') AS messages_failed,
      (SELECT COUNT(*) FROM email_messages WHERE status = 'sending' AND last_error LIKE 'outcome_unknown:%') AS messages_outcome_unknown,
      (SELECT COUNT(*) FROM email_deliveries) AS deliveries_total,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'queued') AS deliveries_queued,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'sending') AS deliveries_sending,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'sent') AS deliveries_sent,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'failed') AS deliveries_failed,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'sending' AND last_error LIKE 'outcome_unknown:%') AS deliveries_outcome_unknown,
      (SELECT COALESCE(SUM(attempt_count), 0) FROM email_deliveries) AS delivery_attempts,
      (SELECT COUNT(*) FROM email_dead_letters WHERE status = 'quarantined') AS dead_letters_quarantined,
      (SELECT COUNT(*) FROM email_dead_letters WHERE resolution = 'replayed') AS dead_letters_replayed,
      (SELECT COUNT(*) FROM email_dead_letters WHERE resolution = 'discarded') AS dead_letters_discarded,
      (SELECT COUNT(*) FROM email_transport_deliveries) AS transport_total,
      (SELECT COUNT(*) FROM email_transport_deliveries WHERE status = 'sending') AS transport_sending,
      (SELECT COUNT(*) FROM email_transport_deliveries WHERE status = 'sent') AS transport_sent,
      (SELECT COUNT(*) FROM email_transport_deliveries WHERE status = 'failed') AS transport_failed,
      (SELECT COUNT(*) FROM email_transport_deliveries WHERE status = 'outcome_unknown') AS transport_outcome_unknown,
      (SELECT COALESCE(SUM(attempt_count), 0) FROM email_transport_deliveries) AS transport_attempts
  `,
    )
    .first<Record<string, number | null>>();
  if (!row) throw new Error("Email health query returned no row");
  const value = (key: string) => Number(row[key] || 0);
  return {
    messages: {
      total: value("messages_total"),
      transactional: value("messages_transactional"),
      marketing: value("messages_marketing"),
      test: value("messages_test"),
      captured: value("messages_captured"),
      queued: value("messages_queued"),
      sending: value("messages_sending"),
      sent: value("messages_sent"),
      failed: value("messages_failed"),
      outcomeUnknown: value("messages_outcome_unknown"),
    },
    deliveries: {
      total: value("deliveries_total"),
      queued: value("deliveries_queued"),
      sending: value("deliveries_sending"),
      sent: value("deliveries_sent"),
      failed: value("deliveries_failed"),
      outcomeUnknown: value("deliveries_outcome_unknown"),
      attempts: value("delivery_attempts"),
    },
    deadLetters: {
      quarantined: value("dead_letters_quarantined"),
      replayed: value("dead_letters_replayed"),
      discarded: value("dead_letters_discarded"),
    },
    delegatedTransport: {
      total: value("transport_total"),
      sending: value("transport_sending"),
      sent: value("transport_sent"),
      failed: value("transport_failed"),
      outcomeUnknown: value("transport_outcome_unknown"),
      attempts: value("transport_attempts"),
    },
  };
}

export async function quarantineEmailDeadLetter(
  db: D1Database,
  sourceQueue: string,
  message: { id: string; body: unknown; attempts: number },
) {
  const payload = await deadLetterPayload(message.body);
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `
    INSERT OR IGNORE INTO email_dead_letters
      (id,source_queue,message_id,job_type,payload_json,payload_sha256,payload_bytes,replayable,attempts)
    VALUES (?,?,?,?,?,?,?,?,?)
  `,
    )
    .bind(
      id,
      sourceQueue,
      message.id,
      payload.jobType,
      payload.payloadJson,
      payload.payloadSha256,
      payload.payloadBytes,
      payload.replayable ? 1 : 0,
      message.attempts,
    )
    .run();
  const messageId =
    message.body && typeof message.body === "object"
      ? (message.body as { messageId?: unknown }).messageId
      : null;
  if (typeof messageId === "string") {
    await db
      .prepare(
        `
      UPDATE email_messages SET status='failed',last_error='Delivery moved to dead-letter quarantine',updated_at=? WHERE id=?
    `,
      )
      .bind(new Date().toISOString(), messageId)
      .run();
  }
  await db
    .prepare(
      `
    DELETE FROM email_dead_letters WHERE id IN (
      SELECT id FROM email_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `,
    )
    .bind(DEAD_LETTER_MAX_RECORDS)
    .run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}

function emailConfigurationHealth(env: Env) {
  if (!new Set(["capture", "smtp"]).has(env.MAIL_TRANSPORT)) {
    throw new Error("MAIL_TRANSPORT is invalid");
  }
  if (!env.MAIL_FROM_NAME?.trim() || !env.MAIL_FROM_ADDRESS?.trim()) {
    throw new Error("Mail sender is not configured");
  }
  if (!env.EMAIL_INTERNAL_TOKEN?.trim()) {
    throw new Error("EMAIL_INTERNAL_TOKEN is not configured");
  }
  const previewProtected = Boolean(env.MAIL_PREVIEW_TOKEN?.trim());
  if (env.MAIL_TRANSPORT === "capture" && !previewProtected) {
    throw new Error("MAIL_PREVIEW_TOKEN is not configured");
  }
  const queueConfigured = typeof env.EMAIL_QUEUE?.send === "function";
  if (env.MAIL_TRANSPORT === "smtp" && !queueConfigured) {
    throw new Error("EMAIL_QUEUE is not configured");
  }
  const smtpConfigured =
    env.MAIL_TRANSPORT !== "smtp" ||
    Boolean(
      env.SMTP_HOST?.trim() &&
      Number.isSafeInteger(Number(env.SMTP_PORT)) &&
      Number(env.SMTP_PORT) > 0 &&
      Number(env.SMTP_PORT) <= 65535 &&
      Number(env.SMTP_PORT) !== 25 &&
      new Set(["tls", "starttls", "plain"]).has(
        env.SMTP_SECURITY || "starttls",
      ) &&
      !(env.ENVIRONMENT === "production" && env.SMTP_SECURITY === "plain"),
    );
  if (!smtpConfigured) throw new Error("SMTP transport is not configured");
  return {
    senderConfigured: true,
    internalAuthenticationConfigured: true,
    previewProtected:
      env.MAIL_TRANSPORT === "capture" ? previewProtected : null,
    queueConfigured: env.MAIL_TRANSPORT === "smtp" ? queueConfigured : null,
    smtpConfigured: env.MAIL_TRANSPORT === "smtp" ? smtpConfigured : null,
  };
}

async function listMessages(env: Env, url: URL): Promise<Response> {
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") || 50)),
  );
  const rows = (
    await env.DB.prepare(
      `
    SELECT message.id, message.kind, message.subject, message.status, message.transport,
           message.created_at, message.sent_at, COUNT(delivery.id) recipient_count
    FROM email_messages message
    LEFT JOIN email_deliveries delivery ON delivery.message_id = message.id
    GROUP BY message.id ORDER BY message.created_at DESC LIMIT ?
  `,
    )
      .bind(limit)
      .all()
  ).results;
  return json({ messages: rows });
}

async function listEmailOperations(env: Env, url: URL): Promise<Response> {
  const limit = boundedLimit(url.searchParams.get("limit"));
  const status = enumQuery(url, "status", [
    "captured",
    "queued",
    "sending",
    "sent",
    "failed",
  ]);
  const kind = enumQuery(url, "kind", ["transactional", "marketing", "test"]);
  const [messageRows, transportRows, deadLetterRows, queue] = await Promise.all(
    [
      env.DB.prepare(
        `
      SELECT message.id, message.kind, message.project_id, message.template_key,
             message.subject,
             CASE WHEN message.status = 'sending' AND message.last_error LIKE 'outcome_unknown:%'
               THEN 'outcome_unknown' ELSE message.status END AS status,
             message.transport, message.last_error,
             message.created_at, message.updated_at, message.sent_at,
             COUNT(delivery.id) AS recipient_count,
             COALESCE(SUM(CASE WHEN delivery.status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_recipients,
             COALESCE(SUM(delivery.attempt_count), 0) AS attempts
      FROM email_messages message
      LEFT JOIN email_deliveries delivery ON delivery.message_id = message.id
      WHERE (? IS NULL OR message.status = ?) AND (? IS NULL OR message.kind = ?)
      GROUP BY message.id
      ORDER BY message.created_at DESC, message.id DESC
      LIMIT ?
    `,
      )
        .bind(status, status, kind, kind, limit)
        .all<EmailOperationRow>(),
      env.DB.prepare(
        `
      SELECT id, source, project_id, reference_id, profile_id, status,
             attempt_count, provider_message_id, last_error, created_at,
             updated_at, sent_at
      FROM email_transport_deliveries
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
      )
        .bind(limit)
        .all<EmailTransportOperationRow>(),
      env.DB.prepare(
        `
      SELECT id, source_queue, message_id, job_type, payload_json, replayable,
             attempts, status, resolution, received_at, resolved_at
      FROM email_dead_letters
      ORDER BY received_at DESC, id DESC
      LIMIT ?
    `,
      )
        .bind(limit)
        .all<EmailDeadLetterRow>(),
      emailQueueMetrics(env.EMAIL_QUEUE),
    ],
  );
  const response: EmailOperationsPage = {
    generatedAt: new Date().toISOString(),
    queue,
    messages: messageRows.results.map(serializeEmailOperation),
    transportDeliveries: transportRows.results.map(serializeEmailTransport),
    deadLetters: deadLetterRows.results.map(serializeEmailDeadLetter),
  };
  return json(response);
}

async function emailQueueMetrics(
  queue: Queue<EmailQueueJob>,
): Promise<EmailOperationsPage["queue"]> {
  try {
    const metrics = await queue.metrics();
    return {
      backlogCount: Number(metrics.backlogCount || 0),
      backlogBytes: Number(metrics.backlogBytes || 0),
      oldestMessageAt: metrics.oldestMessageTimestamp?.toISOString() ?? null,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "email_queue_metrics_unavailable",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

async function replayEmailDeadLetter(env: Env, id: string): Promise<Response> {
  if (env.MAIL_TRANSPORT !== "smtp") {
    return json({ error: "smtp_transport_required" }, 409);
  }
  const row = await env.DB.prepare(
    `
    SELECT id, payload_json, replayable, status
    FROM email_dead_letters WHERE id = ?
  `,
  )
    .bind(id)
    .first<ReplayableDeadLetterRow>();
  if (!row) return json({ error: "dead_letter_not_found" }, 404);
  if (row.status !== "quarantined")
    return json({ error: "dead_letter_already_resolved" }, 409);
  if (Number(row.replayable) !== 1)
    return json({ error: "dead_letter_not_replayable" }, 409);
  const job = parseEmailQueueJob(row.payload_json);
  if (!job) return json({ error: "dead_letter_payload_invalid" }, 409);
  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `
    UPDATE email_dead_letters
    SET status = 'discarded', resolution = 'replayed', resolved_at = ?
    WHERE id = ? AND status = 'quarantined'
    RETURNING id
  `,
  )
    .bind(now, id)
    .first<{ id: string }>();
  if (!claimed) return json({ error: "dead_letter_already_resolved" }, 409);
  try {
    await env.EMAIL_QUEUE.send(job);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      await env.DB.prepare(
        `UPDATE email_dead_letters SET status = 'quarantined', resolution = NULL, resolved_at = NULL WHERE id = ? AND resolution = 'replayed'`,
      )
        .bind(id)
        .run();
    } catch (rollbackError) {
      console.error(
        JSON.stringify({
          event: "email_dead_letter_replay_rollback_failed",
          dead_letter_id: id,
          email_message_id: job.messageId,
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        }),
      );
    }
    console.error(
      JSON.stringify({
        event: "email_dead_letter_replay_failed",
        dead_letter_id: id,
        email_message_id: job.messageId,
        error: reason,
      }),
    );
    return json({ error: "dead_letter_replay_failed" }, 503);
  }
  console.log(
    JSON.stringify({
      event: "email_dead_letter_replayed",
      dead_letter_id: id,
      email_message_id: job.messageId,
    }),
  );
  return json({ id, status: "replayed", messageId: job.messageId }, 202);
}

async function discardEmailDeadLetter(env: Env, id: string): Promise<Response> {
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `
    UPDATE email_dead_letters
    SET status = 'discarded', resolution = 'discarded', resolved_at = ?
    WHERE id = ? AND status = 'quarantined'
    RETURNING id
  `,
  )
    .bind(now, id)
    .first<{ id: string }>();
  if (!row) {
    const existing = await env.DB.prepare(
      `SELECT status FROM email_dead_letters WHERE id = ?`,
    )
      .bind(id)
      .first<{ status: string }>();
    return existing
      ? json({ error: "dead_letter_already_resolved" }, 409)
      : json({ error: "dead_letter_not_found" }, 404);
  }
  console.log(
    JSON.stringify({
      event: "email_dead_letter_discarded",
      dead_letter_id: id,
    }),
  );
  return json({ id, status: "discarded" });
}

function boundedLimit(raw: string | null): number {
  const parsed = Number(raw || 50);
  return Number.isSafeInteger(parsed) && parsed > 0
    ? Math.min(100, parsed)
    : 50;
}

function enumQuery<T extends string>(
  url: URL,
  name: string,
  values: T[],
): T | null {
  const value = url.searchParams.get(name);
  return value && values.includes(value as T) ? (value as T) : null;
}

function parseEmailQueueJob(payloadJson: string): EmailQueueJob | null {
  try {
    const value: unknown = JSON.parse(payloadJson);
    return value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).type === "email.deliver" &&
      typeof (value as Record<string, unknown>).messageId === "string" &&
      (value as Record<string, unknown>).messageId
      ? {
          type: "email.deliver",
          messageId: String((value as Record<string, unknown>).messageId),
        }
      : null;
  } catch {
    return null;
  }
}

function serializeEmailOperation(row: EmailOperationRow): EmailOperation {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    templateKey: row.template_key,
    subject: row.subject,
    status: row.status,
    transport: row.transport,
    recipientCount: Number(row.recipient_count || 0),
    failedRecipients: Number(row.failed_recipients || 0),
    attempts: Number(row.attempts || 0),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

function serializeEmailDeadLetter(
  row: EmailDeadLetterRow,
): EmailDeadLetterOperation {
  return {
    id: row.id,
    queueMessageId: row.message_id,
    emailMessageId: parseEmailQueueJob(row.payload_json)?.messageId ?? null,
    sourceQueue: row.source_queue,
    jobType: row.job_type,
    replayable: Number(row.replayable) === 1,
    attempts: Number(row.attempts || 0),
    status: row.status,
    resolution: row.resolution,
    receivedAt: row.received_at,
    resolvedAt: row.resolved_at,
  };
}

function serializeEmailTransport(
  row: EmailTransportOperationRow,
): EmailTransportOperation {
  return {
    id: row.id,
    source: row.source,
    projectId: Number(row.project_id),
    referenceId: row.reference_id,
    profileId: row.profile_id,
    status: row.status,
    attempts: Number(row.attempt_count || 0),
    providerMessageId: row.provider_message_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
  };
}

async function readMessage(env: Env, id: string): Promise<Response> {
  const message = await env.DB.prepare(
    `SELECT * FROM email_messages WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!message) return json({ error: "not_found" }, 404);
  const deliveries = (
    await env.DB.prepare(
      `SELECT * FROM email_deliveries WHERE message_id = ? ORDER BY recipient`,
    )
      .bind(id)
      .all()
  ).results;
  return json({ message, deliveries });
}

async function clearCaptured(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `DELETE FROM email_messages WHERE transport = 'capture'`,
  ).run();
  return json({ deleted: result.meta.changes || 0 });
}

async function internalAuthorized(
  request: Request,
  env: Env,
): Promise<boolean> {
  const provided = request.headers.get("x-internal-token") || bearer(request);
  return matchesAnySecret(
    provided,
    configuredSecrets(
      env.EMAIL_INTERNAL_TOKEN,
      env.EMAIL_INTERNAL_TOKEN_PREVIOUS,
    ),
  );
}

async function previewAuthorized(request: Request, env: Env): Promise<boolean> {
  const provided = bearer(request);
  return Boolean(
    env.MAIL_PREVIEW_TOKEN &&
    provided &&
    (await secretsEqual(provided, env.MAIL_PREVIEW_TOKEN)),
  );
}

function bearer(request: Request): string {
  return (
    request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] || ""
  );
}

function safeJson(value: string): Record<string, string> {
  try {
    return JSON.parse(value) as Record<string, string>;
  } catch {
    return {};
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function previewShell(): Response {
  return new Response(PREVIEW_HTML, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

type EmailRow = {
  id: string;
  from_name: string;
  from_address: string;
  reply_to: string | null;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  headers_json: string;
};
type DeliveryRow = {
  id: string;
  recipient: string;
  status: string;
  attempt_count: number;
};
type StoredReceipt = {
  id: string;
  status: string;
  transport: EmailServiceReceipt["transport"];
  request_sha256: string;
};
type EmailOperationRow = {
  id: string;
  kind: EmailOperation["kind"];
  project_id: number | null;
  template_key: string | null;
  subject: string;
  status: EmailOperation["status"];
  transport: EmailOperation["transport"];
  recipient_count: number;
  failed_recipients: number;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};
type EmailDeadLetterRow = {
  id: string;
  source_queue: string;
  message_id: string;
  job_type: string | null;
  payload_json: string;
  replayable: number;
  attempts: number;
  status: EmailDeadLetterOperation["status"];
  resolution: EmailDeadLetterOperation["resolution"];
  received_at: string;
  resolved_at: string | null;
};

type EmailTransportDeliveryRow = {
  id: string;
  request_sha256: string;
  status: "sending" | "sent" | "failed" | "outcome_unknown";
  provider_message_id: string | null;
  provider_response: string | null;
  lease_expires_at: string | null;
};

type EmailTransportOperationRow = {
  id: string;
  source: string;
  project_id: number;
  reference_id: string;
  profile_id: string;
  status: EmailTransportOperation["status"];
  attempt_count: number;
  provider_message_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
};
type ReplayableDeadLetterRow = Pick<
  EmailDeadLetterRow,
  "id" | "payload_json" | "replayable" | "status"
>;

const PREVIEW_HTML = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SuperBoard Mail Preview</title><style>
body{font:14px system-ui;margin:0;background:#0b1020;color:#e5e7eb}main{max-width:1100px;margin:auto;padding:32px}
input,button{font:inherit;padding:10px;border-radius:8px;border:1px solid #334155;background:#111827;color:inherit}button{cursor:pointer}
.bar{display:flex;gap:8px;margin-bottom:24px}.grid{display:grid;grid-template-columns:360px 1fr;gap:16px}.panel{background:#111827;border:1px solid #243047;border-radius:12px;padding:16px}
.item{display:block;width:100%;text-align:left;margin:8px 0}.muted{color:#94a3b8}iframe{width:100%;min-height:480px;background:white;border:0;border-radius:8px}pre{white-space:pre-wrap}
</style><main><h1>SuperBoard Mail Preview</h1><p class="muted">Development mail capture</p>
<div class="bar"><input id="token" type="password" placeholder="Preview access token"><button id="connect">Connect</button><button id="clear">Clear captured mail</button></div>
<div class="grid"><section class="panel"><h2>Messages</h2><div id="messages"></div></section><section class="panel"><h2 id="subject">Preview</h2><div id="detail" class="muted">Select a message.</div></section></div>
<script>
const token=document.querySelector('#token'),messages=document.querySelector('#messages'),detail=document.querySelector('#detail'),subject=document.querySelector('#subject');
token.value=sessionStorage.getItem('mailPreviewToken')||'';const headers=()=>({authorization:'Bearer '+token.value});
async function load(){sessionStorage.setItem('mailPreviewToken',token.value);const r=await fetch('/api/messages',{headers:headers()});if(!r.ok){messages.textContent='Access denied or service unavailable.';return}const data=await r.json();messages.replaceChildren(...data.messages.map(m=>{const b=document.createElement('button');b.className='item';b.textContent=m.status+' · '+m.subject;b.onclick=()=>open(m.id);return b}))}
async function open(id){const r=await fetch('/api/messages/'+id,{headers:headers()});const data=await r.json();subject.textContent=data.message.subject;detail.replaceChildren();if(data.message.html_body){const f=document.createElement('iframe');f.sandbox='';f.srcdoc=data.message.html_body;detail.append(f)}else{const p=document.createElement('pre');p.textContent=data.message.text_body||'';detail.append(p)}}
document.querySelector('#connect').onclick=load;document.querySelector('#clear').onclick=async()=>{if(confirm('Delete all captured messages?')){await fetch('/api/messages',{method:'DELETE',headers:headers()});await load()}};
</script></main></html>`;
