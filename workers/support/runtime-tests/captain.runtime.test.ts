import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { handleSupportQueue } from "../src/webhooks";
import type { Env, SupportQueueJob } from "../src/types";

const internalToken = "support-runtime-secret";

describe("automatic Captain runtime", () => {
  it("queues one task per explicit link and delivers only automatic results through the room", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `captain-inbox-${suffix}`;
    const conversationId = `captain-conversation-${suffix}`;
    const endpointId = `captain-endpoint-${suffix}`;
    const automaticAssistantId = `captain-automatic-${suffix}`;
    const suggestionAssistantId = `captain-suggestion-${suffix}`;
    const disabledAssistantId = `captain-disabled-${suffix}`;
    const otherProjectAssistantId = `captain-other-project-${suffix}`;
    const portalId = `captain-portal-${suffix}`;
    const articleId = `captain-article-${suffix}`;
    const documentId = `captain-document-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, ?, ?, 'telegram')`)
        .bind(inboxId, `Captain ${suffix}`, `captain-${suffix}`),
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, inbox_id)
        VALUES (?, 12, ?, ?, 'Automatic assistance', ?)`)
        .bind(conversationId, `captain-user-${suffix}`, `captain-client-${suffix}`, inboxId),
      env.DB.prepare(`INSERT INTO support_provider_endpoints
        (id, project_id, inbox_id, provider, display_name, status, settings_json)
        VALUES (?, 12, ?, 'telegram', ?, 'configured', '{}')`)
        .bind(endpointId, inboxId, `Captain Telegram ${suffix}`),
      assistantStatement(automaticAssistantId, 12, "automatic", 1, suffix),
      assistantStatement(suggestionAssistantId, 12, "suggestion", 1, suffix),
      assistantStatement(disabledAssistantId, 12, "automatic", 1, suffix),
      assistantStatement(otherProjectAssistantId, 13, "automatic", 1, suffix),
    ]);
    await env.DB.batch([
      assistantInboxStatement(automaticAssistantId, inboxId, 12, true),
      assistantInboxStatement(suggestionAssistantId, inboxId, 12, true),
      assistantInboxStatement(disabledAssistantId, inboxId, 12, false),
      assistantInboxStatement(otherProjectAssistantId, inboxId, 13, true),
      env.DB.prepare(`INSERT INTO support_portals
        (id, project_id, name, slug, status, created_by)
        VALUES (?, 12, ?, ?, 'published', 'runtime')`)
        .bind(portalId, `Captain portal ${suffix}`, `captain-${suffix}`),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_articles
        (id, project_id, portal_id, title, slug, content, status, author_id, published_at)
        VALUES (?, 12, ?, 'Returns policy', ?, 'Returns are accepted for thirty days.',
          'published', 'runtime', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`)
        .bind(articleId, portalId, `returns-${suffix}`),
      env.DB.prepare(`INSERT INTO support_knowledge_documents
        (id, project_id, source_type, source_id, title, content_hash,
         vector_namespace, status, chunk_count, created_by)
        VALUES (?, 12, 'article', ?, 'Returns policy', ?, 'project:12', 'indexed', 1, 'runtime')`)
        .bind(documentId, articleId, `hash-${suffix}`),
    ]);

    const sourceMessageId = `captain-source-${suffix}`;
    const first = await postRoomMessage(conversationId, "user", `captain-user-${suffix}`, {
      body: "Can I return this order?",
      client_message_id: sourceMessageId,
    });
    expect(first.status).toBe(201);
    const replay = await postRoomMessage(conversationId, "user", `captain-user-${suffix}`, {
      body: "Can I return this order?",
      client_message_id: sourceMessageId,
    });
    expect(replay.status).toBe(200);

    const tasks = await env.DB.prepare(`SELECT id, assistant_id, status
      FROM support_assistant_tasks WHERE project_id = 12 AND conversation_id = ?
      ORDER BY assistant_id`).bind(conversationId).all<{
        id: string;
        assistant_id: string;
        status: string;
      }>();
    expect(tasks.results.map((task) => task.assistant_id)).toEqual([
      automaticAssistantId,
      suggestionAssistantId,
    ]);
    expect(tasks.results.every((task) => task.status === "queued")).toBe(true);
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_assistant_tasks
      WHERE project_id = 13 AND conversation_id = ?`).bind(conversationId).first())
      .resolves.toMatchObject({ count: 0 });
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_scheduled_jobs
      WHERE project_id = 12 AND job_type = 'captain.task'
        AND resource_id IN (?, ?)`)
      .bind(tasks.results[0].id, tasks.results[1].id).first())
      .resolves.toMatchObject({ count: 2 });

    const generation = vi.fn(async (_model: unknown, input: unknown) => {
      if ("text" in object(input)) return { data: [Array<number>(1024).fill(0.25)] };
      return { response: "Yes. The documented return period is thirty days." };
    });
    const runtimeEnv = captainEnv(generation, [{
      id: `${documentId}:0`,
      score: 0.98,
      metadata: {
        project_id: 12,
        document_id: documentId,
        source_id: articleId,
        chunk: 0,
      },
    }]);
    const suggestionTask = tasks.results.find((task) => task.assistant_id === suggestionAssistantId)!;
    const automaticTask = tasks.results.find((task) => task.assistant_id === automaticAssistantId)!;
    await expect(processCaptainTask(runtimeEnv, suggestionTask.id, 1)).resolves.toBe("acked");
    await expect(processCaptainTask(runtimeEnv, automaticTask.id, 1)).resolves.toBe("acked");
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_scheduled_jobs
      WHERE project_id = 12 AND job_type = 'captain.task'
        AND resource_id IN (?, ?) AND status = 'completed'`)
      .bind(suggestionTask.id, automaticTask.id).first()).resolves.toMatchObject({ count: 2 });

    const messages = await env.DB.prepare(`SELECT id, sender_kind, body, metadata_json
      FROM messages WHERE conversation_id = ? ORDER BY sequence`).bind(conversationId)
      .all<{ id: string; sender_kind: string; body: string; metadata_json: string }>();
    expect(messages.results).toHaveLength(2);
    expect(messages.results[1]).toMatchObject({
      sender_kind: "system",
      body: "Yes. The documented return period is thirty days.",
    });
    expect(JSON.parse(messages.results[1].metadata_json)).toMatchObject({
      captain_task_id: automaticTask.id,
      assistant_id: automaticAssistantId,
      source_message_id: expect.any(String),
      sources: [{ id: articleId, slug: `returns-${suffix}`, score: 0.98 }],
      delivery_pending: true,
    });
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_provider_deliveries
      WHERE project_id = 12 AND conversation_id = ? AND message_id = ?`)
      .bind(conversationId, messages.results[1].id).first()).resolves.toMatchObject({ count: 1 });
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_assistant_tasks
      WHERE project_id = 12 AND conversation_id = ?`).bind(conversationId).first())
      .resolves.toMatchObject({ count: 2 });
    const automaticResult = await env.DB.prepare(`SELECT status, result_json
      FROM support_assistant_tasks WHERE id = ? AND project_id = 12`)
      .bind(automaticTask.id).first<{ status: string; result_json: string }>();
    expect(automaticResult?.status).toBe("completed");
    expect(JSON.parse(automaticResult!.result_json)).toMatchObject({
      sources: [{ id: articleId, slug: `returns-${suffix}` }],
      automatic_delivery: { status: "sent", message_id: messages.results[1].id },
    });
    const suggestionResult = await env.DB.prepare(`SELECT status, result_json
      FROM support_assistant_tasks WHERE id = ? AND project_id = 12`)
      .bind(suggestionTask.id).first<{ status: string; result_json: string }>();
    expect(JSON.parse(suggestionResult!.result_json)).toMatchObject({
      response_mode: "suggestion",
      automatic_delivery: { status: "not_sent" },
    });

    await expect(processCaptainTask(runtimeEnv, automaticTask.id, 2)).resolves.toBe("acked");
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM messages WHERE conversation_id = ?`)
      .bind(conversationId).first()).resolves.toMatchObject({ count: 2 });
    expect(generation).toHaveBeenCalledTimes(4);
    const room = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(room, async (_instance, state) => {
      const events = state.storage.sql.exec<{ event_type: string }>(
        "SELECT event_type FROM realtime_events ORDER BY sequence",
      ).toArray();
      expect(events.filter((event) => event.event_type === "message.created")).toHaveLength(2);
    });
  });

  it("returns a transient generation failure to Queue retry and resumes the same task", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `captain-retry-inbox-${suffix}`;
    const conversationId = `captain-retry-conversation-${suffix}`;
    const assistantId = `captain-retry-assistant-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, ?, ?, 'api')`)
        .bind(inboxId, `Captain retry ${suffix}`, `captain-retry-${suffix}`),
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, inbox_id)
        VALUES (?, 12, ?, ?, 'Retry assistance', ?)`)
        .bind(conversationId, `captain-retry-user-${suffix}`, `captain-retry-client-${suffix}`, inboxId),
      assistantStatement(assistantId, 12, "automatic", 1, suffix),
    ]);
    await env.DB.prepare(`INSERT INTO support_assistant_inboxes
      (project_id, assistant_id, inbox_id, automatic_enabled, configured_by)
      VALUES (12, ?, ?, 1, 'runtime')`).bind(assistantId, inboxId).run();
    expect((await postRoomMessage(conversationId, "user", `captain-retry-user-${suffix}`, {
      body: "Please retry this answer",
      client_message_id: `captain-retry-source-${suffix}`,
    })).status).toBe(201);
    const task = await env.DB.prepare(`SELECT id FROM support_assistant_tasks
      WHERE project_id = 12 AND conversation_id = ?`).bind(conversationId).first<{ id: string }>();
    expect(task?.id).toBeTruthy();

    const transient = Object.assign(new Error("temporary generation outage"), {
      code: "captain_test_unavailable",
      status: 503,
    });
    const failingGeneration = vi.fn(async (_model: unknown, input: unknown) => {
      if ("text" in object(input)) return { data: [Array<number>(1024).fill(0.1)] };
      throw transient;
    });
    const failedEnv = captainEnv(failingGeneration, []);
    const failedBatch = await queuedCaptainBatch(task!.id, 1);
    await handleSupportQueue(failedBatch, failedEnv);
    const failedResult = await getQueueResult(failedBatch, createExecutionContext());
    expect(failedResult.explicitAcks).toEqual([]);
    expect(failedResult.retryMessages).toEqual([{ msgId: failedBatch.messages[0].id }]);
    await expect(env.DB.prepare(`SELECT status, last_error FROM support_assistant_tasks WHERE id = ?`)
      .bind(task!.id).first()).resolves.toMatchObject({
        status: "queued",
        last_error: "captain_test_unavailable",
      });

    const successfulGeneration = vi.fn(async (_model: unknown, input: unknown) => {
      if ("text" in object(input)) return { data: [Array<number>(1024).fill(0.1)] };
      return { response: "The retried answer is ready." };
    });
    await expect(processCaptainTask(captainEnv(successfulGeneration, []), task!.id, 2))
      .resolves.toBe("acked");
    await expect(env.DB.prepare(`SELECT status, last_error FROM support_assistant_tasks WHERE id = ?`)
      .bind(task!.id).first()).resolves.toMatchObject({ status: "completed", last_error: null });
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM messages
      WHERE conversation_id = ? AND sender_kind = 'system' AND body = 'The retried answer is ready.'`)
      .bind(conversationId).first()).resolves.toMatchObject({ count: 1 });
  });

  it("fails a disabled human handoff closed and blocks later automation after an enabled handoff", async () => {
    const suffix = crypto.randomUUID();
    const inboxId = `captain-handoff-inbox-${suffix}`;
    const conversationId = `captain-handoff-conversation-${suffix}`;
    const assistantId = `captain-handoff-assistant-${suffix}`;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_inboxes
        (id, project_id, name, identifier, channel_type)
        VALUES (?, 12, ?, ?, 'api')`)
        .bind(inboxId, `Captain handoff ${suffix}`, `captain-handoff-${suffix}`),
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject, inbox_id, assigned_user_id)
        VALUES (?, 12, ?, ?, 'Handoff assistance', ?, 'human-agent')`)
        .bind(conversationId, `captain-handoff-user-${suffix}`, `captain-handoff-client-${suffix}`, inboxId),
      assistantStatement(assistantId, 12, "automatic", 0, suffix),
    ]);
    await env.DB.prepare(`INSERT INTO support_assistant_inboxes
      (project_id, assistant_id, inbox_id, automatic_enabled, configured_by)
      VALUES (12, ?, ?, 1, 'runtime')`).bind(assistantId, inboxId).run();

    const disabledTaskId = `captain-handoff-disabled-${suffix}`;
    await handoffTask(disabledTaskId, assistantId, conversationId);
    const disabledBatch = captainBatch(disabledTaskId, 1);
    await handleSupportQueue(disabledBatch, captainEnv(vi.fn(), []));
    expect((await getQueueResult(disabledBatch, createExecutionContext())).explicitAcks)
      .toEqual([disabledBatch.messages[0].id]);
    await expect(env.DB.prepare(`SELECT status, last_error FROM support_assistant_tasks WHERE id = ?`)
      .bind(disabledTaskId).first()).resolves.toMatchObject({
        status: "failed",
        last_error: "captain_handoff_disabled",
      });
    await expect(env.DB.prepare(`SELECT assigned_user_id FROM conversations WHERE id = ?`)
      .bind(conversationId).first()).resolves.toMatchObject({ assigned_user_id: "human-agent" });

    await env.DB.prepare(`UPDATE support_assistants SET handoff_enabled = 1 WHERE id = ? AND project_id = 12`)
      .bind(assistantId).run();
    const enabledTaskId = `captain-handoff-enabled-${suffix}`;
    await handoffTask(enabledTaskId, assistantId, conversationId);
    await expect(processCaptainTask(captainEnv(vi.fn(), []), enabledTaskId, 1))
      .resolves.toBe("acked");
    await expect(env.DB.prepare(`SELECT status FROM support_assistant_tasks WHERE id = ?`)
      .bind(enabledTaskId).first()).resolves.toMatchObject({ status: "completed" });
    await expect(env.DB.prepare(`SELECT assigned_user_id, status FROM conversations WHERE id = ?`)
      .bind(conversationId).first()).resolves.toMatchObject({ assigned_user_id: null, status: "open" });

    expect((await postRoomMessage(conversationId, "user", `captain-handoff-user-${suffix}`, {
      body: "A human is handling this now",
      client_message_id: `captain-after-handoff-${suffix}`,
    })).status).toBe(201);
    await expect(env.DB.prepare(`SELECT COUNT(*) count FROM support_assistant_tasks
      WHERE project_id = 12 AND conversation_id = ? AND task_type = 'suggest_reply'`)
      .bind(conversationId).first()).resolves.toMatchObject({ count: 0 });
  });
});

