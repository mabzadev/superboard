import { env, SELF } from "cloudflare:test";
import { signProjectContext } from "@superboard/contracts/project-context";
import type { FlowQueueEvent } from "@superboard/contracts/flows";
import { describe, expect, it, vi } from "vitest";
import { consumeFlowEvents } from "../src/queue/consumer";

const secret = "flows-runtime-secret";
const firstProject = {
  projectId: 11,
  projectRef: "10-test",
  instanceId: 10,
} as const;
const secondProject = {
  projectId: 21,
  projectRef: "20-test",
  instanceId: 20,
} as const;

describe("Flows project isolation", () => {
  it("cannot replace variants through an experiment owned by another project", async () => {
    const first = await createLegacyExperiment(firstProject, "first");
    const second = await createLegacyExperiment(secondProject, "second");

    const attack = await projectRequest(
      secondProject,
      "PATCH",
      `/internal/v1/legacy/paywalls/experiences/${first.experimentId}`,
      {
        paywall_id: second.workflowId,
        name: "Cross-project overwrite",
        variants: [{
          key: "attacker",
          version_id: second.versionId,
          weight: 100,
        }],
      },
    );
    expect(attack.status).toBe(404);

    const retained = await responseData<{
      variants: Array<{ key: string; version_id: string }>;
    }>(
      await projectRequest(
        firstProject,
        "GET",
        `/internal/v1/legacy/paywalls/experiences/${first.experimentId}`,
      ),
    );
    expect(retained.variants).toEqual([
      expect.objectContaining({ key: "control", version_id: first.versionId }),
    ]);
  });

  it("projects the same client event id independently for two projects", async () => {
    await provision(firstProject);
    await provision(secondProject);
    const firstEvent = queueEvent(firstProject, "shared-client-event");
    const secondEvent = queueEvent(secondProject, "shared-client-event");
    const acknowledgements: string[] = [];

    await consumeFlowEvents(
      queueBatch([
        queueMessage("first", firstEvent, acknowledgements),
        queueMessage("second", secondEvent, acknowledgements),
      ]),
      env,
    );

    await vi.waitFor(async () => {
      const projected = await env.DB.prepare(
        `SELECT project_id, event_id FROM flow_analytics_events
         WHERE event_id = ? ORDER BY project_id`,
      ).bind("shared-client-event").all<{ project_id: number; event_id: string }>();
      expect(projected.results).toEqual([
        { project_id: firstProject.projectId, event_id: "shared-client-event" },
        { project_id: secondProject.projectId, event_id: "shared-client-event" },
      ]);
    });
    expect(acknowledgements).toEqual(["first", "second"]);
    const receipts = await env.DB.prepare(
      `SELECT project_id FROM flow_outbox_receipts
       WHERE event_id = ? ORDER BY project_id`,
    ).bind("shared-client-event").all<{ project_id: number }>();
    expect(receipts.results).toEqual([
      { project_id: firstProject.projectId },
      { project_id: secondProject.projectId },
    ]);
  });

  it("never lets a late old delivery overwrite a newer workflow state", async () => {
    await provision(firstProject);
    const environment = await env.DB.prepare(
      "SELECT id FROM flow_environments WHERE project_id = ? LIMIT 1",
    ).bind(firstProject.projectId).first<{ id: string }>();
    expect(environment).not.toBeNull();
    await env.DB.prepare(
      `INSERT INTO flow_workflows
        (id, project_id, identifier, name, frequency, status, origin,
         draft_revision, created_by, created_at, updated_at)
       VALUES ('workflow-ordering', ?, 'workflow-ordering', 'Ordering',
         'once', 'active', 'flows', 1, '2', ?, ?)`,
    ).bind(
      firstProject.projectId,
      "2026-08-13T11:00:00.000Z",
      "2026-08-13T11:00:00.000Z",
    ).run();
    const recent = runtimeStateEvent(
      "recent-event",
      "2026-08-13T13:00:00.000Z",
      "completed",
      environment!.id,
    );
    const old = runtimeStateEvent(
      "old-event",
      "2026-08-13T12:00:00.000Z",
      "in-progress",
      environment!.id,
    );
    await consumeFlowEvents(
      queueBatch([
        queueMessage("recent", recent, []),
        queueMessage("late-old", old, []),
        queueMessage("recent-redelivery", recent, []),
      ]),
      env,
    );
    const state = await env.DB.prepare(
      `SELECT state, updated_at FROM flow_user_workflow_states
       WHERE project_id = ? AND environment_id = ?
         AND user_id_hash = ? AND workflow_id = ?`,
    ).bind(
      recent.projectId,
      recent.environmentId,
      recent.userIdHash,
      recent.workflowId,
    ).first<{ state: string; updated_at: string }>();
    expect(state).toEqual({
      state: "completed",
      updated_at: recent.occurredAt,
    });
  });

  it("uses generation and revision when transitions share the same timestamp", async () => {
    await provision(firstProject);
    const environment = await env.DB.prepare(
      "SELECT id FROM flow_environments WHERE project_id = ? LIMIT 1",
    ).bind(firstProject.projectId).first<{ id: string }>();
    const workflowId = `workflow-sequence-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO flow_workflows
        (id, project_id, identifier, name, frequency, status, origin,
         draft_revision, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'Sequence', 'once', 'active', 'flows', 1, '2', ?, ?)`,
    ).bind(
      workflowId,
      firstProject.projectId,
      workflowId,
      "2026-08-13T11:00:00.000Z",
      "2026-08-13T11:00:00.000Z",
    ).run();
    const timestamp = "2026-08-13T14:00:00.000Z";
    const newer = runtimeStateEvent(
      "same-time-revision-2",
      timestamp,
      "completed",
      environment!.id,
      { workflowId, generation: 3, revision: 2 },
    );
    const older = runtimeStateEvent(
      "same-time-revision-1",
      timestamp,
      "in-progress",
      environment!.id,
      { workflowId, generation: 3, revision: 1 },
    );
    await consumeFlowEvents(
      queueBatch([
        queueMessage("same-time-newer", newer, []),
        queueMessage("same-time-older", older, []),
      ]),
      env,
    );
    await expect(env.DB.prepare(
      `SELECT state, generation, revision FROM flow_user_workflow_states
       WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?
         AND workflow_id = ?`,
    ).bind(
      firstProject.projectId,
      environment!.id,
      newer.userIdHash,
      workflowId,
    ).first()).resolves.toEqual({ state: "completed", generation: 3, revision: 2 });
  });
});

