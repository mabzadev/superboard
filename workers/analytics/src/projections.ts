import {
  ANALYTICS_CANONICAL_EVENTS,
  VERIFIED_PURCHASE_EVENT_TYPES,
  stableAnalyticsJson,
  type AnalyticsEventV1,
  type VerifiedPurchaseEventType,
} from "@superboard/contracts/analytics";
import { httpError } from "./http";
import {
  deliverMarketingSignal,
  marketingSignalStatement,
} from "./marketing-signals";
import type {
  Env,
  IdentityKind,
  OutboxRow,
  StoredAnalyticsEventV1,
} from "./types";

const HOT_RETENTION_DAYS = 35;

export async function projectStoredEvent(
  env: Env,
  outbox: OutboxRow,
  value: unknown,
): Promise<void> {
  const stored = validateStoredEvent(value, outbox);
  const event = stored.event;
  const archiveKey = archiveObjectKey(outbox.project_id, event);
  await env.EVENT_ARCHIVE.put(archiveKey, stableAnalyticsJson(event), {
    httpMetadata: { contentType: "application/json; charset=UTF-8" },
    customMetadata: {
      project_id: outbox.project_id,
      event_id: event.event_id,
      schema_version: String(event.schema_version),
    },
  });

  const profileId = await resolveProfile(
    env.DB,
    outbox.project_id,
    stored,
  );
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_events_hot
        (project_id, event_id, event_name, event_source, application_id,
         app_instance_id_hash, session_id_hash, anonymous_id_hash, user_id_hash,
         properties_json, context_json, occurred_at, archive_key, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?, ?))`,
    ).bind(
      outbox.project_id,
      event.event_id,
      event.event_name,
      event.source,
      event.application_id,
      event.app_instance_id ?? null,
      event.session_id ?? null,
      event.anonymous_id ?? null,
      event.user_id ?? null,
      stableAnalyticsJson(event.properties),
      stableAnalyticsJson(event.context ?? {}),
      event.occurred_at,
      archiveKey,
      event.occurred_at,
      `+${HOT_RETENTION_DAYS} days`,
    ),
    dailyEventMetricStatement(env.DB, outbox.project_id, event),
    env.DB.prepare(
      `INSERT OR IGNORE INTO analytics_projection_receipts
        (project_id, projection, event_id) VALUES (?, 'daily_event', ?)`,
    ).bind(outbox.project_id, event.event_id),
  ];
  for (const subjectHash of new Set(
    [event.user_id, event.anonymous_id, event.app_instance_id].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    ),
  )) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO analytics_subject_event_index
          (project_id, subject_hash, event_id, archive_key, occurred_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        outbox.project_id,
        subjectHash,
        event.event_id,
        archiveKey,
        event.occurred_at,
      ),
    );
  }

  if (event.session_id) {
    statements.push(
      await sessionStatement(
        env.DB,
        outbox.project_id,
        stored,
        profileId,
      ),
      env.DB.prepare(
        `INSERT OR IGNORE INTO analytics_projection_receipts
          (project_id, projection, event_id) VALUES (?, 'session', ?)`,
      ).bind(outbox.project_id, event.event_id),
    );
  }
  if (event.event_name === ANALYTICS_CANONICAL_EVENTS.installationCreated) {
    statements.push(
      await installationStatement(env.DB, outbox.project_id, stored),
    );
  }
  if (event.event_name === ANALYTICS_CANONICAL_EVENTS.purchaseVerified) {
    statements.push(purchaseStatement(env.DB, outbox.project_id, event));
  }
  statements.push(
    marketingSignalStatement(env.DB, outbox, event),
    env.DB.prepare(
      `UPDATE analytics_event_receipts
       SET status = 'projected', archive_key = ?, projected_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE project_id = ? AND event_id = ?`,
    ).bind(archiveKey, outbox.project_id, event.event_id),
    env.DB.prepare(
      `UPDATE analytics_ingest_outbox
       SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           last_error = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).bind(outbox.id),
  );
  await env.DB.batch(statements);
  await deliverMarketingSignal(env, outbox.project_id, event.event_id);
}

