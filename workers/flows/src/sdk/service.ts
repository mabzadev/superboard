import type {
  FlowGraph,
  FlowEditorBlock,
  FlowQueueEvent,
  FlowSdkEvent,
  FlowSurveyQuestionResponse,
  FlowSurveySubmission,
  FlowWorkflowMigrationStrategy,
} from "@superboard/contracts/flows";
import { failure } from "../http/errors";
import {
  parseSdkBlocksRequest,
  parseSdkEvent,
  parseSurveySubmission,
  readJsonObject,
} from "../http/validation";
import { flowHubName, flowRuntimeName } from "../runtime/names";
import {
  decryptFlowValue,
  encryptFlowValue,
  hashFlowUserId,
} from "../services/crypto";
import type { Env, FlowRuntimeSnapshot } from "../types";
import { matchesTargeting, personalizeValue } from "../runtime/targeting";
import {
  invalidSdkCredential,
  readFlowSdkCredential,
  verifyFlowSdkKey,
} from "./auth";
import { applyPersistedExperimentAssignments } from "../services/experiments";

type SdkTenant = {
  projectId: number;
  projectRef: string;
  environmentId: string;
  environmentKey: string;
};

type Release = {
  workflowId: string;
  workflowVersionId: string;
  frequency: "once" | "every-time";
  migrationStrategy: FlowWorkflowMigrationStrategy;
  graph: FlowGraph;
  launchpadGroups: Array<{
    groupId: string;
    position: number;
    priority: number;
    paused: boolean;
    concurrency: number | null;
  }>;
  launchpadAssignedGroupId?: string;
};

type ReleaseWithSnapshot = Release & { snapshot: FlowRuntimeSnapshot | null };

export async function sdkBlocks(request: Request, env: Env): Promise<Response> {
  const input = parseSdkBlocksRequest(await readJsonObject(request));
  const context = await sdkContext(request, env, input);
  const releases = await loadReleases(env, context, input.language);
  const runtime = env.FLOW_USER_RUNTIME.getByName(context.runtimeName);
  const withSnapshots = await loadSnapshots(env, context, runtime, releases);
  const eligible = selectLaunchpadReleases(
    withSnapshots,
    input.userProperties ?? {},
  );
  await upsertSdkUser(env, context, input.userProperties ?? {}, input.language);
  await persistLaunchpadAssignments(env, context, eligible);
  const blocks = [];
  const snapshots: FlowRuntimeSnapshot[] = [];
  for (const release of eligible) {
    const snapshot = await executeRelease(runtime, context, release, {
      eventId: crypto.randomUUID(),
      name: "identify",
      userProperties: input.userProperties ?? {},
    });
    snapshots.push(snapshot);
    blocks.push(...snapshot.updatedBlocks);
  }
  const triggered = await resolveWorkflowTriggers(
    runtime,
    context,
    releases,
    snapshots,
    crypto.randomUUID(),
  );
  blocks.push(...triggered.flatMap((snapshot) => snapshot.updatedBlocks));
  return json({
    blocks: deduplicateBlocks(blocks),
  });
}

export async function sdkWorkflows(request: Request, env: Env): Promise<Response> {
  const body = await readJsonObject(request);
  const input = parseSdkBlocksRequest(body);
  const context = await sdkContext(request, env, input);
  const runtime = env.FLOW_USER_RUNTIME.getByName(context.runtimeName);
  const releases = await loadReleases(env, context);
  const withSnapshots = await loadSnapshots(env, context, runtime, releases);
  return json({
    workflows: withSnapshots.map((release) => ({
      id: release.workflowId,
      workflow_status: release.launchpadGroups.length
        ? "launchpad-enabled"
        : "enabled",
      frequency: release.frequency,
      user_state: release.snapshot?.state ?? "not-started",
      ...(release.snapshot?.enteredAt
        ? { entered_at: release.snapshot.enteredAt }
        : {}),
      ...(release.snapshot?.exitedAt
        ? { exited_at: release.snapshot.exitedAt }
        : {}),
    })),
  });
}

