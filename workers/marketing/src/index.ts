import { Hono, type Context } from "hono";
import { inspectSqlDatabaseAndSchemaHealth } from "@superboard/contracts/health";
import { verifyInternalProjectContext, failure } from "./auth";
import { decryptJson, encryptJson, sha256 } from "./secrets";
import {
  acknowledgeEmailProviderEvents,
  pendingEmailProviderEvents,
  sendSmtpMessage,
} from "./email-service";
import type {
  Env,
  MarketingQueueJob,
  ProjectContext,
  SmtpPublicConfig,
  SmtpSecretConfig,
} from "./types";
import {
  booleanValue,
  email,
  identifier,
  isoTimestamp,
  jsonObject,
  optionalText,
  parseStoredJson,
  positiveInt,
  readJsonObject,
  stringArray,
  text,
} from "./validation";
import { handleMarketingQueue, isMarketingQueueJob } from "./queue";
import { verifyTrackingToken } from "./tracking";
import { verifyEmailAuthentication } from "./email-authentication";
import { marketingIdentityHashCandidates } from "./identity";
import { dispatchDueJourneyEnrollments, journeyRoutes } from "./journeys";

const app = new Hono<{
  Bindings: Env;
  Variables: { project: ProjectContext };
}>();
type MarketingContext = Context<{
  Bindings: Env;
  Variables: { project: ProjectContext };
}>;

app.get("/internal/v1/health", async (c) => {
  try {
    const schema = await inspectSqlDatabaseAndSchemaHealth(
      c.env.DB,
      c.env.D1_EXPECTED_MIGRATION,
    );
    const current = schema.status === "current";
    return c.json(
      {
        data: {
          service: "marketing",
          version: "v1",
          status: current ? "ok" : "degraded",
          storage: "d1",
          schema,
          ...(current ? {} : { reason: "database_schema_not_current" }),
          metrics: await marketingHealth(c.env.DB),
        },
      },
      current ? 200 : 503,
      { "cache-control": "no-store" },
    );
  } catch {
    return c.json(
      {
        data: {
          service: "marketing",
          version: "v1",
          status: "degraded",
          storage: "d1",
          reason: "database_health_unavailable",
        },
      },
      503,
      { "cache-control": "no-store" },
    );
  }
});

export async function marketingHealth(db: D1Database) {
  const row = await db
    .prepare(
      `
    SELECT
      (SELECT COUNT(*) FROM subscribers) AS subscribers_total,
      (SELECT COUNT(*) FROM subscribers WHERE consent_status = 'pending') AS subscribers_pending,
      (SELECT COUNT(*) FROM subscribers WHERE consent_status = 'confirmed') AS subscribers_confirmed,
      (SELECT COUNT(*) FROM subscribers WHERE status = 'unsubscribed' OR consent_status = 'revoked') AS subscribers_unsubscribed,
      (SELECT COUNT(*) FROM suppressions) AS suppressions_total,
      (SELECT COUNT(*) FROM subscriber_lists) AS lists_total,
      (SELECT COUNT(*) FROM subscriber_segments) AS segments_total,
      (SELECT COUNT(*) FROM email_templates) AS templates_total,
      (SELECT COUNT(*) FROM campaigns) AS campaigns_total,
      (SELECT COUNT(*) FROM campaigns WHERE status = 'scheduled') AS campaigns_scheduled,
      (SELECT COUNT(*) FROM campaigns WHERE status = 'running') AS campaigns_running,
      (SELECT COUNT(*) FROM campaigns WHERE status = 'paused') AS campaigns_paused,
      (SELECT COUNT(*) FROM campaigns WHERE status = 'finished') AS campaigns_finished,
      (SELECT COUNT(*) FROM marketing_journeys) AS journeys_total,
      (SELECT COUNT(*) FROM marketing_journeys WHERE status = 'active') AS journeys_active,
      (SELECT COUNT(*) FROM marketing_journey_enrollments WHERE status IN ('active', 'waiting', 'processing')) AS journey_enrollments_active,
      (SELECT COUNT(*) FROM marketing_signal_receipts) AS signals_total,
      (SELECT COUNT(*) FROM email_deliveries) AS deliveries_total,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'pending') AS deliveries_pending,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'sending') AS deliveries_sending,
      (SELECT COUNT(*) FROM email_deliveries WHERE status IN ('sent', 'delivered')) AS deliveries_successful,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'failed') AS deliveries_failed,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'bounced') AS deliveries_bounced,
      (SELECT COUNT(*) FROM email_deliveries WHERE status = 'complained') AS deliveries_complained,
      (SELECT COUNT(*) FROM marketing_outbox WHERE status = 'pending') AS outbox_pending,
      (SELECT COUNT(*) FROM marketing_outbox WHERE status = 'dead_letter') AS outbox_dead_letter,
      (SELECT COUNT(*) FROM marketing_dead_letters WHERE status = 'quarantined') AS dead_letters_quarantined,
      (SELECT COUNT(*) FROM marketing_dead_letters WHERE resolution = 'replayed') AS dead_letters_replayed,
      (SELECT COUNT(*) FROM marketing_dead_letters WHERE resolution = 'discarded') AS dead_letters_discarded,
      (SELECT COUNT(*) FROM smtp_profiles WHERE enabled = 1) AS smtp_profiles_enabled,
      (SELECT COUNT(*) FROM smtp_profiles WHERE enabled = 1 AND authentication_status = 'verified') AS smtp_profiles_verified,
      (SELECT COUNT(*) FROM smtp_profiles WHERE enabled = 1 AND authentication_status != 'verified') AS smtp_profiles_unverified,
      (SELECT COUNT(*) FROM marketing_media) AS media_total,
      (SELECT COALESCE(SUM(byte_size), 0) FROM marketing_media) AS media_bytes
  `,
    )
    .first<Record<string, number | null>>();
  if (!row) throw new Error("Marketing health query returned no row");
  const value = (key: string) => Number(row[key] || 0);
  return {
    audience: {
      subscribers: value("subscribers_total"),
      pendingConsent: value("subscribers_pending"),
      confirmedConsent: value("subscribers_confirmed"),
      unsubscribed: value("subscribers_unsubscribed"),
      suppressions: value("suppressions_total"),
      lists: value("lists_total"),
      segments: value("segments_total"),
    },
    content: {
      templates: value("templates_total"),
      campaigns: value("campaigns_total"),
      journeys: value("journeys_total"),
      activeJourneys: value("journeys_active"),
      activeJourneyEnrollments: value("journey_enrollments_active"),
      analyticsSignals: value("signals_total"),
      scheduled: value("campaigns_scheduled"),
      running: value("campaigns_running"),
      paused: value("campaigns_paused"),
      finished: value("campaigns_finished"),
      media: value("media_total"),
      mediaBytes: value("media_bytes"),
    },
    deliveries: {
      total: value("deliveries_total"),
      pending: value("deliveries_pending"),
      sending: value("deliveries_sending"),
      successful: value("deliveries_successful"),
      failed: value("deliveries_failed"),
      bounced: value("deliveries_bounced"),
      complained: value("deliveries_complained"),
    },
    outbox: {
      pending: value("outbox_pending"),
      deadLetter: value("outbox_dead_letter"),
    },
    senderAuthentication: {
      enabledProfiles: value("smtp_profiles_enabled"),
      verifiedProfiles: value("smtp_profiles_verified"),
      unverifiedProfiles: value("smtp_profiles_unverified"),
      ready:
        value("smtp_profiles_enabled") > 0 &&
        value("smtp_profiles_unverified") === 0,
    },
    deadLetters: {
      quarantined: value("dead_letters_quarantined"),
      replayed: value("dead_letters_replayed"),
      discarded: value("dead_letters_discarded"),
    },
  };
}

app.get("/public/v1/tracking/open/:token", async (c) => {
  const payload = await verifyTrackingToken(
    c.env,
    c.req.param("token"),
    "open",
  );
  await recordTrackingEvent(c.env.DB, payload, "open");
  return new Response(
    Uint8Array.from([
      71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
      249, 4, 1, 0, 0, 1, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
    ]),
    {
      headers: {
        "content-type": "image/gif",
        "cache-control": "no-store, max-age=0",
      },
    },
  );
});

app.get("/public/v1/tracking/click/:token", async (c) => {
  const payload = await verifyTrackingToken(
    c.env,
    c.req.param("token"),
    "click",
  );
  await recordTrackingEvent(c.env.DB, payload, "click", {
    target: payload.target,
  });
  return c.redirect(String(payload.target), 302);
});

app.all("/public/v1/tracking/unsubscribe/:token", async (c) => {
  if (!["GET", "POST"].includes(c.req.method))
    throw failure("method_not_allowed", "Method not allowed", 405);
  const payload = await verifyTrackingToken(
    c.env,
    c.req.param("token"),
    "unsubscribe",
  );
  const subscriberRow = await subscriber(
    c.env.DB,
    payload.projectId,
    payload.subscriberId,
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
    ).bind(payload.projectId, payload.subscriberId),
    c.env.DB.prepare(
      `INSERT INTO suppressions (id, project_id, email, reason, source) VALUES (?, ?, ?, 'unsubscribe', 'tracking') ON CONFLICT(project_id, email) DO UPDATE SET reason = 'unsubscribe', source = 'tracking'`,
    ).bind(crypto.randomUUID(), payload.projectId, subscriberRow.email),
  ]);
  await recordTrackingEvent(c.env.DB, payload, "unsubscribe");
  return c.req.method === "GET"
    ? c.html(
        "<!doctype html><html><body><h1>Unsubscribed</h1><p>You will no longer receive these emails.</p></body></html>",
      )
    : c.json({ data: { unsubscribed: true } });
});

app.all("/public/v1/opt-in/:token", async (c) => {
  if (!["GET", "POST"].includes(c.req.method))
    throw failure("method_not_allowed", "Method not allowed", 405);
  const tokenHash = await sha256(text(c.req.param("token"), "token", 512));
  const confirmed = await c.env.DB.prepare(
    `
    UPDATE subscribers SET consent_status = 'confirmed', consented_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      optin_token_hash = NULL, optin_token_expires_at = NULL, status = 'enabled',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE optin_token_hash = ? AND consent_status = 'pending'
      AND optin_token_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    RETURNING id, project_id
  `,
  )
    .bind(tokenHash)
    .first<{ id: string; project_id: number }>();
  if (!confirmed)
    throw failure(
      "confirmation_invalid",
      "Confirmation token is invalid or expired",
      422,
    );
  await c.env.DB.prepare(
    `
    INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
    VALUES (?, ?, 'subscriber.double_optin_confirmed', 'subscriber', ?, ?)
  `,
  )
    .bind(
      crypto.randomUUID(),
      confirmed.project_id,
      crypto.randomUUID(),
      JSON.stringify({ subscriber_id: confirmed.id }),
    )
    .run();
  return c.req.method === "GET"
    ? c.html(
        "<!doctype html><html><body><h1>Subscription confirmed</h1><p>Your email preferences have been updated.</p></body></html>",
      )
    : c.json({ data: { confirmed: true } });
});

app.use("/internal/v1/*", async (c, next) => {
  c.set("project", await verifyInternalProjectContext(c.req.raw, c.env));
  await next();
});

