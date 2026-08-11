import type {
  Env,
  MarketingQueueJob,
  SmtpPublicConfig,
  SmtpSecretConfig,
} from "./types";
import {
  DEAD_LETTER_MAX_RECORDS,
  deadLetterPayload,
} from "@superboard/contracts/dead-letter";
import { decryptJson } from "./secrets";
import { isEmailTransportInProgress, sendSmtpMessage } from "./email-service";
import { parseStoredJson } from "./validation";
import { instrumentHtml, unsubscribeUrl } from "./tracking";

type Delivery = {
  id: string;
  project_id: number;
  campaign_id: string;
  subscriber_id: string;
  recipient_email: string;
  recipient_name: string | null;
  status: string;
  attempt_count: number;
};

type Campaign = {
  id: string;
  project_id: number;
  subject: string;
  content_html: string | null;
  content_text: string | null;
  smtp_profile_id: string | null;
  tracking_enabled: number;
  status: string;
};

type SmtpProfile = {
  id: string;
  public_config_json: string;
  encrypted_config: string;
};

export async function handleMarketingQueue(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  if (batch.queue === env.DLQ_NAME) {
    for (const message of batch.messages) {
      try {
        const result = await quarantineMarketingDeadLetter(
          env.DB,
          batch.queue,
          message,
        );
        console.error(
          JSON.stringify({
            event: "marketing_job_quarantined",
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
            event: "marketing_dead_letter_persistence_failed",
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
    if (!isMarketingQueueJob(message.body)) {
      console.error(
        JSON.stringify({
          event: "marketing_queue_rejected",
          message_id: message.id,
        }),
      );
      message.ack();
      continue;
    }
    try {
      if (message.body.type === "marketing.campaign.dispatch")
        await dispatchCampaign(env, message.body);
      else if (message.body.type === "marketing.email.deliver")
        await deliverEmail(env, message.body, message.attempts);
      else await deliverOptin(env, message.body);
      message.ack();
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "marketing_queue_failed",
          message_id: message.id,
          type: message.body.type,
          attempt: message.attempts,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (
        message.body.type === "marketing.email.deliver" &&
        message.attempts >= 5
      ) {
        await markDeliveryFailed(
          env,
          message.body.projectId,
          message.body.deliveryId,
          error,
        );
      }
      if (message.body.type === "marketing.optin.deliver") {
        await env.DB.prepare(
          `
          UPDATE marketing_outbox SET status = ?, attempt_count = attempt_count + 1, last_error = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
        `,
        )
          .bind(
            message.attempts >= 5 ? "dead_letter" : "dispatched",
            error instanceof Error
              ? error.message.slice(0, 2000)
              : String(error).slice(0, 2000),
            message.body.outboxId,
            message.body.projectId,
          )
          .run();
      }
      message.retry({
        delaySeconds: Math.min(900, 15 * 2 ** Math.min(message.attempts, 6)),
      });
    }
  }
}

export async function quarantineMarketingDeadLetter(
  db: D1Database,
  sourceQueue: string,
  message: { id: string; body: unknown; attempts: number },
) {
  const payload = await deadLetterPayload(message.body);
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `
    INSERT OR IGNORE INTO marketing_dead_letters
      (id,project_id,source_queue,message_id,job_type,payload_json,payload_sha256,payload_bytes,replayable,attempts)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `,
    )
    .bind(
      id,
      isMarketingQueueJob(message.body) ? message.body.projectId : null,
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
  if (isMarketingQueueJob(message.body)) {
    if (message.body.type === "marketing.email.deliver") {
      await db
        .prepare(
          `
        UPDATE email_deliveries SET status = 'failed', last_error = 'Delivery moved to dead-letter quarantine',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND id = ?
      `,
        )
        .bind(message.body.projectId, message.body.deliveryId)
        .run();
    } else if (message.body.type === "marketing.optin.deliver") {
      await db
        .prepare(
          `
        UPDATE marketing_outbox SET status = 'dead_letter', last_error = 'Delivery moved to dead-letter quarantine',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND id = ?
      `,
        )
        .bind(message.body.projectId, message.body.outboxId)
        .run();
    }
  }
  await db
    .prepare(
      `
    DELETE FROM marketing_dead_letters WHERE id IN (
      SELECT id FROM marketing_dead_letters ORDER BY received_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  `,
    )
    .bind(DEAD_LETTER_MAX_RECORDS)
    .run();
  return { id, duplicate: result.meta.changes === 0, ...payload };
}

async function deliverOptin(
  env: Env,
  job: Extract<MarketingQueueJob, { type: "marketing.optin.deliver" }>,
) {
  const subscriber = await env.DB.prepare(
    `
    SELECT id, email, name FROM subscribers
    WHERE id = ? AND project_id = ? AND status = 'enabled' AND consent_status = 'pending'
      AND optin_token_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `,
  )
    .bind(job.subscriberId, job.projectId)
    .first<{ id: string; email: string; name: string | null }>();
  if (!subscriber) {
    await completeOutbox(env.DB, job.projectId, job.outboxId);
    return;
  }
  const profile = await env.DB.prepare(
    `
    SELECT id, public_config_json, encrypted_config FROM smtp_profiles
    WHERE project_id = ? AND enabled = 1 AND (? = 0 OR authentication_status = 'verified')
    ORDER BY priority, created_at LIMIT 1
  `,
  )
    .bind(job.projectId, env.ENVIRONMENT === "production" ? 1 : 0)
    .first<SmtpProfile>();
  if (!profile)
    throw new Error(
      "No production-ready SMTP profile is configured for double opt-in",
    );
  const publicConfig = parseStoredJson<SmtpPublicConfig>(
    profile.public_config_json,
    {} as SmtpPublicConfig,
  );
  const secret = await decryptJson<SmtpSecretConfig>(
    env.SMTP_ENCRYPTION_KEY,
    profile.encrypted_config,
  );
  const confirmationUrl = `${env.PUBLIC_API_URL}/api/v1/marketing/opt-in/${job.token}`;
  await sendSmtpMessage(env, {
    idempotencyKey: `marketing.optin:${job.projectId}:${job.outboxId}:${profile.id}`,
    projectId: job.projectId,
    referenceId: job.outboxId,
    profileId: profile.id,
    publicConfig,
    secret,
    message: {
      to: subscriber.email,
      subject: "Confirm your subscription",
      text: `Confirm your subscription: ${confirmationUrl}`,
      html: `<p>Confirm your subscription:</p><p><a href="${confirmationUrl}">Confirm subscription</a></p>`,
    },
  });
  await env.DB.batch([
    env.DB.prepare(
      `
      UPDATE marketing_outbox SET status = 'completed', last_error = NULL,
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ?
    `,
    ).bind(job.outboxId, job.projectId),
    env.DB.prepare(
      `
      INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
      VALUES (?, ?, 'subscriber.double_optin_sent', 'system', ?, ?)
    `,
    ).bind(
      crypto.randomUUID(),
      job.projectId,
      job.outboxId,
      JSON.stringify({
        subscriber_id: subscriber.id,
        smtp_profile_id: profile.id,
      }),
    ),
  ]);
}

async function completeOutbox(
  db: D1Database,
  projectId: number,
  outboxId: string,
) {
  await db
    .prepare(
      `
    UPDATE marketing_outbox SET status = 'completed', last_error = NULL,
      completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ?
  `,
    )
    .bind(outboxId, projectId)
    .run();
}

export async function dispatchCampaign(
  env: Env,
  job: Extract<MarketingQueueJob, { type: "marketing.campaign.dispatch" }>,
) {
  const campaign = await env.DB.prepare(
    `
    SELECT * FROM campaigns WHERE id = ? AND project_id = ?
  `,
  )
    .bind(job.campaignId, job.projectId)
    .first<Campaign & { list_ids_json: string; segment_ids_json: string }>();
  if (!campaign) return { dispatched: false, reason: "not_found" as const };
  if (!["scheduled", "running"].includes(campaign.status))
    return { dispatched: false, reason: `status:${String(campaign.status)}` };
  const listIds = parseStoredJson<string[]>(campaign.list_ids_json, []);
  const segmentIds = parseStoredJson<string[]>(campaign.segment_ids_json, []);
  const targetClauses: string[] = [];
  const bindings: unknown[] = [job.projectId];
  if (listIds.length) {
    targetClauses.push(`EXISTS (SELECT 1 FROM subscriber_list_memberships membership
      WHERE membership.project_id = subscriber.project_id AND membership.subscriber_id = subscriber.id
        AND membership.list_id IN (${listIds.map(() => "?").join(",")}))`);
    bindings.push(...listIds);
  }
  if (segmentIds.length) {
    targetClauses.push(`EXISTS (SELECT 1 FROM segment_memberships membership
      WHERE membership.project_id = subscriber.project_id AND membership.subscriber_id = subscriber.id
        AND membership.segment_id IN (${segmentIds.map(() => "?").join(",")}))`);
    bindings.push(...segmentIds);
  }
  await env.DB.prepare(
    `
    INSERT INTO email_deliveries
      (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status)
    SELECT lower(hex(randomblob(16))), subscriber.project_id, ?, subscriber.id, subscriber.email, subscriber.name, 'pending'
    FROM subscribers subscriber
    WHERE subscriber.project_id = ? AND subscriber.status = 'enabled' AND subscriber.consent_status = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM suppressions suppression
        WHERE suppression.project_id = subscriber.project_id AND suppression.email = subscriber.email)
      ${targetClauses.length ? `AND (${targetClauses.join(" OR ")})` : ""}
    ON CONFLICT(campaign_id, subscriber_id) DO NOTHING
  `,
  )
    .bind(job.campaignId, ...bindings)
    .run();
  await env.DB.prepare(
    `
    UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `,
  )
    .bind(job.campaignId, job.projectId)
    .run();
  const pending = await env.DB.prepare(
    `
    SELECT id FROM email_deliveries WHERE project_id = ? AND campaign_id = ? AND status = 'pending' LIMIT 1000
  `,
  )
    .bind(job.projectId, job.campaignId)
    .all<{ id: string }>();
  for (let index = 0; index < pending.results.length; index += 100) {
    const chunk = pending.results.slice(index, index + 100);
    await env.DB.batch(
      chunk.map((row) =>
        env.DB.prepare(
          `UPDATE email_deliveries SET status = 'sending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ? AND status = 'pending'`,
        ).bind(row.id, job.projectId),
      ),
    );
    try {
      await env.MARKETING_QUEUE.sendBatch(
        chunk.map((row) => ({
          body: {
            type: "marketing.email.deliver",
            projectId: job.projectId,
            deliveryId: row.id,
          } satisfies MarketingQueueJob,
        })),
      );
    } catch (error) {
      await env.DB.batch(
        chunk.map((row) =>
          env.DB.prepare(
            `UPDATE email_deliveries SET status = 'pending', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ? AND status = 'sending'`,
          ).bind(row.id, job.projectId),
        ),
      );
      throw error;
    }
  }
  if (pending.results.length === 1000) {
    await env.MARKETING_QUEUE.send(job, { delaySeconds: 2 });
  } else if (pending.results.length === 0) {
    await finishCampaignIfComplete(env, job.projectId, job.campaignId);
  }
  return { dispatched: true, queued: pending.results.length };
}

async function deliverEmail(
  env: Env,
  job: Extract<MarketingQueueJob, { type: "marketing.email.deliver" }>,
  queueAttempt: number,
) {
  const delivery = await env.DB.prepare(
    `
    SELECT * FROM email_deliveries WHERE id = ? AND project_id = ?
  `,
  )
    .bind(job.deliveryId, job.projectId)
    .first<Delivery>();
  if (
    !delivery ||
    ["sent", "delivered", "bounced", "complained", "unsubscribed"].includes(
      delivery.status,
    )
  )
    return;
  const campaign = await env.DB.prepare(
    `
    SELECT * FROM campaigns WHERE id = ? AND project_id = ?
  `,
  )
    .bind(delivery.campaign_id, job.projectId)
    .first<Campaign>();
  if (
    !campaign ||
    campaign.status === "cancelled" ||
    campaign.status === "archived"
  )
    return;
  if (campaign.status === "paused") {
    await env.MARKETING_QUEUE.send(job, { delaySeconds: 60 });
    return;
  }
  const subscriber = await env.DB.prepare(
    `
    SELECT attributes_json FROM subscribers WHERE id = ? AND project_id = ? AND status = 'enabled'
  `,
  )
    .bind(delivery.subscriber_id, job.projectId)
    .first<{ attributes_json: string }>();
  if (!subscriber) {
    await env.DB.prepare(
      `UPDATE email_deliveries SET status = 'suppressed', last_error = 'subscriber_not_eligible', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    )
      .bind(delivery.id)
      .run();
    await finishCampaignIfComplete(env, job.projectId, campaign.id);
    return;
  }
  const profiles = await smtpProfiles(
    env.DB,
    job.projectId,
    campaign.smtp_profile_id,
    env.ENVIRONMENT === "production",
  );
  if (!profiles.length)
    throw new Error("No production-ready SMTP profile is configured");
  const attributes = parseStoredJson<Record<string, unknown>>(
    subscriber.attributes_json,
    {},
  );
  const replacements = {
    email: delivery.recipient_email,
    name: delivery.recipient_name || "",
    ...attributes,
  };
  let lastError: unknown;
  for (const profile of profiles) {
    try {
      const publicConfig = parseStoredJson<SmtpPublicConfig>(
        profile.public_config_json,
        {} as SmtpPublicConfig,
      );
      const secret = await decryptJson<SmtpSecretConfig>(
        env.SMTP_ENCRYPTION_KEY,
        profile.encrypted_config,
      );
      const trackingPayload = {
        projectId: job.projectId,
        deliveryId: delivery.id,
        subscriberId: delivery.subscriber_id,
        campaignId: campaign.id,
      };
      const unsubscribe = await unsubscribeUrl(env, trackingPayload);
      const personalizedHtml = campaign.content_html
        ? personalize(campaign.content_html, replacements)
        : null;
      const result = await sendSmtpMessage(env, {
        idempotencyKey: `marketing.campaign:${job.projectId}:${delivery.id}:${profile.id}`,
        projectId: job.projectId,
        referenceId: delivery.id,
        profileId: profile.id,
        publicConfig,
        secret,
        message: {
          to: delivery.recipient_email,
          subject: personalize(campaign.subject, replacements),
          html:
            personalizedHtml && campaign.tracking_enabled
              ? await instrumentHtml(env, trackingPayload, personalizedHtml)
              : personalizedHtml,
          text: `${campaign.content_text ? personalize(campaign.content_text, replacements) : ""}\n\nUnsubscribe: ${unsubscribe}`,
          headers: {
            "X-OpenGrow-Campaign": campaign.id,
            "X-OpenGrow-Delivery": delivery.id,
            "List-Unsubscribe": `<${unsubscribe}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
      });
      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          `
          UPDATE email_deliveries SET status = 'sent', smtp_profile_id = ?, attempt_count = ?, provider_message_id = ?,
            sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND project_id = ?
        `,
        ).bind(
          profile.id,
          queueAttempt,
          result.messageId,
          now,
          now,
          delivery.id,
          job.projectId,
        ),
        env.DB.prepare(
          `
          INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json, occurred_at)
          VALUES (?, ?, ?, ?, ?, 'sent', ?, ?)
        `,
        ).bind(
          crypto.randomUUID(),
          job.projectId,
          campaign.id,
          delivery.subscriber_id,
          delivery.id,
          JSON.stringify({ smtp_profile_id: profile.id }),
          now,
        ),
        env.DB.prepare(
          `
          INSERT INTO smtp_attempts (id, project_id, delivery_id, smtp_profile_id, attempt_number, success)
          VALUES (?, ?, ?, ?, ?, 1)
        `,
        ).bind(
          crypto.randomUUID(),
          job.projectId,
          delivery.id,
          profile.id,
          queueAttempt,
        ),
      ]);
      await finishCampaignIfComplete(env, job.projectId, campaign.id);
      return;
    } catch (error) {
      if (isEmailTransportInProgress(error)) throw error;
      lastError = error;
      await env.DB.prepare(
        `
        INSERT INTO smtp_attempts (id, project_id, delivery_id, smtp_profile_id, attempt_number, success, error_message)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `,
      )
        .bind(
          crypto.randomUUID(),
          job.projectId,
          delivery.id,
          profile.id,
          queueAttempt,
          error instanceof Error
            ? error.message.slice(0, 2000)
            : String(error).slice(0, 2000),
        )
        .run();
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Every SMTP profile failed");
}

async function smtpProfiles(
  db: D1Database,
  projectId: number,
  preferred: string | null,
  requireAuthentication: boolean,
) {
  const rows = await db
    .prepare(
      `
    SELECT id, public_config_json, encrypted_config FROM smtp_profiles
    WHERE project_id = ? AND enabled = 1
      AND (? = 0 OR authentication_status = 'verified')
      AND (hourly_quota IS NULL OR hourly_quota > (
        SELECT COUNT(*) FROM email_deliveries delivery
        WHERE delivery.project_id = smtp_profiles.project_id AND delivery.smtp_profile_id = smtp_profiles.id
          AND delivery.sent_at >= datetime('now', '-1 hour') AND delivery.status IN ('sent', 'delivered')
      ))
      AND (daily_quota IS NULL OR daily_quota > (
        SELECT COUNT(*) FROM email_deliveries delivery
        WHERE delivery.project_id = smtp_profiles.project_id AND delivery.smtp_profile_id = smtp_profiles.id
          AND delivery.sent_at >= datetime('now', '-1 day') AND delivery.status IN ('sent', 'delivered')
      ))
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, priority ASC, created_at ASC
  `,
    )
    .bind(projectId, requireAuthentication ? 1 : 0, preferred || "")
    .all<SmtpProfile>();
  return rows.results;
}

async function markDeliveryFailed(
  env: Env,
  projectId: number,
  deliveryId: string,
  error: unknown,
) {
  const delivery = await env.DB.prepare(
    "SELECT campaign_id, subscriber_id FROM email_deliveries WHERE id = ? AND project_id = ?",
  )
    .bind(deliveryId, projectId)
    .first<{ campaign_id: string; subscriber_id: string }>();
  if (!delivery) return;
  const message =
    error instanceof Error
      ? error.message.slice(0, 2_000)
      : String(error).slice(0, 2_000);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE email_deliveries SET status = 'failed', last_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?`,
    ).bind(message, deliveryId, projectId),
    env.DB.prepare(
      `INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json) VALUES (?, ?, ?, ?, ?, 'error', ?)`,
    ).bind(
      crypto.randomUUID(),
      projectId,
      delivery.campaign_id,
      delivery.subscriber_id,
      deliveryId,
      JSON.stringify({ error: message }),
    ),
  ]);
  await finishCampaignIfComplete(env, projectId, delivery.campaign_id);
}

async function finishCampaignIfComplete(
  env: Env,
  projectId: number,
  campaignId: string,
) {
  const count = await env.DB.prepare(
    `
    SELECT COUNT(*) pending FROM email_deliveries WHERE project_id = ? AND campaign_id = ? AND status IN ('pending', 'sending')
  `,
  )
    .bind(projectId, campaignId)
    .first<{ pending: number }>();
  if (Number(count?.pending || 0) > 0) return;
  await env.DB.prepare(
    `
    UPDATE campaigns SET status = CASE WHEN status = 'running' THEN 'finished' ELSE status END,
      sent_count = (SELECT COUNT(*) FROM email_deliveries WHERE campaign_id = ? AND status IN ('sent','delivered')),
      finished_at = CASE WHEN status = 'running' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE finished_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
  `,
  )
    .bind(campaignId, campaignId, projectId)
    .run();
}

function personalize(content: string, values: Record<string, unknown>) {
  return content.replace(
    /{{\s*([A-Za-z0-9_.-]+)\s*}}/g,
    (_match, key: string) => {
      const value = key
        .split(".")
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === "object"
              ? (current as Record<string, unknown>)[part]
              : undefined,
          values,
        );
      return value == null ? "" : String(value);
    },
  );
}

export function isMarketingQueueJob(
  value: unknown,
): value is MarketingQueueJob {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<MarketingQueueJob>;
  return (
    (job.type === "marketing.campaign.dispatch" &&
      Number.isSafeInteger(job.projectId) &&
      typeof job.campaignId === "string") ||
    (job.type === "marketing.email.deliver" &&
      Number.isSafeInteger(job.projectId) &&
      typeof job.deliveryId === "string") ||
    (job.type === "marketing.optin.deliver" &&
      Number.isSafeInteger(job.projectId) &&
      typeof job.subscriberId === "string" &&
      job.subscriberId.length > 0 &&
      typeof job.outboxId === "string" &&
      job.outboxId.length > 0 &&
      typeof job.token === "string" &&
      job.token.length >= 20 &&
      job.token.length <= 512)
  );
}