function assistantStatement(
  id: string,
  projectId: number,
  responseMode: "suggestion" | "automatic",
  handoffEnabled: 0 | 1,
  suffix: string,
) {
  return env.DB.prepare(`INSERT INTO support_assistants
    (id, project_id, name, instructions, response_mode, handoff_enabled, created_by)
    VALUES (?, ?, ?, 'Answer only from supplied Support sources.', ?, ?, 'runtime')`)
    .bind(id, projectId, `${responseMode}-${id}-${suffix}`, responseMode, handoffEnabled);
}

function assistantInboxStatement(
  assistantId: string,
  inboxId: string,
  projectId: number,
  automatic: boolean,
) {
  return env.DB.prepare(`INSERT INTO support_assistant_inboxes
    (project_id, assistant_id, inbox_id, automatic_enabled, configured_by)
    VALUES (?, ?, ?, ?, 'runtime')`)
    .bind(projectId, assistantId, inboxId, automatic ? 1 : 0);
}

async function postRoomMessage(
  conversationId: string,
  actorKind: "user" | "system",
  actorId: string,
  body: Record<string, unknown>,
) {
  return env.CONVERSATIONS.getByName(conversationId).fetch(new Request("https://room.internal/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-room-capability": internalToken,
      "x-conversation-id": conversationId,
      "x-actor-kind": actorKind,
      "x-actor-id": actorId,
      "x-identity-expires-at": String(Date.now() + 60_000),
    },
    body: JSON.stringify(body),
  }));
}