app.use("/internal/v1/*", async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const project = c.get("project");
  const path = new URL(c.req.url).pathname;
  const applicationPreferenceMutation =
    project.role.toLowerCase() === "application" &&
    path === "/internal/v1/application/preferences" &&
    c.req.method === "PUT";
  const applicationErasureMutation =
    project.role.toLowerCase() === "application" &&
    /^\/internal\/v1\/application\/users\/[^/]+$/u.test(path) &&
    c.req.method === "DELETE";
  const analyticsSignalMutation =
    project.role.toLowerCase() === "system" &&
    path === "/internal/v1/signals" &&
    c.req.method === "POST";
  if (
    !applicationPreferenceMutation &&
    !applicationErasureMutation &&
    !analyticsSignalMutation &&
    !["owner", "admin"].includes(project.role.toLowerCase())
  ) {
    throw failure(
      "role_insufficient",
      "Owner or admin access is required to change Marketing resources",
      403,
    );
  }
  const providedKey = String(c.req.header("Idempotency-Key") || "").trim();
  if (!providedKey || providedKey.length > 255) {
    throw failure(
      "idempotency_key_invalid",
      "Idempotency-Key is required and limited to 255 characters",
      422,
    );
  }
  const key = `${c.req.method}:${path}:${providedKey}`;
  const claim = await c.env.DB.prepare(
    `
    INSERT INTO marketing_idempotency_keys (project_id, key, request_method, request_path, state)
    VALUES (?, ?, ?, ?, 'processing') ON CONFLICT(project_id, key) DO NOTHING RETURNING key
  `,
  )
    .bind(project.projectId, key, c.req.method, path)
    .first();
  if (!claim) {
    const existing = await c.env.DB.prepare(
      `
      SELECT response_status, response_body FROM marketing_idempotency_keys WHERE project_id = ? AND key = ?
    `,
    )
      .bind(project.projectId, key)
      .first<{
        response_status: number | null;
        response_body: string | null;
      }>();
    if (!existing?.response_status || existing.response_body == null)
      throw failure(
        "idempotency_in_progress",
        "An identical request is already being processed",
        409,
      );
    return new Response(existing.response_body, {
      status: existing.response_status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "idempotency-replayed": "true",
      },
    });
  }
  try {
    await next();
    if (c.res.status >= 500) {
      await c.env.DB.prepare(
        "DELETE FROM marketing_idempotency_keys WHERE project_id = ? AND key = ?",
      )
        .bind(project.projectId, key)
        .run();
      return;
    }
    const responseBody = await c.res.clone().text();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `
        UPDATE marketing_idempotency_keys SET state = 'completed', response_status = ?, response_body = ?,
          completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND key = ?
      `,
      ).bind(c.res.status, responseBody, project.projectId, key),
      c.env.DB.prepare(
        `
        INSERT INTO audit_events (id, project_id, action, actor_id, request_id, payload_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).bind(
        crypto.randomUUID(),
        project.projectId,
        `${c.req.method} ${path}`,
        project.actorId,
        project.requestId,
        JSON.stringify({ status: c.res.status }),
      ),
    ]);
  } catch (error) {
    await c.env.DB.prepare(
      "DELETE FROM marketing_idempotency_keys WHERE project_id = ? AND key = ?",
    )
      .bind(project.projectId, key)
      .run();
    throw error;
  }
});

app.route("/internal/v1", journeyRoutes);

app.get("/internal/v1", (c) =>
  c.json({
    data: {
      service: "marketing",
      capabilities: [
        "subscribers",
        "lists",
        "segments",
        "templates",
        "campaigns",
        "journeys",
        "event_triggers",
        "omnichannel_connectors",
        "smtp",
        "deliveries",
        "feedback",
        "tracking",
        "statistics",
        "application_preferences",
      ],
    },
  }),
);

app.get("/internal/v1/application/preferences", async (c) => {
  const identity = applicationIdentity(c);
  return c.json({
    data: await applicationPreferences(
      c.env.DB,
      c.get("project").projectId,
      identity,
    ),
  });
});

app.put("/internal/v1/application/preferences", async (c) => {
  const projectId = c.get("project").projectId;
  const identity = applicationIdentity(c);
  const body = await readJsonObject(c.req.raw);
  if (typeof body.consented !== "boolean") {
    throw failure("consent_invalid", "consented must be a boolean");
  }
  const attributes = jsonObject(body.attributes, "attributes");
  const requestedLists = stringArray(body.list_ids, "list_ids");
  if (requestedLists.length > 50) {
    throw failure(
      "list_ids_invalid",
      "list_ids must contain at most 50 public lists",
    );
  }
  const publicLists = requestedLists.length
    ? await c.env.DB.prepare(
        `SELECT id FROM subscriber_lists
         WHERE project_id = ? AND visibility = 'public'
           AND id IN (${requestedLists.map(() => "?").join(",")})`,
      )
        .bind(projectId, ...requestedLists)
        .all<{ id: string }>()
    : { results: [] as Array<{ id: string }> };
  const selectedLists = publicLists.results.map((row) => row.id);
  if (selectedLists.length !== requestedLists.length) {
    throw failure(
      "list_ids_invalid",
      "Every requested list must be a public list in this project",
    );
  }

  const [byUser, byEmail, suppression] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id FROM subscribers WHERE project_id = ? AND application_user_id = ? LIMIT 1",
    )
      .bind(projectId, identity.userId)
      .first<{ id: string }>(),
    c.env.DB.prepare(
      "SELECT id FROM subscribers WHERE project_id = ? AND email = ? LIMIT 1",
    )
      .bind(projectId, identity.email)
      .first<{ id: string }>(),
    c.env.DB.prepare(
      "SELECT reason FROM suppressions WHERE project_id = ? AND email = ? LIMIT 1",
    )
      .bind(projectId, identity.email)
      .first<{ reason: string }>(),
  ]);
  if (byUser && byEmail && byUser.id !== byEmail.id) {
    throw failure(
      "subscriber_identity_conflict",
      "The authenticated identity and email belong to different subscribers",
      409,
    );
  }
  if (body.consented && suppression && suppression.reason !== "unsubscribe") {
    throw failure(
      "subscriber_suppressed",
      "This address cannot be resubscribed from the application",
      409,
    );
  }

  const subscriberId = byUser?.id || byEmail?.id || crypto.randomUUID();
  const identityHashes = await marketingIdentityHashCandidates(
    c.env,
    projectId,
    "user",
    identity.userId,
  );
  const now = new Date().toISOString();
  const consented = body.consented;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO subscribers
        (id, project_id, email, name, status, attributes_json, consent_status,
         consent_source, consented_at, unsubscribed_at, created_at, updated_at,
         application_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'application', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         status = excluded.status,
         attributes_json = excluded.attributes_json,
         consent_status = excluded.consent_status,
         consent_source = 'application',
         consented_at = excluded.consented_at,
         unsubscribed_at = excluded.unsubscribed_at,
         updated_at = excluded.updated_at,
         application_user_id = excluded.application_user_id`,
    ).bind(
      subscriberId,
      projectId,
      identity.email,
      identity.name,
      consented ? "enabled" : "unsubscribed",
      JSON.stringify(attributes),
      consented ? "confirmed" : "revoked",
      consented ? now : null,
      consented ? null : now,
      now,
      now,
      identity.userId,
    ),
    c.env.DB.prepare(
      `DELETE FROM subscriber_list_memberships
       WHERE project_id = ? AND subscriber_id = ?
         AND list_id IN (
           SELECT id FROM subscriber_lists
           WHERE project_id = ? AND visibility = 'public'
         )`,
    ).bind(projectId, subscriberId, projectId),
    ...selectedLists.map((listId) =>
      c.env.DB.prepare(
        `INSERT INTO subscriber_list_memberships
          (project_id, subscriber_id, list_id, source)
         VALUES (?, ?, ?, 'application')
         ON CONFLICT(project_id, subscriber_id, list_id) DO NOTHING`,
      ).bind(projectId, subscriberId, listId),
    ),
    consented
      ? c.env.DB.prepare(
          "DELETE FROM suppressions WHERE project_id = ? AND email = ? AND reason = 'unsubscribe'",
        ).bind(projectId, identity.email)
      : c.env.DB.prepare(
          `INSERT INTO suppressions
            (id, project_id, email, reason, source, metadata_json)
           VALUES (?, ?, ?, 'unsubscribe', 'application', '{}')
           ON CONFLICT(project_id, email) DO NOTHING`,
        ).bind(crypto.randomUUID(), projectId, identity.email),
    c.env.DB.prepare(
      `DELETE FROM subscriber_identity_aliases
       WHERE project_id = ? AND subscriber_id = ? AND identity_kind = 'user'`,
    ).bind(projectId, subscriberId),
    ...identityHashes.map((identityHash, keyPosition) =>
      c.env.DB.prepare(
        `INSERT INTO subscriber_identity_aliases
          (project_id, subscriber_id, identity_kind, identity_hash, key_position)
         VALUES (?, ?, 'user', ?, ?)`,
      ).bind(projectId, subscriberId, identityHash, keyPosition),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({
    data: await applicationPreferences(c.env.DB, projectId, identity),
  });
});

app.delete("/internal/v1/application/users/:userId", async (c) => {
  const projectId = c.get("project").projectId;
  const identity = applicationIdentity(c);
  if (identity.userId !== c.req.param("userId")) {
    throw failure(
      "application_identity_mismatch",
      "Application identity does not match the erasure subject",
      403,
    );
  }
  const subscriber = await c.env.DB.prepare(
    `SELECT id, email FROM subscribers
     WHERE project_id = ? AND application_user_id = ? LIMIT 1`,
  )
    .bind(projectId, identity.userId)
    .first<{ id: string; email: string }>();
  if (!subscriber) {
    return c.json({ data: { erased: true, subscribers_redacted: 0 } });
  }

  // Keep the minimum suppression record required to prevent accidental future
  // marketing. Every campaign/delivery profile field is otherwise redacted.
  const erasedAddress = `erased+${(await sha256(`${projectId}:${identity.userId}`)).slice(0, 32)}@invalid.opengrow`;
  const now = new Date().toISOString();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO suppressions
        (id, project_id, email, reason, source, metadata_json)
       VALUES (?, ?, ?, 'privacy_delete', 'account_erasure', '{}')
       ON CONFLICT(project_id, email) DO UPDATE SET
         reason = 'privacy_delete', source = 'account_erasure', metadata_json = '{}'`,
    ).bind(crypto.randomUUID(), projectId, subscriber.email),
    c.env.DB.prepare(
      `DELETE FROM subscriber_list_memberships
       WHERE project_id = ? AND subscriber_id = ?`,
    ).bind(projectId, subscriber.id),
    c.env.DB.prepare(
      `DELETE FROM marketing_outbox
       WHERE project_id = ? AND resource_id = ?
         AND status IN ('pending', 'dispatched', 'dead_letter')`,
    ).bind(projectId, subscriber.id),
    c.env.DB.prepare(
      `UPDATE email_deliveries SET
         recipient_email = ?, recipient_name = NULL,
         provider_message_id = NULL,
         status = CASE WHEN status IN ('pending', 'sending') THEN 'suppressed' ELSE status END,
         last_error = NULL, updated_at = ?
       WHERE project_id = ? AND subscriber_id = ?`,
    ).bind(erasedAddress, now, projectId, subscriber.id),
    c.env.DB.prepare(
      `UPDATE email_events SET metadata_json = '{}'
       WHERE project_id = ? AND subscriber_id = ?`,
    ).bind(projectId, subscriber.id),
    c.env.DB.prepare(
      `UPDATE subscribers SET
         email = ?, name = NULL, status = 'blocklisted', attributes_json = '{}',
         consent_status = 'revoked', consent_source = 'account_erasure',
         optin_token_hash = NULL, optin_token_expires_at = NULL,
         application_user_id = NULL, unsubscribed_at = COALESCE(unsubscribed_at, ?),
         updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).bind(erasedAddress, now, now, projectId, subscriber.id),
    c.env.DB.prepare(
      `DELETE FROM subscriber_identity_aliases
       WHERE project_id = ? AND subscriber_id = ?`,
    ).bind(projectId, subscriber.id),
  ]);
  return c.json({
    data: {
      erased: true,
      subscribers_redacted: Number(results[5].meta.changes || 0),
      deliveries_redacted: Number(results[3].meta.changes || 0),
    },
  });
});

app.get("/internal/v1/email/subscribers", async (c) => {
  const projectId = c.get("project").projectId;
  const query = String(c.req.query("q") || "")
    .trim()
    .slice(0, 255);
  const status = String(c.req.query("status") || "").trim();
  const limit = Math.min(
    positiveInt(c.req.query("limit") || 100, "limit"),
    500,
  );
  const offset = Math.max(Number(c.req.query("offset") || 0), 0);
  const like = `%${escapeLike(query)}%`;
  const rows = await c.env.DB.prepare(
    `
    SELECT subscriber.*,
      (SELECT json_group_array(membership.list_id) FROM subscriber_list_memberships membership
        WHERE membership.project_id = subscriber.project_id AND membership.subscriber_id = subscriber.id) list_ids_json
    FROM subscribers subscriber WHERE subscriber.project_id = ?
      AND (? = '' OR subscriber.status = ?) AND (? = '' OR subscriber.email LIKE ? ESCAPE '\\' OR COALESCE(subscriber.name, '') LIKE ? ESCAPE '\\')
    ORDER BY subscriber.created_at DESC LIMIT ? OFFSET ?
  `,
  )
    .bind(projectId, status, status, query, like, like, limit, offset)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeSubscriber) });
});