function dailyEventMetricStatement(
  db: D1Database,
  projectId: string,
  event: AnalyticsEventV1,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO analytics_daily_metrics
        (project_id, application_id, metric_date, metric_name, dimension_key, event_count)
       SELECT ?, ?, substr(?, 1, 10), 'event', ?, 1
       WHERE NOT EXISTS (
         SELECT 1 FROM analytics_projection_receipts
         WHERE project_id = ? AND projection = 'daily_event' AND event_id = ?
       )
       ON CONFLICT(project_id, application_id, metric_date, metric_name, dimension_key)
       DO UPDATE SET event_count = analytics_daily_metrics.event_count + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(
      projectId,
      event.application_id,
      event.occurred_at,
      event.event_name,
      projectId,
      event.event_id,
    );
}

async function sessionStatement(
  db: D1Database,
  projectId: string,
  stored: StoredAnalyticsEventV1,
  profileId: string | null,
): Promise<D1PreparedStatement> {
  const event = stored.event;
  const sessionCandidates = stored.identity_hashes.session ?? [];
  const existingSessionHash =
    sessionCandidates.length > 0
      ? await findExistingHash(
          db,
          "analytics_sessions",
          projectId,
          event.application_id,
          "session_id_hash",
          sessionCandidates,
        )
      : null;
  return db
    .prepare(
      `INSERT INTO analytics_sessions
        (id, project_id, application_id, session_id_hash, profile_id,
         app_instance_id_hash, first_event_id, last_event_id, started_at, ended_at,
         event_count, duration_seconds, platform, app_version)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM analytics_projection_receipts
         WHERE project_id = ? AND projection = 'session' AND event_id = ?
       )
       ON CONFLICT(project_id, application_id, session_id_hash) DO UPDATE SET
         profile_id = COALESCE(analytics_sessions.profile_id, excluded.profile_id),
         app_instance_id_hash = COALESCE(analytics_sessions.app_instance_id_hash, excluded.app_instance_id_hash),
         first_event_id = CASE WHEN excluded.started_at < analytics_sessions.started_at
           THEN excluded.first_event_id ELSE analytics_sessions.first_event_id END,
         last_event_id = CASE WHEN excluded.ended_at >= analytics_sessions.ended_at
           THEN excluded.last_event_id ELSE analytics_sessions.last_event_id END,
         started_at = min(analytics_sessions.started_at, excluded.started_at),
         ended_at = max(analytics_sessions.ended_at, excluded.ended_at),
         event_count = analytics_sessions.event_count + 1,
         duration_seconds = max(0, CAST(
           (julianday(max(analytics_sessions.ended_at, excluded.ended_at)) -
            julianday(min(analytics_sessions.started_at, excluded.started_at))) * 86400 AS INTEGER
         )),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      event.application_id,
      existingSessionHash ?? event.session_id,
      profileId,
      event.app_instance_id ?? null,
      event.event_id,
      event.event_id,
      event.occurred_at,
      event.occurred_at,
      event.context?.platform ?? null,
      event.context?.app_version ?? null,
      projectId,
      event.event_id,
    );
}

async function installationStatement(
  db: D1Database,
  projectId: string,
  stored: StoredAnalyticsEventV1,
): Promise<D1PreparedStatement> {
  const event = stored.event;
  const candidates = stored.identity_hashes.app_instance ?? [];
  if (!event.app_instance_id || candidates.length === 0) {
    throw httpError(
      "analytics_installation_identity_missing",
      "Canonical installation events require app_instance_id",
      422,
    );
  }
  const existingHash = await findExistingHash(
    db,
    "analytics_installations",
    projectId,
    event.application_id,
    "app_instance_id_hash",
    candidates,
  );
  return db
    .prepare(
      `INSERT OR IGNORE INTO analytics_installations
        (id, project_id, application_id, app_instance_id_hash, source_event_id,
         installed_at, platform, app_version, attribution_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      event.application_id,
      existingHash ?? event.app_instance_id,
      event.event_id,
      event.occurred_at,
      event.context?.platform ?? textProperty(event, "platform"),
      event.context?.app_version ?? textProperty(event, "app_version"),
      textProperty(event, "attribution_id"),
    );
}

function purchaseStatement(
  db: D1Database,
  projectId: string,
  event: AnalyticsEventV1,
): D1PreparedStatement {
  const store = requiredChoice(event, "store", [
    "apple",
    "google",
    "stripe",
    "manual",
  ] as const);
  const environment = requiredChoice(event, "environment", [
    "sandbox",
    "production",
  ] as const);
  const eventType = requiredChoice(
    event,
    "event_type",
    VERIFIED_PURCHASE_EVENT_TYPES,
  ) as VerifiedPurchaseEventType;
  return db
    .prepare(
      `INSERT OR IGNORE INTO analytics_purchase_facts
        (id, project_id, application_id, source_event_id, billing_transaction_id,
         store, environment, store_transaction_id, event_type, product_id,
         amount_micros, currency, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      event.application_id,
      event.event_id,
      textProperty(event, "billing_transaction_id"),
      store,
      environment,
      requiredTextProperty(event, "store_transaction_id"),
      eventType,
      textProperty(event, "product_id"),
      integerProperty(event, "amount_micros"),
      textProperty(event, "currency"),
      event.occurred_at,
    );
}

async function resolveProfile(
  db: D1Database,
  projectId: string,
  stored: StoredAnalyticsEventV1,
): Promise<string | null> {
  const orderedKinds: Array<Exclude<IdentityKind, "session">> = [
    "user",
    "anonymous",
    "app_instance",
  ];
  const aliases = orderedKinds.flatMap((kind) =>
    (stored.identity_hashes[kind] ?? []).map((hash) => ({ kind, hash })),
  );
  if (aliases.length === 0) return null;
  const placeholders = aliases.map(() => "?").join(", ");
  const existing = await db
    .prepare(
      `SELECT profile_id FROM analytics_identity_aliases
       WHERE project_id = ? AND application_id = ? AND alias_hash IN (${placeholders})
       ORDER BY CASE alias_kind WHEN 'user' THEN 0 WHEN 'anonymous' THEN 1 ELSE 2 END
       LIMIT 1`,
    )
    .bind(
      projectId,
      stored.event.application_id,
      ...aliases.map(({ hash }) => hash),
    )
    .first<{ profile_id: string }>();
  const canonical = aliases[0].hash;
  const profileId = existing?.profile_id ?? crypto.randomUUID();
  const profileProperties =
    stored.event.event_name === ANALYTICS_CANONICAL_EVENTS.profileUpdated
      ? stored.event.properties
      : {};
  const statements: D1PreparedStatement[] = existing
    ? [
        db.prepare(
          `UPDATE analytics_profiles
           SET first_seen_at = min(first_seen_at, ?),
               last_seen_at = max(last_seen_at, ?),
               properties_json = CASE WHEN ? != '{}' THEN ? ELSE properties_json END,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND project_id = ?`,
        ).bind(
          stored.event.occurred_at,
          stored.event.occurred_at,
          stableAnalyticsJson(profileProperties),
          stableAnalyticsJson(profileProperties),
          profileId,
          projectId,
        ),
      ]
    : [
        db.prepare(
          `INSERT INTO analytics_profiles
            (id, project_id, application_id, canonical_subject_hash, properties_json,
             first_seen_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(project_id, application_id, canonical_subject_hash) DO UPDATE SET
             first_seen_at = min(analytics_profiles.first_seen_at, excluded.first_seen_at),
             last_seen_at = max(analytics_profiles.last_seen_at, excluded.last_seen_at),
             properties_json = CASE WHEN excluded.properties_json != '{}'
               THEN excluded.properties_json ELSE analytics_profiles.properties_json END,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        ).bind(
          profileId,
          projectId,
          stored.event.application_id,
          canonical,
          stableAnalyticsJson(profileProperties),
          stored.event.occurred_at,
          stored.event.occurred_at,
        ),
      ];
  for (const alias of aliases) {
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO analytics_identity_aliases
          (project_id, application_id, alias_kind, alias_hash, profile_id)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        projectId,
        stored.event.application_id,
        alias.kind === "app_instance" ? "instance" : alias.kind,
        alias.hash,
        profileId,
      ),
    );
  }
  await db.batch(statements);
  const resolved = await db
    .prepare(
      `SELECT profile_id FROM analytics_identity_aliases
       WHERE project_id = ? AND application_id = ? AND alias_hash = ? LIMIT 1`,
    )
    .bind(projectId, stored.event.application_id, canonical)
    .first<{ profile_id: string }>();
  return resolved?.profile_id ?? profileId;
}