export async function sdkEvent(request: Request, env: Env): Promise<Response> {
  const input = parseSdkEvent(await readJsonObject(request));
  const context = await sdkContext(request, env, input);
  const runtime = env.FLOW_USER_RUNTIME.getByName(context.runtimeName);
  const baseEventId = requestEventId(request, input.eventId);
  if (input.name === "reset-progress") {
    if (input.workflowId) {
      const workflow = await env.DB.prepare(
        `SELECT 1 FROM flow_workflows
         WHERE project_id = ? AND id = ? AND status != 'archived'`,
      ).bind(context.tenant.projectId, input.workflowId).first();
      if (!workflow) {
        throw failure("flow_workflow_not_found", "Workflow not found", 404);
      }
    }
    const reset = await runtime.resetProgress({
      eventId: baseEventId,
      projectId: context.tenant.projectId,
      projectRef: context.tenant.projectRef,
      environmentId: context.tenant.environmentId,
      userIdHash: context.userIdHash,
      ...(input.workflowId ? { workflowIds: [input.workflowId] } : {}),
    });
    await env.DB.prepare(
      `DELETE FROM flow_user_workflow_states
       WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?
         AND (? IS NULL OR workflow_id = ?)`,
    ).bind(
      context.tenant.projectId,
      context.tenant.environmentId,
      context.userIdHash,
      input.workflowId ?? null,
      input.workflowId ?? null,
    ).run();
    return json({
      success: true,
      duplicate: reset.duplicate === true,
      exitedBlockIds: [],
      updatedBlocks: [],
    });
  }
  const releases = await loadReleases(env, context, input.locale);
  const selected = releases.filter((release) =>
    input.workflowId
      ? release.workflowId === input.workflowId
      : input.blockId || input.blockKey
        ? release.graph.blocks.some(
            (block) =>
              block.id === input.blockId || block.key === input.blockKey,
          )
        : input.name === "reset-progress",
  );
  if (input.workflowId && !selected.length) {
    throw failure("flow_workflow_not_active", "Workflow is not active", 404);
  }
  if (!selected.length && input.name !== "identify") {
    throw failure(
      "flow_event_target_not_found",
      "No active workflow accepts this event",
      404,
    );
  }
  const snapshots: FlowRuntimeSnapshot[] = [];
  for (const release of selected) {
    validateTourUpdate(input, release.graph);
    snapshots.push(
      await executeRelease(runtime, context, release, {
        eventId: `${baseEventId}:${release.workflowId}`,
        name: input.name,
        blockId: input.blockId,
        blockStateId: input.blockStateId,
        blockKey: input.blockKey,
        propertyKey: input.propertyKey,
        properties: input.properties,
        userProperties: {},
      }),
    );
  }
  snapshots.push(
    ...(await resolveWorkflowTriggers(
      runtime,
      context,
      releases,
      snapshots,
      baseEventId,
    )),
  );
  return json({
    success: true,
    duplicate: snapshots.length > 0 && snapshots.every((item) => item.duplicate),
    exitedBlockIds: snapshots.flatMap((item) => item.exitedBlockIds),
    updatedBlocks: deduplicateBlocks(
      snapshots.flatMap((item) => item.updatedBlocks),
    ),
  });
}

function validateTourUpdate(input: FlowSdkEvent, graph: FlowGraph): void {
  if (input.name !== "tour-update") return;
  const block = input.blockId
    ? graph.blocks.find((entry) => entry.id === input.blockId)
    : graph.blocks.find((entry) => entry.key === input.blockKey);
  const index = input.properties?.currentTourIndex;
  const steps = block && Array.isArray(block.data.steps)
    ? block.data.steps
    : block && Array.isArray(block.data.screens)
      ? block.data.screens
      : [];
  if (
    !block ||
    (block.type !== "tour" && block.type !== "tour-component") ||
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    (steps.length > 0 && index >= steps.length)
  ) {
    throw failure(
      "flow_tour_update_invalid",
      "Tour update must target an active tour and a valid step index",
      422,
    );
  }
}

export async function sdkSurvey(request: Request, env: Env): Promise<Response> {
  const input = parseSurveySubmission(await readJsonObject(request));
  const context = await sdkContext(request, env, input);
  const runtime = env.FLOW_USER_RUNTIME.getByName(context.runtimeName);
  const releases = await loadReleases(env, context);
  const release = releases.find((entry) =>
    input.workflowId
      ? entry.workflowId === input.workflowId
      : entry.graph.blocks.some(
          (block) =>
            block.id === input.blockId || block.id === input.surveyId,
        ),
  );
  if (!release) {
    throw failure("flow_survey_not_active", "Survey is not active", 404);
  }
  const surveyBlock = release.graph.blocks.find(
    (block) =>
      block.type === "survey" &&
      (block.id === input.blockId || block.id === input.surveyId),
  );
  if (!surveyBlock) {
    throw failure(
      "flow_survey_block_invalid",
      "Survey submission must target an active survey block",
      422,
    );
  }
  validateSurveyAnswers(surveyBlock, input.questions);
  const eventId = `${requestEventId(
    request,
    input.eventId ?? `survey-submit:${input.blockStateId}`,
  )}:${release.workflowId}`;
  const snapshot = await executeRelease(runtime, context, release, {
    eventId,
    name: "survey-submit",
    blockId: input.blockId ?? input.surveyId,
    blockStateId: input.blockStateId,
    userProperties: {},
    surveyResponse: input,
  });
  return json({ success: true, duplicate: snapshot.duplicate });
}

