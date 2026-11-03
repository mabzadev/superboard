import type { Env } from "./types";

type AutomaticCaptainEnv = {
  DB: D1Database;
  SUPPORT_AI_QUEUE?: Queue;
};

type AutomaticAssistant = {
  assistant_id: string;
};

type AutomaticTaskState = {
  task_status: string;
  job_status: string;
};

export type AutomaticCaptainAuthorization = {
  active: number;
  automatic_enabled: number;
  response_mode: string;
  conversation_status: string;
  completed_handoffs: number;
  outbound_endpoints: number;
};

/**
 * Persist an idempotent AI task and its scheduler outbox entry for each
 * explicitly enabled assistant. The source message remains the authority for
 * the task identity; replaying the client message only repairs/retries the
 * same task and can never create another one.
 */
export async function enqueueAutomaticCaptainTasks(
  env: AutomaticCaptainEnv,
  projectId: number,
  conversationId: string,
  sourceMessageId: string,
) {
  const assistants = await env.DB.prepare(`
    SELECT link.assistant_id
    FROM conversations conversation
    INNER JOIN support_assistant_inboxes link
      ON link.project_id = conversation.project_id
      AND link.inbox_id = conversation.inbox_id
      AND link.automatic_enabled = 1
    INNER JOIN support_assistants assistant
      ON assistant.id = link.assistant_id
      AND assistant.project_id = link.project_id
      AND assistant.active = 1
    WHERE conversation.id = ? AND conversation.project_id = ?
      AND conversation.status IN ('open', 'pending')
      AND NOT EXISTS (
        SELECT 1 FROM support_assistant_tasks handoff
        WHERE handoff.project_id = conversation.project_id
          AND handoff.conversation_id = conversation.id
          AND handoff.assistant_id = assistant.id
          AND handoff.task_type = 'handoff'
          AND handoff.status = 'completed'
      )
    ORDER BY link.assistant_id
    LIMIT 10
  `).bind(conversationId, projectId).all<AutomaticAssistant>();

  const tasks = await Promise.all(assistants.results.map(async ({ assistant_id: assistantId }) => {
    const taskId = await automaticCaptainTaskId(
      projectId,
      conversationId,
      assistantId,
      sourceMessageId,
    );
    const scheduledJobId = `job:${taskId}`;
    return { assistantId, taskId, scheduledJobId };
  }));

  if (!tasks.length) return { tasks: 0, queued: 0 };

  await env.DB.batch(tasks.flatMap(({ assistantId, taskId, scheduledJobId }) => [
    env.DB.prepare(`
      INSERT OR IGNORE INTO support_assistant_tasks
        (id, project_id, assistant_id, conversation_id, task_type, input_json, created_by)
      VALUES (?, ?, ?, ?, 'suggest_reply', ?, 'captain:auto')
    `).bind(taskId, projectId, assistantId, conversationId, JSON.stringify({
      automatic_trigger: true,
      source_event: "message.created",
      source_message_id: sourceMessageId,
    })),
    env.DB.prepare(`
      INSERT OR IGNORE INTO support_scheduled_jobs
        (id, project_id, job_type, resource_id, queue_name, due_at, payload_json)
      SELECT ?, ?, 'captain.task', ?, 'ai',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?
      WHERE EXISTS (
        SELECT 1 FROM support_assistant_tasks
        WHERE id = ? AND project_id = ?
      )
    `).bind(
      scheduledJobId,
      projectId,
      taskId,
      JSON.stringify({ source_message_id: sourceMessageId }),
      taskId,
      projectId,
    ),
    env.DB.prepare(`
      INSERT OR IGNORE INTO support_audit_events
        (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
      VALUES (?, ?, ?, 'captain.task.queued', 'system', 'captain', ?)
    `).bind(
      `audit:${taskId}`,
      conversationId,
      projectId,
      JSON.stringify({
        task_id: taskId,
        assistant_id: assistantId,
        source_message_id: sourceMessageId,
        automatic: true,
      }),
    ),
  ]));

  let queued = 0;
  for (const { taskId, scheduledJobId } of tasks) {
    const state = await env.DB.prepare(`
      SELECT task.status task_status, job.status job_status
      FROM support_assistant_tasks task
      INNER JOIN support_scheduled_jobs job
        ON job.project_id = task.project_id
        AND job.job_type = 'captain.task'
        AND job.resource_id = task.id
      WHERE task.id = ? AND task.project_id = ?
    `).bind(taskId, projectId).first<AutomaticTaskState>();
    if (state?.task_status !== "queued" || state.job_status !== "pending") continue;
    if (!env.SUPPORT_AI_QUEUE) continue;
    try {
      await env.SUPPORT_AI_QUEUE.send({
        type: "support.captain.task.v1",
        projectId,
        taskId,
        scheduledJobId,
      }, { contentType: "json" });
      await env.DB.prepare(`
        UPDATE support_scheduled_jobs
        SET status = 'queued', last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND status = 'pending'
      `).bind(scheduledJobId, projectId).run();
      queued += 1;
    } catch (error) {
      console.error(JSON.stringify({
        event: "support_captain_queue_deferred",
        project_id: projectId,
        conversation_id: conversationId,
        task_id: taskId,
        error_code: captainErrorCode(error, "queue_unavailable"),
      }));
    }
  }
  return { tasks: tasks.length, queued };
}

export async function automaticCaptainTaskId(
  projectId: number,
  conversationId: string,
  assistantId: string,
  sourceMessageId: string,
) {
  const input = [projectId, conversationId, assistantId, sourceMessageId].join("\u001f");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)),
  );
  const hex = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `captain-auto:${hex}`;
}

export function isAutomaticCaptainTrigger(input: Record<string, unknown>) {
  return input.automatic_trigger === true &&
    typeof input.source_message_id === "string" &&
    input.source_message_id.length > 0 &&
    input.source_message_id.length <= 255;
}

export function canAutomaticallyDeliverCaptainResult(
  authorization: AutomaticCaptainAuthorization | null,
) {
  return authorization?.active === 1 &&
    authorization.automatic_enabled === 1 &&
    authorization.response_mode === "automatic" &&
    ["open", "pending"].includes(authorization.conversation_status) &&
    Number(authorization.completed_handoffs) === 0;
}

export function captainErrorCode(error: unknown, fallback: string) {
  const value = String((error as { code?: unknown })?.code || fallback);
  return /^[a-z0-9_]{1,128}$/u.test(value) ? value : fallback;
}

export type CaptainEnv = Pick<
  Env,
  "DB" | "SUPPORT_AI_QUEUE" | "SUPPORT_QUEUE" | "CONVERSATIONS"
>;