app.post("/internal/v1/email/subscribers", async (c) => {
  const project = c.get("project");
  const body = await readJsonObject(c.req.raw);
  const address = email(body.email);
  const now = new Date().toISOString();
  const doubleOptIn = booleanValue(body.double_opt_in, false);
  const confirmationToken = doubleOptIn ? randomToken() : null;
  const outboxId = doubleOptIn ? crypto.randomUUID() : null;
  const optinExpiresAt = doubleOptIn
    ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    : null;
  const row = {
    id: crypto.randomUUID(),
    email: address,
    name: optionalText(body.name, "name", 255),
    status: "enabled",
    consent_status: doubleOptIn ? "pending" : "confirmed",
    consent_source:
      optionalText(body.consent_source, "consent_source", 128) || "admin",
    attributes: jsonObject(body.attributes, "attributes"),
    created_at: now,
  };
  const existing = await c.env.DB.prepare(
    "SELECT id FROM subscribers WHERE project_id = ? AND email = ?",
  )
    .bind(project.projectId, address)
    .first<{ id: string }>();
  if (existing)
    throw failure(
      "subscriber_conflict",
      "A subscriber with this email already exists",
      409,
    );
  await c.env.DB.batch([
    c.env.DB.prepare(
      `
      INSERT INTO subscribers
        (id, project_id, email, name, status, attributes_json, consent_status, consent_source,
          optin_token_hash, optin_token_expires_at, consented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'enabled', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).bind(
      row.id,
      project.projectId,
      row.email,
      row.name,
      JSON.stringify(row.attributes),
      row.consent_status,
      row.consent_source,
      confirmationToken ? await sha256(confirmationToken) : null,
      optinExpiresAt,
      doubleOptIn ? null : now,
      now,
      now,
    ),
    ...stringArray(body.list_ids, "list_ids").map((listId) =>
      c.env.DB.prepare(
        `
      INSERT INTO subscriber_list_memberships (project_id, subscriber_id, list_id, source)
      SELECT ?, ?, id, 'admin' FROM subscriber_lists WHERE project_id = ? AND id = ?
    `,
      ).bind(project.projectId, row.id, project.projectId, listId),
    ),
    ...(outboxId && confirmationToken
      ? [
          c.env.DB.prepare(
            `
      INSERT INTO marketing_outbox (id, project_id, job_type, resource_id, encrypted_payload)
      VALUES (?, ?, 'double_optin', ?, ?)
    `,
          ).bind(
            outboxId,
            project.projectId,
            row.id,
            await encryptJson(c.env.SMTP_ENCRYPTION_KEY, {
              token: confirmationToken,
            }),
          ),
        ]
      : []),
  ]);
  if (outboxId && confirmationToken) {
    await dispatchOptinOutbox(c.env, {
      type: "marketing.optin.deliver",
      projectId: project.projectId,
      subscriberId: row.id,
      token: confirmationToken,
      outboxId,
    });
  }
  return c.json(
    {
      data: {
        ...row,
        confirmation_required: doubleOptIn,
        confirmation_expires_at: optinExpiresAt,
      },
    },
    201,
  );
});

app.get("/internal/v1/email/subscribers/:subscriberId", async (c) => {
  return c.json({
    data: serializeSubscriber(
      await subscriber(
        c.env.DB,
        c.get("project").projectId,
        c.req.param("subscriberId"),
      ),
    ),
  });
});

app.get("/internal/v1/email/subscribers/:subscriberId/export", async (c) => {
  const projectId = c.get("project").projectId;
  const row = await subscriber(
    c.env.DB,
    projectId,
    c.req.param("subscriberId"),
  );
  const [memberships, deliveries, events] = await Promise.all([
    c.env.DB.prepare(
      `SELECT list_id, source, subscribed_at FROM subscriber_list_memberships WHERE project_id = ? AND subscriber_id = ?`,
    )
      .bind(projectId, row.id)
      .all(),
    c.env.DB.prepare(
      `SELECT id, campaign_id, status, sent_at, created_at FROM email_deliveries WHERE project_id = ? AND subscriber_id = ? ORDER BY created_at`,
    )
      .bind(projectId, row.id)
      .all(),
    c.env.DB.prepare(
      `SELECT campaign_id, event_type, metadata_json, occurred_at FROM email_events WHERE project_id = ? AND subscriber_id = ? ORDER BY occurred_at`,
    )
      .bind(projectId, row.id)
      .all(),
  ]);
  return c.json({
    data: {
      subscriber: serializeSubscriber(row),
      memberships: memberships.results,
      deliveries: deliveries.results,
      events: events.results,
    },
  });
});

app.patch("/internal/v1/email/subscribers/:subscriberId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await subscriber(
    c.env.DB,
    projectId,
    c.req.param("subscriberId"),
  );
  const body = await readJsonObject(c.req.raw);
  const address =
    body.email == null ? String(current.email) : email(body.email);
  const name =
    body.name === undefined
      ? current.name
      : optionalText(body.name, "name", 255);
  const attributes =
    body.attributes === undefined
      ? parseStoredJson(current.attributes_json, {})
      : jsonObject(body.attributes, "attributes");
  await c.env.DB.prepare(
    `
    UPDATE subscribers SET email = ?, name = ?, attributes_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND id = ?
  `,
  )
    .bind(address, name, JSON.stringify(attributes), projectId, current.id)
    .run();
  return c.json({
    data: serializeSubscriber(
      await subscriber(c.env.DB, projectId, String(current.id)),
    ),
  });
});

app.post("/internal/v1/email/subscribers/:subscriberId/confirm", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const tokenHash = await sha256(text(body.token, "token", 512));
  const updated = await c.env.DB.prepare(
    `
    UPDATE subscribers SET consent_status = 'confirmed', consented_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      optin_token_hash = NULL, status = 'enabled', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND id = ? AND optin_token_hash = ? AND consent_status = 'pending'
      AND optin_token_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') RETURNING *
  `,
  )
    .bind(projectId, c.req.param("subscriberId"), tokenHash)
    .first<Record<string, unknown>>();
  if (!updated)
    throw failure(
      "confirmation_invalid",
      "Confirmation token is invalid or expired",
      422,
    );
  return c.json({ data: serializeSubscriber(updated) });
});

app.post(
  "/internal/v1/email/subscribers/:subscriberId/blocklist",
  async (c) => {
    return suppressSubscriber(
      c.env,
      c.get("project"),
      c.req.param("subscriberId"),
      "blocklisted",
      "manual",
    );
  },
);

app.post(
  "/internal/v1/email/subscribers/:subscriberId/unsubscribe",
  async (c) => {
    return suppressSubscriber(
      c.env,
      c.get("project"),
      c.req.param("subscriberId"),
      "unsubscribed",
      "unsubscribe",
    );
  },
);

app.delete("/internal/v1/email/subscribers/:subscriberId", async (c) => {
  const projectId = c.get("project").projectId;
  const deleted = await c.env.DB.prepare(
    "DELETE FROM subscribers WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(projectId, c.req.param("subscriberId"))
    .first();
  if (!deleted)
    throw failure("subscriber_not_found", "Subscriber not found", 404);
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/email/subscribers-export", async (c) => {
  const projectId = c.get("project").projectId;
  const rows = await c.env.DB.prepare(
    `
    SELECT email, name, status, consent_status, consent_source, attributes_json, created_at
    FROM subscribers WHERE project_id = ? ORDER BY created_at LIMIT 10000
  `,
  )
    .bind(projectId)
    .all<Record<string, unknown>>();
  if (c.req.query("format") === "csv") {
    const csv = [
      "email,name,status,consent_status,consent_source,attributes_json,created_at",
      ...rows.results.map((row) =>
        [
          row.email,
          row.name,
          row.status,
          row.consent_status,
          row.consent_source,
          row.attributes_json,
          row.created_at,
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="subscribers.csv"',
      },
    });
  }
  return c.json({ data: rows.results });
});

app.post("/internal/v1/email/subscribers-import", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  if (!Array.isArray(body.subscribers) || body.subscribers.length > 1000)
    throw failure(
      "subscribers_invalid",
      "subscribers must contain at most 1000 records",
    );
  const records = new Map<string, Record<string, unknown>>();
  for (const value of body.subscribers) {
    const item =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    records.set(email(item.email), item);
  }
  const addresses = [...records.keys()];
  const existingAddresses = new Set<string>();
  for (let index = 0; index < addresses.length; index += 100) {
    const chunk = addresses.slice(index, index + 100);
    if (!chunk.length) continue;
    const rows = await c.env.DB.prepare(
      `
      SELECT email FROM subscribers WHERE project_id = ? AND email IN (${chunk.map(() => "?").join(",")})
    `,
    )
      .bind(projectId, ...chunk)
      .all<{ email: string }>();
    for (const row of rows.results) existingAddresses.add(row.email);
  }
  const statements: D1PreparedStatement[] = [];
  for (const [address, item] of records) {
    const id = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `
      INSERT INTO subscribers (id, project_id, email, name, status, attributes_json, consent_status, consent_source, consented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'enabled', ?, 'confirmed', 'import', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(project_id, email) DO UPDATE SET name = excluded.name, attributes_json = excluded.attributes_json,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `,
      ).bind(
        id,
        projectId,
        address,
        optionalText(item.name, "name"),
        JSON.stringify(jsonObject(item.attributes, "attributes")),
      ),
    );
  }
  for (let index = 0; index < statements.length; index += 100)
    await c.env.DB.batch(statements.slice(index, index + 100));
  const updated = addresses.filter((address) =>
    existingAddresses.has(address),
  ).length;
  const created = addresses.length - updated;
  return c.json(
    {
      data: {
        received: body.subscribers.length,
        processed: addresses.length,
        created,
        updated,
      },
    },
    202,
  );
});

app.get("/internal/v1/lists", async (c) => {
  const rows = await c.env.DB.prepare(
    `
    SELECT list.*, (SELECT COUNT(*) FROM subscriber_list_memberships membership WHERE membership.list_id = list.id) subscriber_count
    FROM subscriber_lists list WHERE project_id = ? ORDER BY name
  `,
  )
    .bind(c.get("project").projectId)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/lists", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `
    INSERT INTO subscriber_lists (id, project_id, name, description, visibility, optin_mode)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      id,
      projectId,
      text(body.name, "name"),
      optionalText(body.description, "description", 2000),
      enumValue(
        body.visibility,
        "visibility",
        ["private", "public"],
        "private",
      ),
      enumValue(body.optin_mode, "optin_mode", ["single", "double"], "single"),
    )
    .run();
  return c.json({ data: await list(c.env.DB, projectId, id) }, 201);
});

app.patch("/internal/v1/lists/:listId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await list(c.env.DB, projectId, c.req.param("listId"));
  const body = await readJsonObject(c.req.raw);
  await c.env.DB.prepare(
    `
    UPDATE subscriber_lists SET name = ?, description = ?, visibility = ?, optin_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND id = ?
  `,
  )
    .bind(
      body.name === undefined ? current.name : text(body.name, "name"),
      body.description === undefined
        ? current.description
        : optionalText(body.description, "description", 2000),
      body.visibility === undefined
        ? current.visibility
        : enumValue(body.visibility, "visibility", ["private", "public"]),
      body.optin_mode === undefined
        ? current.optin_mode
        : enumValue(body.optin_mode, "optin_mode", ["single", "double"]),
      projectId,
      current.id,
    )
    .run();
  return c.json({ data: await list(c.env.DB, projectId, String(current.id)) });
});

app.delete("/internal/v1/lists/:listId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM subscriber_lists WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(c.get("project").projectId, c.req.param("listId"))
    .first();
  if (!result) throw failure("list_not_found", "List not found", 404);
  return c.json({ data: { deleted: true } });
});

app.put("/internal/v1/lists/:listId/subscribers/:subscriberId", async (c) => {
  const projectId = c.get("project").projectId;
  await Promise.all([
    list(c.env.DB, projectId, c.req.param("listId")),
    subscriber(c.env.DB, projectId, c.req.param("subscriberId")),
  ]);
  await c.env.DB.prepare(
    `
    INSERT INTO subscriber_list_memberships (project_id, subscriber_id, list_id, source)
    VALUES (?, ?, ?, 'admin') ON CONFLICT(project_id, subscriber_id, list_id) DO NOTHING
  `,
  )
    .bind(projectId, c.req.param("subscriberId"), c.req.param("listId"))
    .run();
  return c.json({ data: { subscribed: true } });
});

app.delete(
  "/internal/v1/lists/:listId/subscribers/:subscriberId",
  async (c) => {
    await c.env.DB.prepare(
      "DELETE FROM subscriber_list_memberships WHERE project_id = ? AND list_id = ? AND subscriber_id = ?",
    )
      .bind(
        c.get("project").projectId,
        c.req.param("listId"),
        c.req.param("subscriberId"),
      )
      .run();
    return c.json({ data: { subscribed: false } });
  },
);

app.get("/internal/v1/segments", async (c) => {
  const rows = await c.env.DB.prepare(
    `
    SELECT segment.*, (SELECT COUNT(*) FROM segment_memberships membership WHERE membership.segment_id = segment.id) subscriber_count
    FROM subscriber_segments segment WHERE project_id = ? ORDER BY name
  `,
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((row) => ({
      ...row,
      rules: parseStoredJson(row.rules_json, {}),
    })),
  });
});