function validateSurveyAnswers(
  block: FlowEditorBlock,
  answers: readonly FlowSurveyQuestionResponse[],
): void {
  const questions = block.surveyQuestions ?? [];
  if (!questions.length) return;
  const answerByQuestion = new Map<string, FlowSurveyQuestionResponse>();
  for (const answer of answers) {
    if (answerByQuestion.has(answer.questionId)) {
      throw failure(
        "flow_survey_answer_duplicate",
        "A survey question may only be answered once",
        422,
      );
    }
    answerByQuestion.set(answer.questionId, answer);
  }
  const definitions = new Map(questions.map((question) => [question.id, question]));
  for (const answer of answers) {
    if (!definitions.has(answer.questionId)) {
      throw failure(
        "flow_survey_question_unknown",
        "Survey response contains an unknown question",
        422,
      );
    }
  }
  for (const question of questions) {
    const answer = answerByQuestion.get(question.id);
    const answered = Boolean(
      answer &&
        ((answer.textResponse?.trim().length ?? 0) > 0 ||
          (answer.optionIds?.length ?? 0) > 0 ||
          answer.otherSelected ||
          answer.clickedLink),
    );
    if (
      !question.optional &&
      question.type !== "end-screen" &&
      !answered
    ) {
      throw failure(
        "flow_survey_answer_required",
        `Survey question ${question.id} requires an answer`,
        422,
      );
    }
    if (!answer) continue;
    if (question.type === "rating" && answer.textResponse) {
      const rating = Number(answer.textResponse);
      if (
        !Number.isFinite(rating) ||
        (question.minValue != null && rating < question.minValue) ||
        (question.maxValue != null && rating > question.maxValue)
      ) {
        throw failure(
          "flow_survey_rating_invalid",
          `Survey rating ${question.id} is outside its configured range`,
          422,
        );
      }
    }
    if (
      question.type === "single-choice" ||
      question.type === "multiple-choice"
    ) {
      const optionIds = answer.optionIds ?? [];
      if (new Set(optionIds).size !== optionIds.length) {
        throw failure(
          "flow_survey_option_duplicate",
          "Survey option ids must be unique",
          422,
        );
      }
      if (question.type === "single-choice" && optionIds.length > 1) {
        throw failure(
          "flow_survey_single_choice_invalid",
          "Single choice questions accept at most one option",
          422,
        );
      }
      const configuredOptions = new Set(
        (question.options ?? []).map((option) => option.id),
      );
      if (optionIds.some((optionId) => !configuredOptions.has(optionId))) {
        throw failure(
          "flow_survey_option_unknown",
          "Survey response contains an unknown option",
          422,
        );
      }
      if (answer.otherSelected && !question.otherOption) {
        throw failure(
          "flow_survey_other_forbidden",
          "The Other option is not enabled for this question",
          422,
        );
      }
    }
  }
}

export async function sdkWebSocket(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw failure("flow_websocket_upgrade_required", "WebSocket upgrade required", 422);
  }
  const url = new URL(request.url);
  const input = parseSdkBlocksRequest({
    projectId: url.searchParams.get("projectId"),
    environment: url.searchParams.get("environment"),
    userId: url.searchParams.get("userId"),
  });
  const context = await sdkContext(request, env, input);
  const hubName = flowHubName(
    context.tenant.projectId,
    context.tenant.environmentId,
    context.userIdHash,
  );
  return env.FLOW_REALTIME_HUB.getByName(hubName).fetch(
    new Request("https://flows-hub.internal/connect", {
      headers: {
        Upgrade: "websocket",
        "x-flow-hub-capability": env.INTERNAL_API_TOKEN,
        "x-flow-user-id-hash": context.userIdHash,
      },
    }),
  );
}

async function sdkContext(
  request: Request,
  env: Env,
  input: { projectId: string; environment: string; userId: string },
) {
  const credential = readFlowSdkCredential(request, input.projectId);
  const tenant = await resolveTenant(
    env,
    credential.projectIdentifier,
    input.environment,
    credential.sdkKey,
  );
  const userIdHash = await hashFlowUserId(
    env,
    tenant.projectRef,
    input.userId,
  );
  return {
    env,
    tenant,
    userIdHash,
    externalUserId: input.userId,
    runtimeName: flowRuntimeName(
      tenant.projectId,
      tenant.environmentId,
      userIdHash,
    ),
  };
}

async function resolveTenant(
  env: Env,
  projectIdentifier: string,
  environmentKey: string,
  sdkKey: string,
): Promise<SdkTenant> {
  const row = await env.DB.prepare(
    `SELECT p.project_id, p.project_ref,
      e.id AS environment_id, e.key AS environment_key, e.sdk_key_hash
     FROM flow_projects p
     JOIN flow_environments e
       ON e.project_id = p.project_id
     WHERE (p.project_ref = ? OR p.sdk_identifier = ?)
       AND e.key = ? AND e.active = 1
     LIMIT 1`,
  )
    .bind(projectIdentifier, projectIdentifier, environmentKey)
    .first<{
      project_id: number;
      project_ref: string;
      environment_id: string;
      environment_key: string;
      sdk_key_hash: string;
    }>();
  if (!(await verifyFlowSdkKey(sdkKey, row?.sdk_key_hash))) {
    throw invalidSdkCredential();
  }
  if (!row) throw invalidSdkCredential();
  return {
    projectId: Number(row.project_id),
    projectRef: row.project_ref,
    environmentId: row.environment_id,
    environmentKey: row.environment_key,
  };
}