async function findExistingHash(
  db: D1Database,
  table: "analytics_installations" | "analytics_sessions",
  projectId: string,
  applicationId: string,
  column: "app_instance_id_hash" | "session_id_hash",
  candidates: string[],
): Promise<string | null> {
  const placeholders = candidates.map(() => "?").join(", ");
  const row = await db
    .prepare(
      `SELECT ${column} AS identity_hash FROM ${table}
       WHERE project_id = ? AND application_id = ? AND ${column} IN (${placeholders})
       LIMIT 1`,
    )
    .bind(projectId, applicationId, ...candidates)
    .first<{ identity_hash: string }>();
  return row?.identity_hash ?? null;
}

function validateStoredEvent(
  value: unknown,
  outbox: OutboxRow,
): StoredAnalyticsEventV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw httpError(
      "analytics_outbox_payload_invalid",
      "Stored analytics payload must be an object",
      500,
    );
  }
  const stored = value as Partial<StoredAnalyticsEventV1>;
  if (
    !stored.event ||
    stored.event.event_id !== outbox.event_id ||
    !stored.identity_hashes ||
    typeof stored.identity_hashes !== "object"
  ) {
    throw httpError(
      "analytics_outbox_payload_invalid",
      "Stored analytics payload does not match its outbox receipt",
      500,
    );
  }
  return stored as StoredAnalyticsEventV1;
}