app.post("/internal/v1/segments", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const rules = validateSegmentRules(body.rules);
  await c.env.DB.prepare(
    "INSERT INTO subscriber_segments (id, project_id, name, rules_json) VALUES (?, ?, ?, ?)",
  )
    .bind(id, projectId, text(body.name, "name"), JSON.stringify(rules))
    .run();
  await refreshSegment(c.env.DB, projectId, id, rules);
  return c.json({ data: { id, name: body.name, rules } }, 201);
});

app.patch("/internal/v1/segments/:segmentId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await segment(c.env.DB, projectId, c.req.param("segmentId"));
  const body = await readJsonObject(c.req.raw);
  const rules =
    body.rules === undefined
      ? parseStoredJson<SegmentRules>(current.rules_json, {
          mode: "all",
          conditions: [],
        })
      : validateSegmentRules(body.rules);
  await c.env.DB.prepare(
    `UPDATE subscriber_segments SET name = ?, rules_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
  )
    .bind(
      body.name === undefined ? current.name : text(body.name, "name"),
      JSON.stringify(rules),
      projectId,
      current.id,
    )
    .run();
  await refreshSegment(c.env.DB, projectId, String(current.id), rules);
  return c.json({
    data: {
      ...(await segment(c.env.DB, projectId, String(current.id))),
      rules,
    },
  });
});

app.post("/internal/v1/segments/:segmentId/refresh", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await segment(c.env.DB, projectId, c.req.param("segmentId"));
  const count = await refreshSegment(
    c.env.DB,
    projectId,
    String(current.id),
    parseStoredJson<SegmentRules>(current.rules_json, {
      mode: "all",
      conditions: [],
    }),
  );
  return c.json({ data: { subscriber_count: count } });
});

app.delete("/internal/v1/segments/:segmentId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM subscriber_segments WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(c.get("project").projectId, c.req.param("segmentId"))
    .first();
  if (!result) throw failure("segment_not_found", "Segment not found", 404);
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/templates", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM email_templates WHERE project_id = ? ORDER BY updated_at DESC",
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeTemplate) });
});

app.post("/internal/v1/templates", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `
    INSERT INTO email_templates (id, project_id, name, template_type, subject, content_html, content_markdown, content_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      id,
      projectId,
      text(body.name, "name"),
      enumValue(
        body.template_type,
        "template_type",
        ["campaign", "transactional", "system"],
        "campaign",
      ),
      optionalText(body.subject, "subject", 500),
      optionalText(body.content_html, "content_html", 500_000),
      optionalText(body.content_markdown, "content_markdown", 500_000),
      optionalText(body.content_text, "content_text", 500_000),
    )
    .run();
  return c.json(
    { data: serializeTemplate(await template(c.env.DB, projectId, id)) },
    201,
  );
});

app.patch("/internal/v1/templates/:templateId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await template(
    c.env.DB,
    projectId,
    c.req.param("templateId"),
  );
  const body = await readJsonObject(c.req.raw);
  await c.env.DB.prepare(
    `
    UPDATE email_templates SET name = ?, template_type = ?, subject = ?, content_html = ?, content_markdown = ?, content_text = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?
  `,
  )
    .bind(
      body.name === undefined ? current.name : text(body.name, "name"),
      body.template_type === undefined
        ? current.template_type
        : enumValue(body.template_type, "template_type", [
            "campaign",
            "transactional",
            "system",
          ]),
      body.subject === undefined
        ? current.subject
        : optionalText(body.subject, "subject", 500),
      body.content_html === undefined
        ? current.content_html
        : optionalText(body.content_html, "content_html", 500_000),
      body.content_markdown === undefined
        ? current.content_markdown
        : optionalText(body.content_markdown, "content_markdown", 500_000),
      body.content_text === undefined
        ? current.content_text
        : optionalText(body.content_text, "content_text", 500_000),
      projectId,
      current.id,
    )
    .run();
  return c.json({
    data: serializeTemplate(
      await template(c.env.DB, projectId, String(current.id)),
    ),
  });
});