async function loadReleases(
  env: Env,
  context: Awaited<ReturnType<typeof sdkContext>>,
  locale?: string,
): Promise<Release[]> {
  const rows = await env.DB.prepare(
    `SELECT w.id AS workflow_id, w.frequency,
      CASE WHEN r.use_draft = 1
        THEN 'draft:' || CAST(d.revision AS TEXT)
        ELSE v.id END AS workflow_version_id,
      r.use_draft,
      CASE WHEN r.use_draft = 1 THEN d.graph_json ELSE v.graph_json END AS graph_json,
      CASE WHEN r.use_draft = 1 THEN 'finish-current'
        ELSE COALESCE(v.migration_strategy, 'finish-current')
      END AS migration_strategy
     FROM flow_environment_releases r
     JOIN flow_workflows w
       ON w.id = r.workflow_id AND w.project_id = r.project_id
     LEFT JOIN flow_workflow_drafts d ON d.workflow_id = r.workflow_id
     LEFT JOIN flow_workflow_versions v ON v.id = r.workflow_version_id
     WHERE r.project_id = ? AND r.environment_id = ?
       AND r.active = 1 AND w.status = 'active'
       AND ((r.use_draft = 1 AND d.graph_json IS NOT NULL)
         OR (r.use_draft = 0 AND v.graph_json IS NOT NULL))
     ORDER BY w.created_at, w.id`,
  )
    .bind(
      context.tenant.projectId,
      context.tenant.environmentId,
    )
    .all<{
      workflow_id: string;
      workflow_version_id: string;
      frequency: "once" | "every-time";
      graph_json: string;
      migration_strategy: FlowWorkflowMigrationStrategy;
      use_draft: number;
    }>();
  const associations = await env.DB.prepare(
    `SELECT lw.workflow_id, g.id AS group_id, g.position, lw.priority,
      g.paused, g.concurrency_limit
     FROM flow_launchpad_groups g
     JOIN flow_launchpad_workflows lw ON lw.group_id = g.id
     WHERE g.project_id = ? AND g.environment_id = ?
     ORDER BY g.position, lw.priority DESC, g.id`,
  )
    .bind(
      context.tenant.projectId,
      context.tenant.environmentId,
    )
    .all<{
      workflow_id: string;
      group_id: string;
      position: number;
      priority: number;
      paused: number;
      concurrency_limit: number | null;
    }>();
  const assignments = await env.DB.prepare(
    `SELECT workflow_id, group_id FROM flow_launchpad_assignments
     WHERE project_id = ? AND environment_id = ? AND user_id_hash = ?`,
  ).bind(
    context.tenant.projectId,
    context.tenant.environmentId,
    context.userIdHash,
  ).all<{ workflow_id: string; group_id: string }>();
  const assignmentByWorkflow = new Map(
    assignments.results.map((row) => [row.workflow_id, row.group_id]),
  );
  const groupsByWorkflow = new Map<
    string,
    Array<(typeof associations.results)[number]>
  >();
  for (const row of associations.results) {
    const groups = groupsByWorkflow.get(row.workflow_id) ?? [];
    groups.push(row);
    groupsByWorkflow.set(row.workflow_id, groups);
  }
  const translations = await loadTranslations(
    env,
    context,
    locale,
  );
  const releases = rows.results.map((row) => {
    const groups = groupsByWorkflow.get(row.workflow_id) ?? [];
    const graph = JSON.parse(row.graph_json) as FlowGraph;
    return {
      workflowId: row.workflow_id,
      workflowVersionId: row.workflow_version_id,
      frequency: row.frequency,
      migrationStrategy: row.migration_strategy,
      graph: applyTranslationsAndPersonalization(
        graph,
        translations.get(`${row.workflow_id}:${row.workflow_version_id}`),
        undefined,
      ),
      launchpadGroups: groups.map((group) => ({
        groupId: group.group_id,
        position: Number(group.position),
        priority: Number(group.priority),
        paused: Boolean(group.paused),
        concurrency:
          group.concurrency_limit == null
            ? null
          : Number(group.concurrency_limit),
      })),
      ...(groups.some(
        (group) => group.group_id === assignmentByWorkflow.get(row.workflow_id),
      )
        ? { launchpadAssignedGroupId: assignmentByWorkflow.get(row.workflow_id)! }
        : {}),
    };
  });
  const assignedGraphs = await applyPersistedExperimentAssignments(
    env,
    context.tenant.projectId,
    context.tenant.environmentId,
    context.userIdHash,
    context.externalUserId,
    releases,
  );
  return releases.map((release) => ({
    ...release,
    graph: assignedGraphs.get(release.workflowId) ?? release.graph,
  }));
}