type Project = typeof firstProject | typeof secondProject;

async function createLegacyExperiment(project: Project, suffix: string) {
  await provision(project);
  const workflow = await responseData<{ id: string }>(
    await projectRequest(project, "POST", "/internal/v1/legacy/paywalls/paywalls", {
      identifier: `paywall-${suffix}`,
      display_name: `Paywall ${suffix}`,
    }),
  );
  const version = await responseData<{ id: string }>(
    await projectRequest(
      project,
      "POST",
      `/internal/v1/legacy/paywalls/paywalls/${workflow.id}/versions`,
      { definition: { schema_version: 1, components: [] } },
    ),
  );
  await responseData(
    await projectRequest(
      project,
      "POST",
      `/internal/v1/legacy/paywalls/paywalls/${workflow.id}/versions/${version.id}/publish`,
      {},
    ),
  );
  const experiment = await responseData<{ id: string }>(
    await projectRequest(project, "POST", "/internal/v1/legacy/paywalls/experiences", {
      paywall_id: workflow.id,
      name: `Experiment ${suffix}`,
      variants: [{ key: "control", version_id: version.id, weight: 100 }],
    }),
  );
  return {
    workflowId: workflow.id,
    versionId: version.id,
    experimentId: experiment.id,
  };
}

async function provision(project: Project): Promise<void> {
  await responseData(
    await projectRequest(
      project,
      "GET",
      `/internal/v1/projects/${project.projectRef}/project`,
    ),
  );
}

async function projectRequest(
  project: Project,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const headers = await projectHeaders(project, method, path);
  if (body !== undefined) headers.set("content-type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
    headers.set("idempotency-key", crypto.randomUUID());
  }
  return SELF.fetch(`https://flows.internal${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function projectHeaders(
  project: Project,
  method: string,
  pathname: string,
): Promise<Headers> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const requestId = crypto.randomUUID();
  const context = {
    module: "flows" as const,
    method,
    pathname,
    ...project,
    environment: "test" as const,
    actorId: 2,
    role: "owner",
    requestId,
    issuedAt,
  };
  return new Headers({
    "x-internal-token": secret,
    "x-project-id": String(project.projectId),
    "x-project-ref": project.projectRef,
    "x-instance-id": String(project.instanceId),
    "x-environment": "test",
    "x-actor-id": "2",
    "x-role": "owner",
    "x-request-id": requestId,
    "x-context-issued-at": String(issuedAt),
    "x-context-version": "1",
    "x-context-signature": await signProjectContext(context, secret),
  });
}

function queueEvent(project: Project, eventId: string): FlowQueueEvent {
  return {
    schemaVersion: 1,
    eventId,
    projectId: project.projectId,
    projectRef: project.projectRef,
    environmentId: `environment-${project.projectId}`,
    userIdHash: String(project.projectId % 10).repeat(64),
    name: "identify",
    occurredAt: "2026-08-13T12:00:00.000Z",
  };
}

function runtimeStateEvent(
  eventId: string,
  occurredAt: string,
  state: "in-progress" | "completed",
  environmentId: string,
  sequence: { workflowId?: string; generation?: number; revision?: number } = {},
): FlowQueueEvent {
  return {
    ...queueEvent(firstProject, eventId),
    occurredAt,
    environmentId,
    workflowId: sequence.workflowId ?? "workflow-ordering",
    workflowVersionId: "version-1",
    properties: {
      __runtime_state: {
        state,
        activeBlockIds: state === "completed" ? [] : ["card"],
        enteredAt: "2026-08-13T11:00:00.000Z",
        exitedAt: state === "completed" ? occurredAt : null,
        generation: sequence.generation ?? 1,
        revision: sequence.revision ?? (state === "completed" ? 2 : 1),
      },
    },
  };
}

function queueBatch(messages: Message<unknown>[]): MessageBatch<unknown> {
  return {
    queue: "superboard-flows-template-events",
    messages,
    metadata: { metrics: { backlogCount: messages.length, backlogBytes: 0 } },
    ackAll() {},
    retryAll() {},
  };
}

function queueMessage(
  id: string,
  body: FlowQueueEvent,
  acknowledgements: string[],
): Message<unknown> {
  return {
    id,
    timestamp: new Date(),
    body,
    attempts: 1,
    ack: () => acknowledgements.push(id),
    retry() {},
  };
}

async function responseData<T>(response: Response): Promise<T> {
  expect(response.status).toBeLessThan(300);
  return ((await response.json()) as { data: T }).data;
}