app.delete("/internal/v1/templates/:templateId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM email_templates WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(c.get("project").projectId, c.req.param("templateId"))
    .first();
  if (!result) throw failure("template_not_found", "Template not found", 404);
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/media", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, content_type, byte_size, created_at FROM marketing_media WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`,
  )
    .bind(c.get("project").projectId)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/media", async (c) => {
  const project = c.get("project");
  const bytes = await readBytesLimited(c.req.raw, 10 * 1024 * 1024);
  if (!bytes.length) throw failure("media_empty", "Media file cannot be empty");
  const filename = safeFilename(c.req.header("x-filename") || "media");
  const contentType = String(
    c.req.header("content-type") || "application/octet-stream",
  ).slice(0, 128);
  if (
    !/^(image|video|audio)\//.test(contentType) &&
    contentType !== "application/pdf"
  )
    throw failure("media_type_invalid", "Unsupported media content type");
  const id = crypto.randomUUID();
  const objectKey = `marketing/${project.projectId}/${id}/${filename}`;
  await c.env.MEDIA.put(objectKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { projectId: String(project.projectId), mediaId: id },
  });
  try {
    await c.env.DB.prepare(
      `INSERT INTO marketing_media (id, project_id, object_key, filename, content_type, byte_size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        project.projectId,
        objectKey,
        filename,
        contentType,
        bytes.length,
        String(project.actorId),
      )
      .run();
  } catch (error) {
    await c.env.MEDIA.delete(objectKey);
    throw error;
  }
  return c.json(
    {
      data: {
        id,
        filename,
        content_type: contentType,
        byte_size: bytes.length,
      },
    },
    201,
  );
});

app.get("/internal/v1/media/:mediaId", async (c) => {
  const row = await media(
    c.env.DB,
    c.get("project").projectId,
    c.req.param("mediaId"),
  );
  const object = await c.env.MEDIA.get(String(row.object_key));
  if (!object) throw failure("media_not_found", "Media file not found", 404);
  const headers = new Headers({
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  });
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});

app.delete("/internal/v1/media/:mediaId", async (c) => {
  const projectId = c.get("project").projectId;
  const row = await media(c.env.DB, projectId, c.req.param("mediaId"));
  await c.env.MEDIA.delete(String(row.object_key));
  await c.env.DB.prepare(
    "DELETE FROM marketing_media WHERE project_id = ? AND id = ?",
  )
    .bind(projectId, row.id)
    .run();
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/campaigns", async (c) => {
  const rows = await c.env.DB.prepare(
    `
    SELECT campaign.*,
      (SELECT COUNT(*) FROM email_deliveries delivery WHERE delivery.campaign_id = campaign.id) recipient_count,
      (SELECT COUNT(*) FROM email_deliveries delivery WHERE delivery.campaign_id = campaign.id AND delivery.status IN ('sent','delivered')) delivered_count
    FROM campaigns campaign WHERE project_id = ? ORDER BY updated_at DESC
  `,
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  return c.json({ data: rows.results.map(serializeCampaign) });
});

app.get("/internal/v1/campaigns/:campaignId", async (c) => {
  return c.json({
    data: serializeCampaign(
      await campaign(
        c.env.DB,
        c.get("project").projectId,
        c.req.param("campaignId"),
      ),
    ),
  });
});

app.post("/internal/v1/campaigns", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `
    INSERT INTO campaigns
      (id, project_id, name, subject, status, template_id, content_html, content_text, list_ids_json,
       segment_ids_json, smtp_profile_id, tracking_enabled, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `,
  )
    .bind(
      id,
      projectId,
      text(body.name, "name"),
      text(body.subject, "subject", 500),
      optionalText(body.template_id, "template_id"),
      optionalText(body.content_html, "content_html", 500_000),
      optionalText(body.content_text, "content_text", 500_000),
      JSON.stringify(stringArray(body.list_ids, "list_ids")),
      JSON.stringify(stringArray(body.segment_ids, "segment_ids")),
      optionalText(body.smtp_profile_id, "smtp_profile_id"),
      booleanValue(body.tracking_enabled, true) ? 1 : 0,
    )
    .run();
  return c.json(
    { data: serializeCampaign(await campaign(c.env.DB, projectId, id)) },
    201,
  );
});

app.patch("/internal/v1/campaigns/:campaignId", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await campaign(
    c.env.DB,
    projectId,
    c.req.param("campaignId"),
  );
  if (!["draft", "scheduled", "paused"].includes(String(current.status)))
    throw failure(
      "campaign_locked",
      "Only draft, scheduled or paused campaigns can be edited",
      409,
    );
  const body = await readJsonObject(c.req.raw);
  await c.env.DB.prepare(
    `
    UPDATE campaigns SET name = ?, subject = ?, template_id = ?, content_html = ?, content_text = ?, list_ids_json = ?,
      segment_ids_json = ?, smtp_profile_id = ?, tracking_enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND id = ?
  `,
  )
    .bind(
      body.name === undefined ? current.name : text(body.name, "name"),
      body.subject === undefined
        ? current.subject
        : text(body.subject, "subject", 500),
      body.template_id === undefined
        ? current.template_id
        : optionalText(body.template_id, "template_id"),
      body.content_html === undefined
        ? current.content_html
        : optionalText(body.content_html, "content_html", 500_000),
      body.content_text === undefined
        ? current.content_text
        : optionalText(body.content_text, "content_text", 500_000),
      body.list_ids === undefined
        ? current.list_ids_json
        : JSON.stringify(stringArray(body.list_ids, "list_ids")),
      body.segment_ids === undefined
        ? current.segment_ids_json
        : JSON.stringify(stringArray(body.segment_ids, "segment_ids")),
      body.smtp_profile_id === undefined
        ? current.smtp_profile_id
        : optionalText(body.smtp_profile_id, "smtp_profile_id"),
      body.tracking_enabled === undefined
        ? current.tracking_enabled
        : booleanValue(body.tracking_enabled)
          ? 1
          : 0,
      projectId,
      current.id,
    )
    .run();
  return c.json({
    data: serializeCampaign(
      await campaign(c.env.DB, projectId, String(current.id)),
    ),
  });
});

app.post("/internal/v1/campaigns/:campaignId/schedule", async (c) => {
  const body = await readJsonObject(c.req.raw);
  const scheduledAt = isoTimestamp(body.scheduled_at, "scheduled_at", false)!;
  if (new Date(scheduledAt).getTime() <= Date.now())
    throw failure("scheduled_at_invalid", "scheduled_at must be in the future");
  return transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["draft", "paused"],
    "scheduled",
    { scheduled_at: scheduledAt },
  );
});

app.post("/internal/v1/campaigns/:campaignId/start", async (c) => {
  const response = await transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["draft", "scheduled", "paused"],
    "running",
  );
  await c.env.MARKETING_QUEUE.send({
    type: "marketing.campaign.dispatch",
    projectId: c.get("project").projectId,
    campaignId: c.req.param("campaignId"),
  });
  return response;
});

app.post("/internal/v1/campaigns/:campaignId/pause", (c) =>
  transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["running", "scheduled"],
    "paused",
  ),
);
app.post("/internal/v1/campaigns/:campaignId/resume", async (c) => {
  const response = await transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["paused"],
    "running",
  );
  await c.env.MARKETING_QUEUE.send({
    type: "marketing.campaign.dispatch",
    projectId: c.get("project").projectId,
    campaignId: c.req.param("campaignId"),
  });
  return response;
});
app.post("/internal/v1/campaigns/:campaignId/cancel", (c) =>
  transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["draft", "scheduled", "running", "paused"],
    "cancelled",
  ),
);
app.post("/internal/v1/campaigns/:campaignId/archive", (c) =>
  transitionCampaign(
    c.env,
    c.get("project"),
    c.req.param("campaignId"),
    ["finished", "cancelled"],
    "archived",
  ),
);

app.post("/internal/v1/campaigns/:campaignId/test", async (c) => {
  const projectId = c.get("project").projectId;
  const current = await campaign(
    c.env.DB,
    projectId,
    c.req.param("campaignId"),
  );
  const body = await readJsonObject(c.req.raw);
  const profile = await smtpProfileForTest(
    c.env.DB,
    projectId,
    optionalText(body.smtp_profile_id, "smtp_profile_id") ||
      String(current.smtp_profile_id || ""),
  );
  const publicConfig = parseStoredJson<SmtpPublicConfig>(
    profile.public_config_json,
    {} as SmtpPublicConfig,
  );
  const secret: SmtpSecretConfig =
    c.env.EMAIL_PROVIDER === "aws-ses"
      ? { password: null }
      : await decryptJson<SmtpSecretConfig>(
          c.env.SMTP_ENCRYPTION_KEY,
          String(profile.encrypted_config),
        );
  const result = await sendSmtpMessage(c.env, {
    idempotencyKey: `marketing.campaign-test:${projectId}:${c.get("project").requestId}:${profile.id}`,
    projectId,
    referenceId: String(current.id),
    profileId: String(profile.id),
    publicConfig,
    secret,
    message: {
      to: email(body.recipient, "recipient"),
      subject: `[Test] ${current.subject}`,
      html: current.content_html ? String(current.content_html) : null,
      text: current.content_text ? String(current.content_text) : null,
    },
  });
  return c.json({ data: { ok: true, message_id: result.messageId } });
});

app.post("/internal/v1/transactional", async (c) => {
  const project = c.get("project");
  const body = await readJsonObject(c.req.raw);
  const recipient = email(body.recipient, "recipient");
  const templateRow = await template(
    c.env.DB,
    project.projectId,
    text(body.template_id, "template_id"),
  );
  let subscriberRow = await c.env.DB.prepare(
    "SELECT * FROM subscribers WHERE project_id = ? AND email = ?",
  )
    .bind(project.projectId, recipient)
    .first<Record<string, unknown>>();
  if (!subscriberRow) {
    const subscriberId = crypto.randomUUID();
    await c.env.DB.prepare(
      `
      INSERT INTO subscribers (id, project_id, email, name, status, attributes_json, consent_status, consent_source, consented_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'enabled', ?, 'confirmed', 'transactional', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `,
    )
      .bind(
        subscriberId,
        project.projectId,
        recipient,
        optionalText(body.name, "name"),
        JSON.stringify(jsonObject(body.attributes, "attributes")),
      )
      .run();
    subscriberRow = await subscriber(c.env.DB, project.projectId, subscriberId);
  }
  const suppressed = await c.env.DB.prepare(
    "SELECT reason FROM suppressions WHERE project_id = ? AND email = ?",
  )
    .bind(project.projectId, recipient)
    .first();
  if (suppressed)
    throw failure("recipient_suppressed", "Recipient is suppressed", 409);
  const campaignId = crypto.randomUUID();
  const deliveryId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `
      INSERT INTO campaigns (id, project_id, name, subject, status, template_id, content_html, content_text,
        list_ids_json, segment_ids_json, smtp_profile_id, tracking_enabled, started_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?, '[]', '[]', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `,
    ).bind(
      campaignId,
      project.projectId,
      `Transactional ${templateRow.name}`,
      text(body.subject || templateRow.subject, "subject", 500),
      templateRow.id,
      templateRow.content_html,
      templateRow.content_text,
      optionalText(body.smtp_profile_id, "smtp_profile_id"),
      booleanValue(body.tracking_enabled, false) ? 1 : 0,
    ),
    c.env.DB.prepare(
      `
      INSERT INTO email_deliveries (id, project_id, campaign_id, subscriber_id, recipient_email, recipient_name, status)
      VALUES (?, ?, ?, ?, ?, ?, 'sending')
    `,
    ).bind(
      deliveryId,
      project.projectId,
      campaignId,
      subscriberRow.id,
      recipient,
      subscriberRow.name,
    ),
  ]);
  await c.env.MARKETING_QUEUE.send({
    type: "marketing.email.deliver",
    projectId: project.projectId,
    deliveryId,
  });
  return c.json(
    {
      data: {
        campaign_id: campaignId,
        delivery_id: deliveryId,
        status: "queued",
      },
    },
    202,
  );
});

app.get("/internal/v1/settings/smtp", async (c) => {
  const rows = await c.env.DB.prepare(
    `
    SELECT id, name, public_config_json, priority, enabled, hourly_quota, daily_quota,
      dkim_selector, authentication_status, spf_status, dkim_status, dmarc_status, authentication_checked_at,
      last_tested_at, last_test_status, created_at, updated_at
    FROM smtp_profiles WHERE project_id = ? ORDER BY priority, created_at
  `,
  )
    .bind(c.get("project").projectId)
    .all<Record<string, unknown>>();
  const profiles = rows.results.map(serializeSmtpProfile);
  return c.json({
    data:
      profiles.length === 1
        ? {
            ...profiles[0],
            provider: c.env.EMAIL_PROVIDER,
            aws_region:
              c.env.EMAIL_PROVIDER === "aws-ses" ? c.env.AWS_REGION : null,
          }
        : {
            profiles,
            configured: profiles.length > 0,
            provider: c.env.EMAIL_PROVIDER,
            aws_region:
              c.env.EMAIL_PROVIDER === "aws-ses" ? c.env.AWS_REGION : null,
          },
  });
});

app.put("/internal/v1/settings/smtp", async (c) => saveSmtpProfile(c));
app.post("/internal/v1/settings/smtp", async (c) => saveSmtpProfile(c));

app.delete("/internal/v1/settings/smtp/:profileId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM smtp_profiles WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(c.get("project").projectId, c.req.param("profileId"))
    .first();
  if (!result)
    throw failure("smtp_profile_not_found", "SMTP profile not found", 404);
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/settings/provider-webhooks", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, enabled, created_at, updated_at FROM provider_webhook_endpoints WHERE project_id = ? ORDER BY created_at`,
  )
    .bind(c.get("project").projectId)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/settings/provider-webhooks", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const id = crypto.randomUUID();
  const sharedSecret = text(body.secret, "secret", 8_000);
  await c.env.DB.prepare(
    `INSERT INTO provider_webhook_endpoints (id, project_id, provider, encrypted_secret, enabled) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      projectId,
      identifier(body.provider, "provider"),
      await encryptJson(c.env.SMTP_ENCRYPTION_KEY, { secret: sharedSecret }),
      booleanValue(body.enabled, true) ? 1 : 0,
    )
    .run();
  return c.json(
    {
      data: {
        id,
        provider: body.provider,
        enabled: booleanValue(body.enabled, true),
        configured: true,
      },
    },
    201,
  );
});

app.delete("/internal/v1/settings/provider-webhooks/:endpointId", async (c) => {
  const result = await c.env.DB.prepare(
    "DELETE FROM provider_webhook_endpoints WHERE project_id = ? AND id = ? RETURNING id",
  )
    .bind(c.get("project").projectId, c.req.param("endpointId"))
    .first();
  if (!result)
    throw failure(
      "provider_webhook_not_found",
      "Provider webhook endpoint not found",
      404,
    );
  return c.json({ data: { deleted: true } });
});

app.get("/internal/v1/settings/dead-letters", async (c) => {
  const projectId = c.get("project").projectId;
  const rows = await c.env.DB.prepare(
    `
    SELECT id, source_queue, message_id, job_type, replayable, attempts, status,
           resolution, received_at, resolved_at,
           COALESCE(
             json_extract(payload_json, '$.deliveryId'),
             json_extract(payload_json, '$.campaignId'),
             json_extract(payload_json, '$.outboxId')
           ) AS resource_id
    FROM marketing_dead_letters
    WHERE project_id = ?
    ORDER BY received_at DESC, id DESC
    LIMIT 100
  `,
  )
    .bind(projectId)
    .all<Record<string, unknown>>();
  return c.json({
    data: rows.results.map((row) => ({
      id: String(row.id),
      source_queue: String(row.source_queue),
      queue_message_id: String(row.message_id),
      job_type: row.job_type == null ? null : String(row.job_type),
      resource_id: row.resource_id == null ? null : String(row.resource_id),
      replayable: Number(row.replayable) === 1,
      attempts: Number(row.attempts || 0),
      status: String(row.status),
      resolution: row.resolution == null ? null : String(row.resolution),
      received_at: String(row.received_at),
      resolved_at: row.resolved_at == null ? null : String(row.resolved_at),
    })),
  });
});

app.post(
  "/internal/v1/settings/dead-letters/:deadLetterId/replay",
  async (c) => {
    const projectId = c.get("project").projectId;
    const id = c.req.param("deadLetterId");
    const row = await c.env.DB.prepare(
      `
    SELECT id, payload_json, replayable, status
    FROM marketing_dead_letters WHERE id = ? AND project_id = ?
  `,
    )
      .bind(id, projectId)
      .first<{
        id: string;
        payload_json: string;
        replayable: number;
        status: string;
      }>();
    if (!row)
      throw failure("dead_letter_not_found", "Dead letter not found", 404);
    if (row.status !== "quarantined")
      throw failure(
        "dead_letter_already_resolved",
        "Dead letter is already resolved",
        409,
      );
    if (Number(row.replayable) !== 1)
      throw failure(
        "dead_letter_not_replayable",
        "Dead letter contains a redacted or invalid payload",
        409,
      );
    const job = parseMarketingDeadLetterJob(row.payload_json, projectId);
    if (!job)
      throw failure(
        "dead_letter_payload_invalid",
        "Dead letter payload is invalid",
        409,
      );
    const now = new Date().toISOString();
    const claimed = await c.env.DB.prepare(
      `
    UPDATE marketing_dead_letters
    SET status = 'discarded', resolution = 'replayed', resolved_at = ?
    WHERE id = ? AND project_id = ? AND status = 'quarantined'
    RETURNING id
  `,
    )
      .bind(now, id, projectId)
      .first<{ id: string }>();
    if (!claimed)
      throw failure(
        "dead_letter_already_resolved",
        "Dead letter is already resolved",
        409,
      );
    try {
      await c.env.MARKETING_QUEUE.send(job);
    } catch (error) {
      await c.env.DB.prepare(
        `
      UPDATE marketing_dead_letters
      SET status = 'quarantined', resolution = NULL, resolved_at = NULL
      WHERE id = ? AND project_id = ? AND resolution = 'replayed'
    `,
      )
        .bind(id, projectId)
        .run();
      console.error(
        JSON.stringify({
          event: "marketing_dead_letter_replay_failed",
          dead_letter_id: id,
          project_id: projectId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      throw failure(
        "dead_letter_replay_failed",
        "Dead letter could not be queued",
        503,
      );
    }
    return c.json(
      { data: { id, status: "replayed", job_type: job.type } },
      202,
    );
  },
);

app.post(
  "/internal/v1/settings/dead-letters/:deadLetterId/discard",
  async (c) => {
    const projectId = c.get("project").projectId;
    const id = c.req.param("deadLetterId");
    const resolved = await c.env.DB.prepare(
      `
    UPDATE marketing_dead_letters
    SET status = 'discarded', resolution = 'discarded', resolved_at = ?
    WHERE id = ? AND project_id = ? AND status = 'quarantined'
    RETURNING id
  `,
    )
      .bind(new Date().toISOString(), id, projectId)
      .first<{ id: string }>();
    if (!resolved)
      throw failure(
        "dead_letter_not_found_or_resolved",
        "Dead letter was not found or is already resolved",
        404,
      );
    return c.json({ data: { id, status: "discarded" } });
  },
);

app.post("/internal/v1/settings/smtp/test", async (c) => {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const profile = await smtpProfileForTest(
    c.env.DB,
    projectId,
    optionalText(body.profile_id, "profile_id") || "",
  );
  const publicConfig = parseStoredJson<SmtpPublicConfig>(
    profile.public_config_json,
    {} as SmtpPublicConfig,
  );
  const secret: SmtpSecretConfig =
    c.env.EMAIL_PROVIDER === "aws-ses"
      ? { password: null }
      : await decryptJson<SmtpSecretConfig>(
          c.env.SMTP_ENCRYPTION_KEY,
          String(profile.encrypted_config),
        );
  try {
    const result = await sendSmtpMessage(c.env, {
      idempotencyKey: `marketing.smtp-test:${projectId}:${c.get("project").requestId}:${profile.id}`,
      projectId,
      referenceId: String(profile.id),
      profileId: String(profile.id),
      publicConfig,
      secret,
      message: {
        to: email(body.recipient || publicConfig.from_email, "recipient"),
        subject: "SuperBoard SMTP connection test",
        html: null,
        text: "Your SuperBoard SMTP profile is working.",
      },
    });
    await c.env.DB.prepare(
      `UPDATE smtp_profiles SET last_tested_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_test_status = 'success' WHERE id = ? AND project_id = ?`,
    )
      .bind(profile.id, projectId)
      .run();
    return c.json({
      data: {
        ok: true,
        message: "SMTP test message accepted",
        message_id: result.messageId,
      },
    });
  } catch (error) {
    await c.env.DB.prepare(
      `UPDATE smtp_profiles SET last_tested_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_test_status = 'failed' WHERE id = ? AND project_id = ?`,
    )
      .bind(profile.id, projectId)
      .run();
    throw error;
  }
});

app.post("/internal/v1/settings/smtp/:profileId/verify-domain", async (c) => {
  const projectId = c.get("project").projectId;
  const profile = await c.env.DB.prepare(
    `
    SELECT id, public_config_json, dkim_selector FROM smtp_profiles WHERE id = ? AND project_id = ?
  `,
  )
    .bind(c.req.param("profileId"), projectId)
    .first<Record<string, unknown>>();
  if (!profile)
    throw failure("smtp_profile_not_found", "SMTP profile not found", 404);
  const publicConfig = parseStoredJson<SmtpPublicConfig>(
    profile.public_config_json,
    {} as SmtpPublicConfig,
  );
  let authentication: Awaited<ReturnType<typeof verifyEmailAuthentication>>;
  try {
    authentication = await verifyEmailAuthentication(
      publicConfig.from_email,
      optionalText(profile.dkim_selector, "dkim_selector", 63),
    );
  } catch (error) {
    await c.env.DB.prepare(
      `
      UPDATE smtp_profiles SET authentication_status = 'failed', authentication_checked_at = ?, updated_at = ?
      WHERE id = ? AND project_id = ?
    `,
    )
      .bind(
        new Date().toISOString(),
        new Date().toISOString(),
        profile.id,
        projectId,
      )
      .run();
    throw failure(
      "sender_authentication_check_failed",
      "Sender DNS authentication could not be checked",
      503,
      {
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
  await c.env.DB.prepare(
    `
    UPDATE smtp_profiles SET authentication_status = ?, spf_status = ?, dkim_status = ?, dmarc_status = ?,
      authentication_checked_at = ?, updated_at = ? WHERE id = ? AND project_id = ?
  `,
  )
    .bind(
      authentication.ready ? "verified" : "failed",
      authentication.spf,
      authentication.dkim,
      authentication.dmarc,
      authentication.checkedAt,
      authentication.checkedAt,
      profile.id,
      projectId,
    )
    .run();
  return c.json({ data: authentication });
});

app.post("/internal/v1/provider-events", async (c) => {
  const project = c.get("project");
  const body = await readJsonObject(c.req.raw);
  return processProviderEvent(c.env, project.projectId, body, "internal");
});

app.post("/public/v1/provider-webhooks/:endpointId", async (c) => {
  const endpoint = await c.env.DB.prepare(
    `SELECT * FROM provider_webhook_endpoints WHERE id = ? AND enabled = 1`,
  )
    .bind(c.req.param("endpointId"))
    .first<Record<string, unknown>>();
  if (!endpoint)
    throw failure(
      "provider_webhook_not_found",
      "Provider webhook endpoint not found",
      404,
    );
  const configured = await decryptJson<{ secret: string }>(
    c.env.SMTP_ENCRYPTION_KEY,
    String(endpoint.encrypted_secret),
  );
  if (
    !(await sharedSecretsEqual(
      String(c.req.header("x-webhook-secret") || ""),
      configured.secret,
    ))
  ) {
    throw failure(
      "provider_webhook_signature_invalid",
      "Provider webhook authentication failed",
      401,
    );
  }
  const body = await readJsonObject(c.req.raw);
  return processProviderEvent(
    c.env,
    Number(endpoint.project_id),
    body,
    `endpoint:${String(endpoint.id)}`,
  );
});

async function processProviderEvent(
  env: Env,
  projectId: number,
  body: Record<string, unknown>,
  source: string,
) {
  const eventType = enumValue(body.event_type, "event_type", [
    "delivered",
    "soft_bounce",
    "hard_bounce",
    "complaint",
    "delivery_delayed",
    "rejected",
  ]);
  const metadata = jsonObject(body.metadata, "metadata");
  const providerEventId =
    optionalText(
      body.provider_event_id ?? metadata.provider_event_id,
      "provider_event_id",
      255,
    ) || (await sha256(JSON.stringify(body)));
  const claim = await env.DB.prepare(
    `
    INSERT INTO provider_event_receipts (project_id, source, provider_event_id, event_type, status)
    VALUES (?, ?, ?, ?, 'processing') ON CONFLICT(project_id, source, provider_event_id) DO NOTHING
    RETURNING provider_event_id
  `,
  )
    .bind(projectId, source, providerEventId, eventType)
    .first();
  if (!claim)
    return Response.json(
      { data: { accepted: true, duplicate: true } },
      { status: 202 },
    );
  try {
    const delivery = await deliveryFromProvider(
      env.DB,
      projectId,
      optionalText(body.delivery_id, "delivery_id"),
      optionalText(body.provider_message_id, "provider_message_id"),
    );
    const now = new Date().toISOString();
    const status =
      eventType === "delivered"
        ? "delivered"
        : eventType === "complaint"
          ? "complained"
          : eventType === "soft_bounce" || eventType === "hard_bounce"
            ? "bounced"
            : eventType === "rejected"
              ? "failed"
              : String(delivery.status);
    const statements = [
      env.DB.prepare(
        `UPDATE email_deliveries SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
      ).bind(status, now, delivery.id, projectId),
      env.DB.prepare(
        `INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        projectId,
        delivery.campaign_id,
        delivery.subscriber_id,
        delivery.id,
        eventType,
        JSON.stringify(metadata),
        now,
      ),
    ];
    if (eventType === "hard_bounce" || eventType === "complaint") {
      const reason = eventType === "complaint" ? "complaint" : "hard_bounce";
      statements.push(
        env.DB.prepare(
          `INSERT INTO suppressions (id, project_id, email, reason, source, metadata_json) VALUES (?, ?, ?, ?, 'provider', ?) ON CONFLICT(project_id, email) DO UPDATE SET reason = excluded.reason, source = excluded.source, metadata_json = excluded.metadata_json`,
        ).bind(
          crypto.randomUUID(),
          projectId,
          delivery.recipient_email,
          reason,
          JSON.stringify(metadata),
        ),
        env.DB.prepare(
          `UPDATE subscribers SET status = 'blocklisted', updated_at = ? WHERE id = ? AND project_id = ?`,
        ).bind(now, delivery.subscriber_id, projectId),
      );
    }
    statements.push(
      env.DB.prepare(
        `
    UPDATE provider_event_receipts SET status = 'completed', delivery_id = ?, completed_at = ?
    WHERE project_id = ? AND source = ? AND provider_event_id = ?
  `,
      ).bind(delivery.id, now, projectId, source, providerEventId),
    );
    await env.DB.batch(statements);
    return Response.json({ data: { accepted: true } }, { status: 202 });
  } catch (error) {
    await env.DB.prepare(
      `
      DELETE FROM provider_event_receipts WHERE project_id = ? AND source = ? AND provider_event_id = ? AND status = 'processing'
    `,
    )
      .bind(projectId, source, providerEventId)
      .run();
    throw error;
  }
}

app.get("/internal/v1/statistics", async (c) => {
  const projectId = c.get("project").projectId;
  const from = isoTimestamp(
    c.req.query("from") || "1970-01-01T00:00:00.000Z",
    "from",
    false,
  )!;
  const to = isoTimestamp(
    c.req.query("to") || new Date().toISOString(),
    "to",
    false,
  )!;
  const interval = enumValue(
    c.req.query("interval"),
    "interval",
    ["hour", "day", "week", "month"],
    "day",
  );
  const campaignId = optionalText(c.req.query("campaign_id"), "campaign_id");
  const bucket =
    interval === "hour"
      ? "%Y-%m-%dT%H:00:00Z"
      : interval === "month"
        ? "%Y-%m-01"
        : interval === "week"
          ? "%Y-%W"
          : "%Y-%m-%d";
  const [subscribers, campaigns, events, series] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN status = 'enabled' AND consent_status = 'confirmed' THEN 1 ELSE 0 END) enabled FROM subscribers WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<Record<string, number>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) total, SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) running FROM campaigns WHERE project_id = ?`,
    )
      .bind(projectId)
      .first<Record<string, number>>(),
    c.env.DB.prepare(
      `SELECT event_type, COUNT(*) total FROM email_events WHERE project_id = ? AND occurred_at BETWEEN ? AND ? AND (? IS NULL OR campaign_id = ?) GROUP BY event_type`,
    )
      .bind(projectId, from, to, campaignId, campaignId)
      .all<{ event_type: string; total: number }>(),
    c.env.DB.prepare(
      `SELECT strftime(?, occurred_at) bucket, event_type, COUNT(*) total FROM email_events WHERE project_id = ? AND occurred_at BETWEEN ? AND ? AND (? IS NULL OR campaign_id = ?) GROUP BY bucket, event_type ORDER BY bucket`,
    )
      .bind(bucket, projectId, from, to, campaignId, campaignId)
      .all(),
  ]);
  const totals: Record<string, number> = {
    subscribers: Number(subscribers?.total || 0),
    enabled_subscribers: Number(subscribers?.enabled || 0),
    campaigns: Number(campaigns?.total || 0),
    running_campaigns: Number(campaigns?.running || 0),
  };
  for (const row of events.results) totals[row.event_type] = Number(row.total);
  totals.delivery_rate = percentage(
    totals.delivered || totals.sent || 0,
    totals.sent || 0,
  );
  totals.open_rate = percentage(
    totals.open || 0,
    totals.delivered || totals.sent || 0,
  );
  totals.click_rate = percentage(
    totals.click || 0,
    totals.delivered || totals.sent || 0,
  );
  return c.json({
    data: {
      totals,
      series: series.results,
      filters: {
        from,
        to,
        interval,
        campaign_id: campaignId,
        timezone: c.req.query("timezone") || "UTC",
        platform: c.req.query("platform") || null,
        placement_id: c.req.query("placement_id") || null,
        version_id: c.req.query("version_id") || null,
        experience_id: c.req.query("experience_id") || null,
        variant_id: c.req.query("variant_id") || null,
      },
    },
  });
});