async function loadSnapshots(
  env: Env,
  context: Awaited<ReturnType<typeof sdkContext>>,
  runtime: DurableObjectStub<import("../runtime/user-runtime").FlowUserRuntime>,
  releases: Release[],
): Promise<ReleaseWithSnapshot[]> {
  const snapshots = await Promise.all(
    releases.map((release) => runtime.getSnapshot(release.workflowId)),
  );
  const missing = releases.filter((_release, index) => !snapshots[index]);
  if (missing.length) {
    const placeholders = missing.map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT s.workflow_id, s.workflow_version_id, s.state,
        s.active_block_ids_json, s.entered_at, s.exited_at, s.updated_at,
        s.tour_indexes_json, s.generation, s.revision,
        v.graph_json AS version_graph_json
       FROM flow_user_workflow_states s
       LEFT JOIN flow_workflow_versions v
         ON v.project_id = s.project_id AND v.id = s.workflow_version_id
       WHERE s.project_id = ? AND s.environment_id = ?
         AND s.user_id_hash = ? AND s.workflow_id IN (${placeholders})`,
    ).bind(
      context.tenant.projectId,
      context.tenant.environmentId,
      context.userIdHash,
      ...missing.map((release) => release.workflowId),
    ).all<{
      workflow_id: string;
      workflow_version_id: string | null;
      state: FlowRuntimeSnapshot["state"];
      active_block_ids_json: string;
      entered_at: string | null;
      exited_at: string | null;
      updated_at: string;
      generation: number;
      revision: number;
      tour_indexes_json: string;
      version_graph_json: string | null;
    }>();
    const byWorkflow = new Map(rows.results.map((row) => [row.workflow_id, row]));
    await Promise.all(
      releases.map(async (release, index) => {
        if (snapshots[index]) return;
        const row = byWorkflow.get(release.workflowId);
        if (!row) return;
        const graph = row.version_graph_json
          ? (JSON.parse(row.version_graph_json) as FlowGraph)
          : release.graph;
        snapshots[index] = await runtime.bootstrapProjection({
          workflowId: release.workflowId,
          workflowVersionId: row.workflow_version_id ?? release.workflowVersionId,
          state: row.state,
          activeBlockIds: parseStringList(row.active_block_ids_json),
          tourIndexes: parseNumberMap(row.tour_indexes_json),
          graph,
          ...(row.entered_at ? { enteredAt: row.entered_at } : {}),
          ...(row.exited_at ? { exitedAt: row.exited_at } : {}),
          updatedAt: row.updated_at,
          generation: Number(row.generation ?? 1),
          revision: Number(row.revision ?? 0),
          userProperties: {},
        });
      }),
    );
  }
  return releases.map((release, index) => ({
    ...release,
    snapshot: snapshots[index] ?? null,
  }));
}

export function selectLaunchpadReleases(
  releases: ReleaseWithSnapshot[],
  userProperties: Readonly<Record<string, unknown>> = {},
): ReleaseWithSnapshot[] {
  const selected = releases.filter((release) => !release.launchpadGroups.length);
  const selectedIds = new Set(selected.map((release) => release.workflowId));
  const groups = new Map<
    string,
    { membership: Release["launchpadGroups"][number]; releases: ReleaseWithSnapshot[] }
  >();
  for (const release of releases) {
    for (const membership of release.launchpadGroups) {
      const group = groups.get(membership.groupId) ?? { membership, releases: [] };
      group.releases.push(release);
      groups.set(membership.groupId, group);
    }
  }
  const ordered = [...groups.values()].sort(
    (left, right) =>
      left.membership.position - right.membership.position,
  );
  for (const group of ordered) {
    const running = group.releases.filter(
      (release) => {
        const persistedAssignmentIsCurrent = release.launchpadGroups.some(
          (membership) => membership.groupId === release.launchpadAssignedGroupId,
        );
        const assignedGroupId = (persistedAssignmentIsCurrent
          ? release.launchpadAssignedGroupId
          : undefined) ??
          release.launchpadGroups.find((membership) => !membership.paused)?.groupId ??
          release.launchpadGroups[0]?.groupId;
        return release.snapshot?.state === "in-progress" &&
          !selectedIds.has(release.workflowId) &&
          assignedGroupId === group.membership.groupId;
      },
    );
    selected.push(...running.map((release) => ({
      ...release,
      launchpadAssignedGroupId: group.membership.groupId,
    })));
    for (const release of running) selectedIds.add(release.workflowId);
    if (group.membership.paused) continue;
    const limit = group.membership.concurrency;
    let capacity = limit == null ? Number.POSITIVE_INFINITY : Math.max(0, limit - running.length);
    for (const release of group.releases
      .filter((entry) =>
        !selectedIds.has(entry.workflowId) &&
        entry.snapshot?.state !== "in-progress" &&
        !(
          entry.frequency === "once" &&
          (entry.snapshot?.state === "completed" || entry.snapshot?.state === "stopped")
        ) &&
        canAutomaticallyStart(entry.graph, userProperties)
      )
      .sort(
        (left, right) =>
          membershipPriority(right, group.membership.groupId) -
          membershipPriority(left, group.membership.groupId),
      )) {
      if (capacity <= 0) break;
      selected.push({
        ...release,
        launchpadAssignedGroupId: group.membership.groupId,
      });
      selectedIds.add(release.workflowId);
      capacity -= 1;
    }
  }
  return selected;
}

async function persistLaunchpadAssignments(
  env: Env,
  context: Awaited<ReturnType<typeof sdkContext>>,
  releases: ReleaseWithSnapshot[],
): Promise<void> {
  const assigned = releases.filter((release) => release.launchpadAssignedGroupId);
  if (!assigned.length) return;
  const now = new Date().toISOString();
  await env.DB.batch(assigned.map((release) => env.DB.prepare(
    `INSERT INTO flow_launchpad_assignments
      (project_id, environment_id, user_id_hash, workflow_id, group_id, assigned_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, environment_id, user_id_hash, workflow_id)
     DO UPDATE SET group_id = excluded.group_id, assigned_at = excluded.assigned_at`,
  ).bind(
    context.tenant.projectId,
    context.tenant.environmentId,
    context.userIdHash,
    release.workflowId,
    release.launchpadAssignedGroupId,
    now,
  )));
}

function membershipPriority(release: Release, groupId: string): number {
  return release.launchpadGroups.find((group) => group.groupId === groupId)?.priority ?? 0;
}

function canAutomaticallyStart(
  graph: FlowGraph,
  userProperties: Readonly<Record<string, unknown>>,
): boolean {
  return graph.blocks.some(
    (block) => block.type === "start" && matchesTargeting(block.conditions, userProperties),
  );
}

async function executeRelease(
  runtime: DurableObjectStub<import("../runtime/user-runtime").FlowUserRuntime>,
  context: Awaited<ReturnType<typeof sdkContext>>,
  release: Release,
  input: {
    eventId: string;
    name: FlowSdkEvent["name"];
    blockId?: string;
    blockStateId?: string;
    blockKey?: string;
    propertyKey?: string;
    properties?: Record<string, unknown>;
    userProperties: Record<string, unknown>;
    surveyResponse?: FlowSurveySubmission;
  },
): Promise<FlowRuntimeSnapshot> {
  const event: FlowQueueEvent = {
    schemaVersion: 1,
    eventId: input.eventId,
    projectId: context.tenant.projectId,
    projectRef: context.tenant.projectRef,
    environmentId: context.tenant.environmentId,
    userIdHash: context.userIdHash,
    name: input.name,
    occurredAt: new Date().toISOString(),
    workflowId: release.workflowId,
    workflowVersionId: release.workflowVersionId,
    ...(input.blockId ? { blockId: input.blockId } : {}),
    ...(input.blockStateId ? { blockStateId: input.blockStateId } : {}),
    ...(input.blockKey ? { blockKey: input.blockKey } : {}),
    ...(input.propertyKey ? { propertyKey: input.propertyKey } : {}),
    ...(input.properties ? { properties: input.properties } : {}),
    ...(input.surveyResponse
      ? {
          surveyResponse: {
            eventId: input.surveyResponse.eventId,
            surveyId: input.surveyResponse.surveyId,
            blockStateId: input.surveyResponse.blockStateId,
            workflowId: input.surveyResponse.workflowId,
            blockId: input.surveyResponse.blockId,
            url: input.surveyResponse.url,
            questions: input.surveyResponse.questions,
          },
        }
      : {}),
  };
  try {
    return await runtime.execute({
      event,
      graph: applyTranslationsAndPersonalization(
        release.graph,
        undefined,
        input.userProperties,
      ),
      frequency: release.frequency,
      migrationStrategy: release.migrationStrategy,
      userProperties: input.userProperties,
      // HTTP owns the synchronous trigger traversal below. The Durable Object
      // only self-orchestrates asynchronous wakes (Delay/Launchpad), otherwise
      // a target that completes immediately would transition its parent twice.
      resolveTriggers: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const runtimeCode = [
      "flow_runtime_block_not_active",
      "flow_runtime_survey_not_active",
      "flow_runtime_block_state_stale",
      "flow_runtime_block_state_required",
      "flow_runtime_idempotency_conflict",
    ].find((code) => message.includes(code));
    if (runtimeCode) {
      throw failure(runtimeCode, runtimeErrorMessage(runtimeCode), 409);
    }
    throw error;
  }
}

function runtimeErrorMessage(code: string): string {
  switch (code) {
    case "flow_runtime_block_not_active":
      return "The target block is no longer active";
    case "flow_runtime_survey_not_active":
      return "The survey is no longer active";
    case "flow_runtime_block_state_stale":
      return "The block state is stale";
    case "flow_runtime_idempotency_conflict":
      return "The idempotency key was already used for another command";
    default:
      return "The current block state is required";
  }
}

async function resolveWorkflowTriggers(
  runtime: DurableObjectStub<import("../runtime/user-runtime").FlowUserRuntime>,
  context: Awaited<ReturnType<typeof sdkContext>>,
  releases: Release[],
  initialSnapshots: FlowRuntimeSnapshot[],
  baseEventId: string,
): Promise<FlowRuntimeSnapshot[]> {
  const byId = new Map(releases.map((release) => [release.workflowId, release]));
  const initialIds = new Set(initialSnapshots.map((snapshot) => snapshot.workflowId));
  const completedTargets = new Set(
    initialSnapshots
      .filter((snapshot) => snapshot.state === "completed")
      .map((snapshot) => snapshot.workflowId),
  );
  const parentSnapshots = completedTargets.size
    ? (await loadSnapshots(
        context.env,
        context,
        runtime,
        releases.filter((release) => !initialIds.has(release.workflowId)),
      )).flatMap((release) => release.snapshot ? [release.snapshot] : [])
    : [];
  let snapshots = [...initialSnapshots, ...parentSnapshots];
  const resolved: FlowRuntimeSnapshot[] = [];
  for (let iteration = 0; iteration < 8; iteration += 1) {
    let progressed = false;
    const next: FlowRuntimeSnapshot[] = [];
    for (const snapshot of snapshots) {
      const release = byId.get(snapshot.workflowId);
      if (!release) continue;
      for (const blockId of snapshot.activeBlockIds) {
        const block = release.graph.blocks.find((entry) => entry.id === blockId);
        if (block?.type !== "workflow-trigger") continue;
        const targetId =
          typeof block.data.workflowId === "string"
            ? block.data.workflowId
            : null;
        const target = targetId ? byId.get(targetId) : undefined;
        if (!target) continue;
        const alreadyCompleted = completedTargets.has(target.workflowId);
        const targetSnapshot = alreadyCompleted
          ? initialSnapshots.find(
              (entry) => entry.workflowId === target.workflowId,
            )!
          : await executeRelease(runtime, context, target, {
              eventId: `${baseEventId}:trigger:${block.id}:${iteration}`,
              name: "workflow-start",
              blockKey: typeof block.data.blockKey === "string"
                ? block.data.blockKey
                : undefined,
              userProperties: {},
            });
        if (!alreadyCompleted) {
          next.push(targetSnapshot);
          resolved.push(targetSnapshot);
        }
        if (
          targetSnapshot.state === "completed" ||
          targetSnapshot.state === "stopped"
        ) {
          const exitedTrigger = await executeRelease(runtime, context, release, {
              eventId: `${baseEventId}:trigger-exit:${block.id}:${iteration}`,
              name: "transition",
              blockId: block.id,
              propertyKey: "workflow_completed",
              userProperties: {},
            });
          next.push(exitedTrigger);
          resolved.push(exitedTrigger);
        }
        progressed = true;
        if (alreadyCompleted) completedTargets.delete(target.workflowId);
      }
    }
    if (!progressed) break;
    snapshots = next;
  }
  return resolved;
}

async function upsertSdkUser(
  env: Env,
  context: Awaited<ReturnType<typeof sdkContext>>,
  properties: Record<string, unknown>,
  language?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    `SELECT properties_ciphertext FROM flow_users
     WHERE project_id = ? AND environment_id = ?
       AND user_id_hash = ?`,
  )
    .bind(
      context.tenant.projectId,
      context.tenant.environmentId,
      context.userIdHash,
    )
    .first<{ properties_ciphertext: string }>();
  const previousProperties = existing?.properties_ciphertext
    ? await decryptFlowValue<Record<string, unknown>>(
        env,
        existing.properties_ciphertext,
      )
    : {};
  const mergedProperties = { ...previousProperties, ...properties };
  const locale =
    language ??
    (typeof mergedProperties.locale === "string" ? mergedProperties.locale : null);
  await env.DB.prepare(
    `INSERT INTO flow_users
      (project_id, environment_id, user_id_hash,
       external_user_id_ciphertext, properties_ciphertext, locale, country,
       platform, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, environment_id, user_id_hash)
     DO UPDATE SET
       properties_ciphertext = excluded.properties_ciphertext,
       locale = excluded.locale,
       country = excluded.country,
       platform = excluded.platform,
       last_seen_at = excluded.last_seen_at`,
  )
    .bind(
      context.tenant.projectId,
      context.tenant.environmentId,
      context.userIdHash,
      await encryptFlowValue(env, context.externalUserId),
      await encryptFlowValue(env, mergedProperties),
      locale,
      typeof mergedProperties.country === "string" ? mergedProperties.country : null,
      typeof mergedProperties.platform === "string" ? mergedProperties.platform : null,
      now,
      now,
    )
    .run();
}

async function loadTranslations(
  env: Env,
  context: Awaited<ReturnType<typeof sdkContext>>,
  requestedLocale?: string,
): Promise<Map<string, Map<string, unknown>>> {
  const groups = await env.DB.prepare(
    `SELECT default_locale, locales_json, fallbacks_json
     FROM flow_language_groups
     WHERE project_id = ? ORDER BY created_at`,
  )
    .bind(context.tenant.projectId)
    .all<{
      default_locale: string;
      locales_json: string;
      fallbacks_json: string;
    }>();
  const defaultGroup = groups.results[0];
  const normalizedRequested = requestedLocale?.toLowerCase();
  const languagePrefix = normalizedRequested?.split("-")[0];
  const matchedGroup = groups.results.find((group) => {
    const configured = parseStringList(group.locales_json).map((locale) =>
      locale.toLowerCase()
    );
    return normalizedRequested != null &&
      (configured.includes(normalizedRequested) ||
        (languagePrefix != null && configured.includes(languagePrefix)));
  }) ?? defaultGroup;
  const fallbacks = parseRecord(matchedGroup?.fallbacks_json ?? "{}");
  const locales = [...new Set([
    requestedLocale,
    requestedLocale && typeof fallbacks[requestedLocale] === "string"
      ? String(fallbacks[requestedLocale])
      : null,
    matchedGroup?.default_locale,
    languagePrefix,
    defaultGroup?.default_locale ?? "en",
  ].filter((value): value is string => Boolean(value)))];
  const placeholders = locales.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT vt.workflow_id, vt.workflow_version_id AS release_version_id,
      vt.block_key, vt.property_key, vt.locale, vt.value_json
     FROM flow_version_translations vt
     JOIN flow_environment_releases r
       ON r.project_id = vt.project_id
         AND r.workflow_id = vt.workflow_id
         AND r.workflow_version_id = vt.workflow_version_id
     WHERE vt.project_id = ?
       AND r.environment_id = ? AND r.active = 1 AND r.use_draft = 0
       AND vt.locale IN (${placeholders})
     UNION ALL
     SELECT t.workflow_id,
       'draft:' || CAST(d.revision AS TEXT) AS release_version_id,
       t.block_key, t.property_key, t.locale, t.value_json
     FROM flow_translations t
     JOIN flow_environment_releases r
       ON r.project_id = t.project_id
         AND r.workflow_id = t.workflow_id
     JOIN flow_workflow_drafts d
       ON d.project_id = t.project_id
         AND d.workflow_id = t.workflow_id
     WHERE t.project_id = ?
       AND r.environment_id = ? AND r.active = 1 AND r.use_draft = 1
       AND t.locale IN (${placeholders})`,
  )
    .bind(
      context.tenant.projectId,
      context.tenant.environmentId,
      ...locales,
      context.tenant.projectId,
      context.tenant.environmentId,
      ...locales,
    )
    .all<{
      workflow_id: string;
      release_version_id: string;
      block_key: string;
      property_key: string;
      locale: string;
      value_json: string;
    }>();
  const byWorkflow = new Map<string, Map<string, unknown>>();
  for (const locale of [...locales].reverse()) {
    for (const row of rows.results.filter((entry) => entry.locale === locale)) {
      const releaseKey = `${row.workflow_id}:${row.release_version_id}`;
      const map = byWorkflow.get(releaseKey) ?? new Map<string, unknown>();
      map.set(`${row.block_key}.${row.property_key}`, parseUnknown(row.value_json));
      byWorkflow.set(releaseKey, map);
    }
  }
  return byWorkflow;
}

