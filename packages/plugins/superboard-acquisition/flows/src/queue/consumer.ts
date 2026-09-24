import {
  FLOW_EVENT_NAMES,
  type FlowQueueEvent,
} from "@superboard/contracts/flows";
import type { Env } from "../types";

export async function consumeFlowEvents(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  if (batch.queue.endsWith("-dlq")) {
    await quarantineDeadLetters(batch, env);
    return;
  }
  for (const message of batch.messages) {
    try {
      const event = parseQueueEvent(message.body);
      await projectEvent(env, event, message.attempts);
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: "flow_event_projection_failed",
        queue_message_id: message.id,
        attempt: message.attempts,
        error: errorMessage(error),
      }));
      message.retry({
        delaySeconds: Math.min(900, 2 ** Math.min(message.attempts, 9)),
      });
    }
  }
}

async function projectEvent(
  env: Env,
  event: FlowQueueEvent,
  attempts: number,
): Promise<void> {
  const publicProperties = stripPrivateProperties(event.properties);
  const state = runtimeState(event.properties);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO flow_analytics_events
        (event_id, project_id, project_ref, environment_id,
         user_id_hash, event_name, workflow_id, workflow_version_id, block_id,
         block_key, properties_json, legacy_event_type, source_event_id,
         source_module, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.eventId,
      event.projectId,
      event.projectRef,
      event.environmentId,
      event.userIdHash,
      event.name,
      event.workflowId ?? null,
      event.workflowVersionId ?? null,
      event.blockId ?? null,
      event.blockKey ?? null,
      JSON.stringify(publicProperties),
      event.legacyEventType ?? null,
      event.sourceEventId ?? null,
      event.legacySourceModule ?? null,
      event.occurredAt,
    ),
    env.DB.prepare(
      `INSERT INTO flow_outbox_receipts
        (event_id, project_id, environment_id, status,
         attempt_count, received_at, completed_at)
       VALUES (?, ?, ?, 'projected', ?, ?, ?)
       ON CONFLICT(project_id, event_id) DO UPDATE SET
         status = 'duplicate',
         attempt_count = flow_outbox_receipts.attempt_count + 1,
         completed_at = excluded.completed_at`,
    ).bind(
      event.eventId,
      event.projectId,
      event.environmentId,
      attempts,
      new Date().toISOString(),
      new Date().toISOString(),
    ),
  ];
  if (event.surveyResponse) {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO flow_survey_responses
          (id, event_id, project_id, environment_id,
           user_id_hash, survey_id, workflow_id, block_id, block_state_id,
           url, response_json, submitted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        event.eventId,
        event.projectId,
        event.environmentId,
        event.userIdHash,
        event.surveyResponse.surveyId,
        event.workflowId ?? event.surveyResponse.workflowId ?? null,
        event.blockId ?? event.surveyResponse.blockId ?? null,
        event.surveyResponse.blockStateId,
        event.surveyResponse.url,
        JSON.stringify({ questions: event.surveyResponse.questions }),
        event.occurredAt,
      ),
    );
  }
  if (state && event.workflowId) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO flow_user_workflow_states
          (project_id, environment_id, user_id_hash,
           workflow_id, workflow_version_id, state, active_block_ids_json,
           tour_indexes_json, entered_at, exited_at, generation, revision,
           updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, environment_id,
           user_id_hash, workflow_id) DO UPDATE SET
           workflow_version_id = excluded.workflow_version_id,
           state = excluded.state,
           active_block_ids_json = excluded.active_block_ids_json,
           tour_indexes_json = excluded.tour_indexes_json,
           entered_at = excluded.entered_at,
           exited_at = excluded.exited_at,
           generation = excluded.generation,
           revision = excluded.revision,
           updated_at = excluded.updated_at
         WHERE excluded.generation > flow_user_workflow_states.generation
            OR (excluded.generation = flow_user_workflow_states.generation
              AND excluded.revision > flow_user_workflow_states.revision)`,
      ).bind(
        event.projectId,
        event.environmentId,
        event.userIdHash,
        event.workflowId,
        event.workflowVersionId ?? null,
        state.state,
        JSON.stringify(state.activeBlockIds),
        JSON.stringify(state.tourIndexes),
        state.enteredAt ?? null,
        state.exitedAt ?? null,
        state.generation,
        state.revision,
        event.occurredAt,
      ),
    );
  }
  await env.DB.batch(statements);
}

async function quarantineDeadLetters(
  batch: MessageBatch<unknown>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const event = parseQueueEvent(message.body);
      const key = `v1/dead-letters/project=${event.projectId}/${event.eventId}.json`;
      await env.ARCHIVE.put(
        key,
        JSON.stringify({
          queue_message_id: message.id,
          attempts: message.attempts,
          event,
        }),
        { httpMetadata: { contentType: "application/json" } },
      );
      await env.DB.prepare(
        `INSERT INTO flow_outbox_receipts
          (event_id, project_id, environment_id, status,
           attempt_count, last_error, received_at, completed_at)
         VALUES (?, ?, ?, 'dead-letter', ?, 'queue retries exhausted', ?, ?)
         ON CONFLICT(project_id, event_id) DO UPDATE SET
           status = 'dead-letter', attempt_count = excluded.attempt_count,
           last_error = excluded.last_error, completed_at = excluded.completed_at`,
      )
        .bind(
          event.eventId,
          event.projectId,
          event.environmentId,
          message.attempts,
          new Date().toISOString(),
          new Date().toISOString(),
        )
        .run();
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: "flow_dead_letter_quarantine_failed",
        queue_message_id: message.id,
        error: errorMessage(error),
      }));
      message.retry({ delaySeconds: 60 });
    }
  }
}

function parseQueueEvent(value: unknown): FlowQueueEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Flow queue event must be an object");
  }
  const event = value as Partial<FlowQueueEvent>;
  if (
    event.schemaVersion !== 1 ||
    typeof event.eventId !== "string" ||
    typeof event.projectId !== "number" ||
    typeof event.projectRef !== "string" ||
    typeof event.environmentId !== "string" ||
    typeof event.userIdHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(event.userIdHash) ||
    typeof event.name !== "string" ||
    !(FLOW_EVENT_NAMES as readonly string[]).includes(event.name) ||
    typeof event.occurredAt !== "string"
  ) {
    throw new Error("Flow queue event is invalid");
  }
  return event as FlowQueueEvent;
}

function runtimeState(properties: Record<string, unknown> | undefined): {
  state: "not-started" | "in-progress" | "completed" | "stopped";
  activeBlockIds: string[];
  enteredAt?: string;
  exitedAt?: string;
  generation: number;
  revision: number;
  tourIndexes: Record<string, number>;
} | null {
  const value = properties?.__runtime_state;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (
    typeof state.state !== "string" ||
    !["not-started", "in-progress", "completed", "stopped"].includes(state.state) ||
    !Array.isArray(state.activeBlockIds)
  ) return null;
  return {
    state: state.state as "not-started" | "in-progress" | "completed" | "stopped",
    activeBlockIds: state.activeBlockIds.filter(
      (entry): entry is string => typeof entry === "string",
    ),
    generation:
      typeof state.generation === "number" && Number.isSafeInteger(state.generation)
        ? state.generation
        : 1,
    revision:
      typeof state.revision === "number" && Number.isSafeInteger(state.revision)
        ? state.revision
        : 0,
    tourIndexes: readNumberMap(state.tourIndexes),
    ...(typeof state.enteredAt === "string" ? { enteredAt: state.enteredAt } : {}),
    ...(typeof state.exitedAt === "string" ? { exitedAt: state.exitedAt } : {}),
  };
}

function readNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
    ),
  );
}

function stripPrivateProperties(
  properties: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!properties) return {};
  return Object.fromEntries(
    Object.entries(properties).filter(([key]) => !key.startsWith("__")),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