app.get("/internal/v1/audit", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM audit_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`,
  )
    .bind(c.get("project").projectId)
    .all();
  return c.json({ data: rows.results });
});

app.get("/internal/v1/settings/delivery-outbox", async (c) => {
  const rows = await c.env.DB.prepare(
    `
    SELECT id, job_type, resource_id, status, attempt_count, last_error, created_at, dispatched_at, completed_at, updated_at
    FROM marketing_outbox WHERE project_id = ? ORDER BY created_at DESC LIMIT 500
  `,
  )
    .bind(c.get("project").projectId)
    .all();
  return c.json({ data: rows.results });
});

app.post("/internal/v1/settings/delivery-outbox/:outboxId/retry", async (c) => {
  const projectId = c.get("project").projectId;
  const row = await c.env.DB.prepare(
    `
    SELECT * FROM marketing_outbox WHERE id = ? AND project_id = ? AND status IN ('pending', 'dead_letter')
  `,
  )
    .bind(c.req.param("outboxId"), projectId)
    .first<Record<string, unknown>>();
  if (!row)
    throw failure(
      "outbox_not_retryable",
      "Delivery outbox item is not retryable",
      409,
    );
  const payload = await decryptJson<{ token: string }>(
    c.env.SMTP_ENCRYPTION_KEY,
    String(row.encrypted_payload),
  );
  const queued = await dispatchOptinOutbox(c.env, {
    type: "marketing.optin.deliver",
    projectId,
    subscriberId: String(row.resource_id),
    token: payload.token,
    outboxId: String(row.id),
  });
  return c.json({ data: { queued } }, queued ? 202 : 503);
});

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "route_not_found",
        message: "Marketing route not found",
        request_id:
          c.req.header("x-request-id") ||
          c.req.header("cf-ray") ||
          crypto.randomUUID(),
        retryable: false,
      },
    },
    404,
  ),
);

async function recordTrackingEvent(
  db: D1Database,
  payload: {
    projectId: number;
    campaignId: string;
    subscriberId: string;
    deliveryId: string;
  },
  eventType: "open" | "click" | "unsubscribe",
  metadata: Record<string, unknown> = {},
) {
  const suffix =
    eventType === "click"
      ? `:${await sha256(String(metadata.target || ""))}`
      : "";
  await db
    .prepare(
      `
    INSERT INTO email_events (id, project_id, campaign_id, subscriber_id, delivery_id, event_type, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING
  `,
    )
    .bind(
      `${eventType}:${payload.deliveryId}${suffix}`,
      payload.projectId,
      payload.campaignId,
      payload.subscriberId,
      payload.deliveryId,
      eventType,
      JSON.stringify(metadata),
    )
    .run();
}

app.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  const requestId = c.req.header("x-request-id") || crypto.randomUUID();
  if (status >= 500)
    console.error(
      JSON.stringify({
        event: "marketing_request_failed",
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return c.json(
    {
      error: {
        code: (error as { code?: string }).code || "internal_error",
        message:
          status >= 500
            ? "Marketing is temporarily unavailable"
            : error instanceof Error
              ? error.message
              : "Request failed",
        request_id: requestId,
        retryable: status >= 500,
        ...((error as { details?: Record<string, unknown> }).details
          ? {
              details: (error as { details?: Record<string, unknown> }).details,
            }
          : {}),
      },
    },
    status as 400,
  );
});

async function saveSmtpProfile(c: MarketingContext) {
  const projectId = c.get("project").projectId;
  const body = await readJsonObject(c.req.raw);
  const defaultProfile =
    body.id == null
      ? await c.env.DB.prepare(
          "SELECT id FROM smtp_profiles WHERE project_id = ? ORDER BY priority, created_at LIMIT 1",
        )
          .bind(projectId)
          .first<{ id: string }>()
      : null;
  const profileId =
    optionalText(body.id, "id") || defaultProfile?.id || crypto.randomUUID();
  const existing = await c.env.DB.prepare(
    "SELECT encrypted_config FROM smtp_profiles WHERE project_id = ? AND id = ?",
  )
    .bind(projectId, profileId)
    .first<{ encrypted_config: string }>();
  const managedAwsSes = c.env.EMAIL_PROVIDER === "aws-ses";
  const awsRegion = String(c.env.AWS_REGION || "")
    .trim()
    .toLowerCase();
  if (managedAwsSes && !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(awsRegion)) {
    throw failure(
      "aws_region_invalid",
      "AWS SES region is not configured",
      503,
    );
  }
  const publicConfig: SmtpPublicConfig = {
    host: managedAwsSes
      ? `email-smtp.${awsRegion}.amazonaws.com${awsRegion.startsWith("cn-") ? ".cn" : ""}`
      : text(body.host, "host", 253),
    port: managedAwsSes ? 587 : positiveInt(body.port, "port", 587),
    security: managedAwsSes
      ? "starttls"
      : enumValue(
          body.security,
          "security",
          ["tls", "starttls", "plain"],
          "starttls",
        ),
    username: managedAwsSes
      ? null
      : optionalText(body.username, "username", 320),
    from_email: email(body.from_email, "from_email"),
    from_name: optionalText(body.from_name, "from_name", 255),
    reply_to: body.reply_to ? email(body.reply_to, "reply_to") : null,
  };
  if (publicConfig.port > 65535)
    throw failure("port_invalid", "SMTP port must be between 1 and 65535");
  if (c.env.ENVIRONMENT === "production" && publicConfig.security === "plain") {
    throw failure(
      "smtp_security_invalid",
      "Plain SMTP is forbidden in production",
    );
  }
  const dkimSelector = optionalText(body.dkim_selector, "dkim_selector", 63);
  if (dkimSelector && !/^[a-z0-9][a-z0-9_-]*$/i.test(dkimSelector)) {
    throw failure(
      "dkim_selector_invalid",
      "DKIM selector contains invalid characters",
    );
  }
  const password = optionalText(body.password, "password", 8_000);
  if (!managedAwsSes && !password && !existing)
    throw failure("password_required", "SMTP password is required");
  const encrypted = managedAwsSes
    ? await encryptJson(c.env.SMTP_ENCRYPTION_KEY, { password: null })
    : password
      ? await encryptJson(c.env.SMTP_ENCRYPTION_KEY, { password })
      : existing!.encrypted_config;
  await c.env.DB.prepare(
    `
    INSERT INTO smtp_profiles (id, project_id, name, encrypted_config, public_config_json, priority, enabled,
      hourly_quota, daily_quota, dkim_selector, authentication_status, spf_status, dkim_status, dmarc_status,
      authentication_checked_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', NULL, NULL, NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, encrypted_config = excluded.encrypted_config,
      public_config_json = excluded.public_config_json, priority = excluded.priority, enabled = excluded.enabled,
      hourly_quota = excluded.hourly_quota, daily_quota = excluded.daily_quota, dkim_selector = excluded.dkim_selector,
      authentication_status = 'unverified', spf_status = NULL, dkim_status = NULL, dmarc_status = NULL,
      authentication_checked_at = NULL, updated_at = excluded.updated_at
  `,
  )
    .bind(
      profileId,
      projectId,
      text(body.name || "Default", "name"),
      encrypted,
      JSON.stringify(publicConfig),
      positiveInt(body.priority, "priority", 100),
      booleanValue(body.enabled, true) ? 1 : 0,
      body.hourly_quota == null
        ? null
        : positiveInt(body.hourly_quota, "hourly_quota"),
      body.daily_quota == null
        ? null
        : positiveInt(body.daily_quota, "daily_quota"),
      dkimSelector,
    )
    .run();
  const profile = await c.env.DB.prepare(
    `SELECT id, name, public_config_json, priority, enabled, hourly_quota, daily_quota,
      dkim_selector, authentication_status, spf_status, dkim_status, dmarc_status, authentication_checked_at,
      last_tested_at, last_test_status, created_at, updated_at FROM smtp_profiles WHERE project_id = ? AND id = ?`,
  )
    .bind(projectId, profileId)
    .first<Record<string, unknown>>();
  return c.json(
    { data: serializeSmtpProfile(profile || {}) },
    existing ? 200 : 201,
  );
}

async function suppressSubscriber(
  env: Env,
  project: ProjectContext,
  subscriberId: string,
  status: "blocklisted" | "unsubscribed",
  reason: string,
) {
  const current = await subscriber(env.DB, project.projectId, subscriberId);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE subscribers SET status = ?, unsubscribed_at = CASE WHEN ? = 'unsubscribed' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE unsubscribed_at END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
    ).bind(status, status, project.projectId, subscriberId),
    env.DB.prepare(
      `INSERT INTO suppressions (id, project_id, email, reason, source, metadata_json) VALUES (?, ?, ?, ?, 'admin', ?) ON CONFLICT(project_id, email) DO UPDATE SET reason = excluded.reason, source = excluded.source, metadata_json = excluded.metadata_json`,
    ).bind(
      crypto.randomUUID(),
      project.projectId,
      current.email,
      reason,
      JSON.stringify({ actor_id: project.actorId }),
    ),
  ]);
  return Response.json({
    data: serializeSubscriber(
      await subscriber(env.DB, project.projectId, subscriberId),
    ),
  });
}

function applicationIdentity(c: MarketingContext) {
  if (c.get("project").role.toLowerCase() !== "application") {
    throw failure(
      "application_role_required",
      "Application access is required for application preferences",
      403,
    );
  }
  const userId = String(
    c.req.header("x-superboard-application-user-id") ||
      c.req.header("x-opengrow-application-user-id") ||
      "",
  ).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(userId)) {
    throw failure(
      "application_identity_invalid",
      "Application identity is invalid",
      401,
    );
  }
  return {
    userId,
    email: email(
      c.req.header("x-superboard-application-email") ||
        c.req.header("x-opengrow-application-email"),
    ),
    name: optionalText(
      c.req.header("x-superboard-application-name") ||
        c.req.header("x-opengrow-application-name"),
      "name",
      120,
    ),
  };
}

async function applicationPreferences(
  db: D1Database,
  projectId: number,
  identity: { userId: string; email: string; name: string | null },
) {
  const subscriber = await db
    .prepare(
      `SELECT id, email, name, status, consent_status, consent_source,
        attributes_json, consented_at, unsubscribed_at, updated_at
       FROM subscribers
       WHERE project_id = ?
         AND (application_user_id = ? OR email = ?)
       ORDER BY CASE WHEN application_user_id = ? THEN 0 ELSE 1 END
       LIMIT 1`,
    )
    .bind(projectId, identity.userId, identity.email, identity.userId)
    .first<Record<string, unknown>>();
  const lists = await db
    .prepare(
      `SELECT list.id, list.name, list.description, list.optin_mode,
        CASE WHEN membership.list_id IS NULL THEN 0 ELSE 1 END selected
       FROM subscriber_lists list
       LEFT JOIN subscriber_list_memberships membership
         ON membership.project_id = list.project_id
        AND membership.list_id = list.id
        AND membership.subscriber_id = ?
       WHERE list.project_id = ? AND list.visibility = 'public'
       ORDER BY list.name, list.id`,
    )
    .bind(subscriber?.id || "", projectId)
    .all<Record<string, unknown>>();
  const consented =
    subscriber?.status === "enabled" &&
    subscriber?.consent_status === "confirmed";
  return {
    consented,
    email: identity.email,
    name: subscriber?.name ?? identity.name,
    status: subscriber?.status ?? "not_subscribed",
    consent_status: subscriber?.consent_status ?? "not_subscribed",
    consent_source: subscriber?.consent_source ?? null,
    attributes: parseStoredJson(subscriber?.attributes_json, {}),
    consented_at: subscriber?.consented_at ?? null,
    unsubscribed_at: subscriber?.unsubscribed_at ?? null,
    updated_at: subscriber?.updated_at ?? null,
    lists: lists.results.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      optin_mode: list.optin_mode,
      selected: Number(list.selected || 0) === 1,
    })),
  };
}

async function transitionCampaign(
  env: Env,
  project: ProjectContext,
  campaignId: string,
  from: string[],
  to: string,
  values: { scheduled_at?: string } = {},
) {
  const placeholders = from.map(() => "?").join(",");
  const updated = await env.DB.prepare(
    `
    UPDATE campaigns SET status = ?, scheduled_at = COALESCE(?, scheduled_at),
      paused_at = CASE WHEN ? = 'paused' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE paused_at END,
      cancelled_at = CASE WHEN ? = 'cancelled' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE cancelled_at END,
      archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND id = ? AND status IN (${placeholders}) RETURNING *
  `,
  )
    .bind(
      to,
      values.scheduled_at || null,
      to,
      to,
      to,
      project.projectId,
      campaignId,
      ...from,
    )
    .first<Record<string, unknown>>();
  if (!updated)
    throw failure(
      "campaign_transition_invalid",
      `Campaign cannot transition to ${to}`,
      409,
    );
  return Response.json({ data: serializeCampaign(updated) });
}

async function refreshSegment(
  db: D1Database,
  projectId: number,
  segmentId: string,
  rules: SegmentRules,
) {
  await db
    .prepare(
      "DELETE FROM segment_memberships WHERE project_id = ? AND segment_id = ?",
    )
    .bind(projectId, segmentId)
    .run();
  let cursor = "";
  let matched = 0;
  while (true) {
    const rows = await db
      .prepare(
        `
      SELECT id, email, name, status, consent_status, attributes_json
      FROM subscribers WHERE project_id = ? AND id > ? ORDER BY id LIMIT 500
    `,
      )
      .bind(projectId, cursor)
      .all<Record<string, unknown>>();
    if (!rows.results.length) break;
    const matching = rows.results.filter((row) => segmentMatches(row, rules));
    for (let index = 0; index < matching.length; index += 100) {
      await db.batch(
        matching.slice(index, index + 100).map((row) =>
          db
            .prepare(
              `
        INSERT INTO segment_memberships (project_id, segment_id, subscriber_id) VALUES (?, ?, ?)
      `,
            )
            .bind(projectId, segmentId, row.id),
        ),
      );
    }
    matched += matching.length;
    cursor = String(rows.results.at(-1)?.id || cursor);
    if (rows.results.length < 500) break;
  }
  await db
    .prepare(
      `UPDATE subscriber_segments SET refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE project_id = ? AND id = ?`,
    )
    .bind(projectId, segmentId)
    .run();
  return matched;
}

type SegmentCondition = {
  field: string;
  operator:
    | "equals"
    | "not_equals"
    | "contains"
    | "starts_with"
    | "exists"
    | "in";
  value?: unknown;
};
type SegmentRules = { mode: "all" | "any"; conditions: SegmentCondition[] };

function validateSegmentRules(value: unknown): SegmentRules {
  const source = jsonObject(value, "rules");
  const mode = enumValue(source.mode, "mode", ["all", "any"], "all");
  if (
    !Array.isArray(source.conditions) ||
    source.conditions.length === 0 ||
    source.conditions.length > 25
  )
    throw failure(
      "segment_conditions_invalid",
      "A segment requires between 1 and 25 conditions",
    );
  const conditions = source.conditions.map((condition) => {
    const item = jsonObject(condition, "condition", 4_000);
    return {
      field: text(item.field, "field", 128),
      operator: enumValue(item.operator, "operator", [
        "equals",
        "not_equals",
        "contains",
        "starts_with",
        "exists",
        "in",
      ]),
      value: item.value,
    } as SegmentCondition;
  });
  return { mode, conditions };
}

function segmentMatches(row: Record<string, unknown>, rules: SegmentRules) {
  const values = {
    ...parseStoredJson<Record<string, unknown>>(row.attributes_json, {}),
    ...row,
  };
  const matches = rules.conditions.map((condition) => {
    const actual = condition.field
      .split(".")
      .reduce<unknown>(
        (current, key) =>
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[key]
            : undefined,
        values,
      );
    switch (condition.operator) {
      case "exists":
        return actual !== undefined && actual !== null && actual !== "";
      case "equals":
        return String(actual ?? "") === String(condition.value ?? "");
      case "not_equals":
        return String(actual ?? "") !== String(condition.value ?? "");
      case "contains":
        return String(actual ?? "")
          .toLowerCase()
          .includes(String(condition.value ?? "").toLowerCase());
      case "starts_with":
        return String(actual ?? "")
          .toLowerCase()
          .startsWith(String(condition.value ?? "").toLowerCase());
      case "in":
        return (
          Array.isArray(condition.value) &&
          condition.value.map(String).includes(String(actual ?? ""))
        );
    }
  });
  return rules.mode === "all" ? matches.every(Boolean) : matches.some(Boolean);
}

async function subscriber(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare("SELECT * FROM subscribers WHERE project_id = ? AND id = ?")
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("subscriber_not_found", "Subscriber not found", 404);
  return row;
}
async function list(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare("SELECT * FROM subscriber_lists WHERE project_id = ? AND id = ?")
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("list_not_found", "List not found", 404);
  return row;
}
async function segment(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare(
      "SELECT * FROM subscriber_segments WHERE project_id = ? AND id = ?",
    )
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("segment_not_found", "Segment not found", 404);
  return row;
}
async function template(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare("SELECT * FROM email_templates WHERE project_id = ? AND id = ?")
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("template_not_found", "Template not found", 404);
  return row;
}
async function campaign(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare("SELECT * FROM campaigns WHERE project_id = ? AND id = ?")
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("campaign_not_found", "Campaign not found", 404);
  return row;
}
async function smtpProfileForTest(
  db: D1Database,
  projectId: number,
  id: string,
) {
  const row = id
    ? await db
        .prepare(
          "SELECT * FROM smtp_profiles WHERE project_id = ? AND id = ? AND enabled = 1",
        )
        .bind(projectId, id)
        .first<Record<string, unknown>>()
    : await db
        .prepare(
          "SELECT * FROM smtp_profiles WHERE project_id = ? AND enabled = 1 ORDER BY priority, created_at LIMIT 1",
        )
        .bind(projectId)
        .first<Record<string, unknown>>();
  if (!row)
    throw failure(
      "smtp_profile_not_found",
      "Enabled SMTP profile not found",
      404,
    );
  return row;
}
async function media(db: D1Database, projectId: number, id: string) {
  const row = await db
    .prepare("SELECT * FROM marketing_media WHERE project_id = ? AND id = ?")
    .bind(projectId, id)
    .first<Record<string, unknown>>();
  if (!row) throw failure("media_not_found", "Media file not found", 404);
  return row;
}
async function deliveryFromProvider(
  db: D1Database,
  projectId: number,
  deliveryId: string | null,
  providerMessageId: string | null,
) {
  const row = deliveryId
    ? await db
        .prepare(
          "SELECT * FROM email_deliveries WHERE project_id = ? AND id = ?",
        )
        .bind(projectId, deliveryId)
        .first<Record<string, unknown>>()
    : await db
        .prepare(
          "SELECT * FROM email_deliveries WHERE project_id = ? AND provider_message_id = ?",
        )
        .bind(projectId, providerMessageId)
        .first<Record<string, unknown>>();
  if (!row)
    throw failure("delivery_not_found", "Email delivery not found", 404);
  return row;
}

export function serializeSubscriber(row: Record<string, unknown>) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    status: row.status,
    consent_status: row.consent_status,
    consent_source: row.consent_source,
    attributes: parseStoredJson(row.attributes_json, {}),
    list_ids: parseStoredJson(row.list_ids_json, []),
    consented_at: row.consented_at,
    unsubscribed_at: row.unsubscribed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function serializeCampaign(row: Record<string, unknown>) {
  return {
    ...row,
    list_ids: parseStoredJson(row.list_ids_json, []),
    segment_ids: parseStoredJson(row.segment_ids_json, []),
  };
}
function serializeTemplate(row: Record<string, unknown>) {
  return row;
}
function serializeSmtpProfile(row: Record<string, unknown>) {
  const configuration = parseStoredJson<Record<string, unknown>>(
    row.public_config_json,
    {},
  );
  const host = String(configuration.host || "");
  return {
    id: row.id,
    name: row.name,
    ...configuration,
    provider: /^email-smtp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/u.test(host)
      ? "aws-ses"
      : "smtp",
    priority: row.priority,
    enabled: Boolean(row.enabled),
    hourly_quota: row.hourly_quota,
    daily_quota: row.daily_quota,
    configured: true,
    dkim_selector: row.dkim_selector,
    authentication_status: row.authentication_status,
    spf_status: row.spf_status,
    dkim_status: row.dkim_status,
    dmarc_status: row.dmarc_status,
    authentication_checked_at: row.authentication_checked_at,
    last_tested_at: row.last_tested_at,
    last_test_status: row.last_test_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback?: T,
): T {
  const parsed =
    value == null || value === "" ? fallback : (String(value) as T);
  if (!parsed || !allowed.includes(parsed))
    throw failure(
      `${field}_invalid`,
      `${field} must be one of ${allowed.join(", ")}`,
    );
  return parsed;
}
function escapeLike(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function percentage(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 10_000) / 100 : 0;
}

async function sharedSecretsEqual(provided: string, expected: string) {
  if (!provided || !expected) return false;
  const challenge = new TextEncoder().encode("opengrow-provider-webhook-v1");
  const [providedKey, expectedKey] = await Promise.all([
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(provided),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(expected),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    ),
  ]);
  const proof = await crypto.subtle.sign("HMAC", providedKey, challenge);
  return crypto.subtle.verify("HMAC", expectedKey, proof, challenge);
}

async function readBytesLimited(request: Request, maxBytes: number) {
  const announced = Number(request.headers.get("content-length") || 0);
  if (announced > maxBytes)
    throw failure("media_too_large", "Media is limited to 10 MB", 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel("media too large");
        throw failure("media_too_large", "Media is limited to 10 MB", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function safeFilename(value: string) {
  return (
    value
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 120) || "media"
  );
}

export async function dispatchOptinOutbox(
  env: Env,
  job: Extract<MarketingQueueJob, { type: "marketing.optin.deliver" }>,
) {
  try {
    await env.MARKETING_QUEUE.send(job);
    await env.DB.prepare(
      `
      UPDATE marketing_outbox SET status = 'dispatched', attempt_count = attempt_count + 1,
        dispatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
    `,
    )
      .bind(job.outboxId, job.projectId)
      .run();
    return true;
  } catch (error) {
    await env.DB.prepare(
      `
      UPDATE marketing_outbox SET status = 'pending', attempt_count = attempt_count + 1, last_error = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND project_id = ?
    `,
    )
      .bind(
        error instanceof Error
          ? error.message.slice(0, 2000)
          : String(error).slice(0, 2000),
        job.outboxId,
        job.projectId,
      )
      .run();
    console.error(
      JSON.stringify({
        event: "marketing_outbox_dispatch_failed",
        outbox_id: job.outboxId,
      }),
    );
    return false;
  }
}

function parseMarketingDeadLetterJob(
  payloadJson: string,
  projectId: number,
): MarketingQueueJob | null {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return isMarketingQueueJob(parsed) && parsed.projectId === projectId
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function scheduled(
  _controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  ctx.waitUntil(
    (async () => {
      const outbox = await env.DB.prepare(
        `
      SELECT id, project_id, resource_id, encrypted_payload FROM marketing_outbox
      WHERE status = 'pending' ORDER BY created_at LIMIT 100
    `,
      ).all<{
        id: string;
        project_id: number;
        resource_id: string;
        encrypted_payload: string;
      }>();
      for (const row of outbox.results) {
        const payload = await decryptJson<{ token: string }>(
          env.SMTP_ENCRYPTION_KEY,
          row.encrypted_payload,
        );
        await dispatchOptinOutbox(env, {
          type: "marketing.optin.deliver",
          projectId: row.project_id,
          subscriberId: row.resource_id,
          token: payload.token,
          outboxId: row.id,
        });
      }
      const rows = await env.DB.prepare(
        `SELECT id, project_id FROM campaigns WHERE status = 'scheduled' AND scheduled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') LIMIT 100`,
      ).all<{ id: string; project_id: number }>();
      for (const row of rows.results) {
        await env.MARKETING_QUEUE.send({
          type: "marketing.campaign.dispatch",
          projectId: row.project_id,
          campaignId: row.id,
        } satisfies MarketingQueueJob);
      }
      await dispatchDueJourneyEnrollments(env);
      await reconcileEmailProviderEvents(env);
    })(),
  );
}