function applyTranslationsAndPersonalization(
  graph: FlowGraph,
  translations: Map<string, unknown> | undefined,
  properties: Readonly<Record<string, unknown>> | undefined,
): FlowGraph {
  return {
    ...graph,
    blocks: graph.blocks.map((block) => {
      const data = structuredClone(block.data);
      for (const [key, value] of translations ?? []) {
        const prefix = `${block.key}.`;
        if (!key.startsWith(prefix)) continue;
        setPath(data, key.slice(prefix.length), value);
      }
      return {
        ...block,
        data: properties && Object.keys(properties).length
          ? personalizeValue(data, properties) as Record<string, unknown>
          : data,
      };
    }),
  };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  const final = parts.at(-1);
  if (final) current[final] = value;
}

function requestEventId(request: Request, bodyEventId?: string): string {
  const value = request.headers.get("Idempotency-Key")?.trim() || bodyEventId;
  if (!value) return crypto.randomUUID();
  if (value.length > 192 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw failure("flow_idempotency_key_invalid", "Idempotency-Key is invalid", 422);
  }
  return value;
}

function deduplicateBlocks<T extends { id: string }>(blocks: T[]): T[] {
  return [...new Map(blocks.map((block) => [block.id, block])).values()];
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseStringList(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function parseNumberMap(value: string): Record<string, number> {
  const parsed = parseRecord(value);
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
    ),
  );
}

function parseUnknown(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