function captainEnv(
  run: (model: unknown, input: unknown) => Promise<unknown>,
  matches: Array<{ id: string; score: number; metadata: Record<string, unknown> }>,
) {
  return {
    ...env,
    AI: { run },
    SUPPORT_EMBEDDING_MODEL: "runtime-embedding",
    SUPPORT_GENERATION_MODEL: "runtime-generation",
    SUPPORT_KNOWLEDGE: {
      query: async () => ({ matches }),
    },
  } as unknown as Env;
}

function captainBatch(taskId: string, attempts: number, scheduledJobId?: string) {
  return createMessageBatch<SupportQueueJob>("support-test-ai", [{
    id: `captain-runtime-${taskId}-${attempts}`,
    timestamp: new Date(),
    attempts,
    body: {
      type: "support.captain.task.v1",
      projectId: 12,
      taskId,
      ...(scheduledJobId ? { scheduledJobId } : {}),
    },
  }]);
}

async function processCaptainTask(runtimeEnv: Env, taskId: string, attempts: number) {
  const batch = await queuedCaptainBatch(taskId, attempts);
  await handleSupportQueue(batch, runtimeEnv);
  const result = await getQueueResult(batch, createExecutionContext());
  expect(result.explicitAcks).toEqual([batch.messages[0].id]);
  return "acked";
}

async function queuedCaptainBatch(taskId: string, attempts: number) {
  const job = await env.DB.prepare(`SELECT id FROM support_scheduled_jobs
    WHERE project_id = 12 AND job_type = 'captain.task' AND resource_id = ?`)
    .bind(taskId).first<{ id: string }>();
  return captainBatch(taskId, attempts, job?.id);
}

async function handoffTask(taskId: string, assistantId: string, conversationId: string) {
  await env.DB.prepare(`INSERT INTO support_assistant_tasks
    (id, project_id, assistant_id, conversation_id, task_type, input_json, created_by)
    VALUES (?, 12, ?, ?, 'handoff', '{}', 'runtime')`)
    .bind(taskId, assistantId, conversationId).run();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