async function reconcileEmailProviderEvents(env: Env) {
  let events: Awaited<ReturnType<typeof pendingEmailProviderEvents>>;
  try {
    events = await pendingEmailProviderEvents(env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "marketing_provider_event_reconciliation_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }
  const acknowledged: string[] = [];
  for (const event of events) {
    try {
      const response = await processProviderEvent(
        env,
        event.projectId,
        {
          event_type: event.eventType,
          provider_event_id: event.id,
          provider_message_id: event.providerMessageId,
          delivery_id: event.referenceId,
          metadata: {
            ...event.metadata,
            provider: event.provider,
            provider_event_id: event.id,
            provider_occurred_at: event.occurredAt,
          },
        },
        `email:${event.provider}`,
      );
      if (response.ok) acknowledged.push(event.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "marketing_provider_event_apply_failed",
          provider_event_id: event.id,
          project_id: event.projectId,
          delivery_id: event.referenceId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (acknowledged.length) {
    await acknowledgeEmailProviderEvents(env, acknowledged).catch((error) =>
      console.error(
        JSON.stringify({
          event: "marketing_provider_event_ack_failed",
          count: acknowledged.length,
          error: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
  }
}

export default {
  fetch: app.fetch,
  queue: handleMarketingQueue,
  scheduled,
} satisfies ExportedHandler<Env>;