function archiveObjectKey(projectId: string, event: AnalyticsEventV1): string {
  const timestamp = new Date(event.occurred_at);
  const date = timestamp.toISOString().slice(0, 10);
  const hour = timestamp.toISOString().slice(11, 13);
  return `v1/project=${encodeURIComponent(projectId)}/date=${date}/hour=${hour}/event=${encodeURIComponent(event.event_id)}.json`;
}

function textProperty(event: AnalyticsEventV1, key: string): string | null {
  const value = event.properties[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredTextProperty(event: AnalyticsEventV1, key: string): string {
  const value = textProperty(event, key);
  if (!value) {
    throw httpError(
      "analytics_purchase_fact_invalid",
      `Canonical purchase events require ${key}`,
      422,
    );
  }
  return value;
}

function integerProperty(event: AnalyticsEventV1, key: string): number | null {
  const value = event.properties[key];
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function requiredChoice<const T extends readonly string[]>(
  event: AnalyticsEventV1,
  key: string,
  choices: T,
): T[number] {
  const value = requiredTextProperty(event, key);
  if (!choices.includes(value)) {
    throw httpError(
      "analytics_purchase_fact_invalid",
      `${key} is not supported for canonical purchase events`,
      422,
    );
  }
  return value as T[number];
}

export async function purgeExpiredHotEvents(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM analytics_events_hot
       WHERE rowid IN (
         SELECT rowid FROM analytics_events_hot
         WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         ORDER BY expires_at ASC LIMIT 1000
       )`,
    )
    .run();
  return Number(result.meta.changes ?? 0);
}
