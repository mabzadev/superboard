import {
  signProjectContext,
  type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  applyConversationSla,
  assignConversation,
  evaluateAppliedSla,
  initializeConversationPolicies,
  recordSlaMessage,
  recordSlaResolution,
} from "../src/service-levels";
import { claimScheduledSupportJobs } from "../src/index";

async function insertConversation(
  projectId: number,
  id: string,
  options: {
    inboxId?: string;
    assignedUserId?: string;
    priority?: string;
    status?: string;
    createdAt?: string;
  } = {},
) {
  await env.DB.prepare(
    `INSERT INTO conversations
      (id, project_id, external_user_id, client_conversation_id, subject,
       inbox_id, assigned_user_id, priority, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    projectId,
    `customer-${id}`,
    `client-${id}`,
    `Conversation ${id}`,
    options.inboxId || null,
    options.assignedUserId || null,
    options.priority || "normal",
    options.status || "open",
    options.createdAt || "2026-08-13T12:00:00.000Z",
    options.createdAt || "2026-08-13T12:00:00.000Z",
  ).run();
}

async function insertInbox(projectId: number, inboxId: string) {
  await env.DB.prepare(
    `INSERT INTO support_inboxes
      (id, project_id, name, identifier, channel_type, status, auto_assignment)
     VALUES (?, ?, ?, ?, 'api', 'active', 1)`,
  ).bind(inboxId, projectId, `Inbox ${inboxId}`, `identifier-${inboxId}`).run();
}

async function insertMessage(
  conversationId: string,
  id: string,
  sequence: number,
  senderKind: "user" | "agent",
  createdAt: string,
) {
  await env.DB.prepare(
    `INSERT INTO messages
      (id, conversation_id, sender_kind, sender_id, body, client_message_id,
       sequence, visibility, content_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'public', 'text', ?)`,
  ).bind(
    id,
    conversationId,
    senderKind,
    `${senderKind}-${id}`,
    `Message ${id}`,
    `client-${id}`,
    sequence,
    createdAt,
  ).run();
}

async function insertMembership(
  projectId: number,
  id: string,
  options: {
    availability?: string;
    capacity?: number;
    autoOffline?: boolean;
    lastActiveAt?: string;
  } = {},
) {
  await env.DB.prepare(
    `INSERT INTO support_memberships
      (id, project_id, auth_user_id, display_name, role, availability, capacity,
       auto_offline, last_active_at, active)
     VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, 1)`,
  ).bind(
    id,
    projectId,
    `user-${id}`,
    `Agent ${id}`,
    options.availability || "online",
    options.capacity ?? 10,
    options.autoOffline ? 1 : 0,
    options.lastActiveAt || null,
  ).run();
}

async function signedCreationRequest(
  projectId: number,
  body: Record<string, unknown>,
) {
  const pathname = `/internal/v1/projects/${projectId}/conversations`;
  const context: InternalProjectContext = {
    module: "support",
    method: "POST",
    pathname,
    projectId,
    projectRef: "10-test",
    instanceId: 10,
    environment: "test",
    actorId: 2,
    role: "owner",
    requestId: crypto.randomUUID(),
    issuedAt: Math.floor(Date.now() / 1000),
  };
  return new Request(`https://support.internal${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
      "x-internal-token": "support-runtime-secret",
      "x-project-id": String(projectId),
      "x-project-ref": context.projectRef,
      "x-instance-id": String(context.instanceId),
      "x-environment": context.environment,
      "x-actor-id": String(context.actorId),
      "x-role": context.role,
      "x-request-id": context.requestId,
      "x-context-issued-at": String(context.issuedAt),
      "x-context-version": "1",
      "x-context-signature": await signProjectContext(
        context,
        "support-runtime-secret",
      ),
    },
    body: JSON.stringify(body),
  });
}

describe("native Support assignment engine", () => {
  it("balances by utilization while enforcing inbox, team, presence, leave, and capacity", async () => {
    const projectId = 301;
    const inboxId = "balanced-inbox";
    const teamId = "balanced-team";
    const conversationId = "balanced-target";
    const now = new Date("2026-08-13T12:00:00.000Z");
    await insertInbox(projectId, inboxId);
    await env.DB.prepare(
      `INSERT INTO support_teams (id, project_id, name, allow_auto_assign, active)
       VALUES (?, ?, 'Balanced team', 1, 1)`,
    ).bind(teamId, projectId).run();

    await Promise.all([
      insertMembership(projectId, "balanced-a", { capacity: 2 }),
      insertMembership(projectId, "balanced-b", { capacity: 5 }),
      insertMembership(projectId, "balanced-c", { availability: "offline", capacity: 10 }),
      insertMembership(projectId, "balanced-d", { capacity: 1 }),
      insertMembership(projectId, "balanced-e", { capacity: 10 }),
      insertMembership(projectId, "balanced-f", { capacity: 10 }),
      insertMembership(projectId, "balanced-g", { capacity: 10 }),
      insertMembership(projectId, "balanced-h", {
        capacity: 10,
        autoOffline: true,
        lastActiveAt: "2026-08-13T11:30:00.000Z",
      }),
    ]);
    for (const membershipId of [
      "balanced-a",
      "balanced-b",
      "balanced-c",
      "balanced-d",
      "balanced-f",
      "balanced-g",
      "balanced-h",
    ]) {
      await env.DB.prepare(
        `INSERT INTO support_team_members (project_id, team_id, membership_id)
         VALUES (?, ?, ?)`,
      ).bind(projectId, teamId, membershipId).run();
    }
    for (const membershipId of [
      "balanced-a",
      "balanced-b",
      "balanced-c",
      "balanced-d",
      "balanced-e",
      "balanced-g",
      "balanced-h",
    ]) {
      await env.DB.prepare(
        `INSERT INTO support_inbox_members (project_id, inbox_id, membership_id)
         VALUES (?, ?, ?)`,
      ).bind(projectId, inboxId, membershipId).run();
    }
    await env.DB.prepare(
      `INSERT INTO support_leave_schedules
        (id, project_id, membership_id, starts_at, ends_at, created_by)
       VALUES ('balanced-g-leave', ?, 'balanced-g',
         '2026-08-13T11:00:00.000Z', '2026-08-13T13:00:00.000Z', 'supervisor')`,
    ).bind(projectId).run();
    await env.DB.prepare(
      `INSERT INTO support_capacity_policies
        (id, project_id, name, default_capacity, priority_limits_json, active)
       VALUES ('balanced-capacity', ?, 'Balanced capacity', 10, '{"urgent":4}', 1)`,
    ).bind(projectId).run();
    await env.DB.prepare(
      `INSERT INTO support_assignment_policies
        (id, project_id, name, policy_type, max_assignments_per_agent,
         inbox_ids_json, team_ids_json, active)
       VALUES ('balanced-policy', ?, 'Balanced policy', 'balanced', 5, ?, ?, 1)`,
    ).bind(projectId, JSON.stringify([inboxId]), JSON.stringify([teamId])).run();

    await insertConversation(projectId, "balanced-load-a", {
      inboxId,
      assignedUserId: "balanced-a",
    });
    await insertConversation(projectId, "balanced-load-b", {
      inboxId,
      assignedUserId: "balanced-b",
    });
    await insertConversation(projectId, "balanced-load-d", {
      inboxId,
      assignedUserId: "balanced-d",
    });
    await insertConversation(projectId, conversationId, {
      inboxId,
      priority: "urgent",
    });

    const result = await assignConversation(
      env.DB,
      projectId,
      conversationId,
      now,
    );
    expect(result).toMatchObject({
      assigned: true,
      policyId: "balanced-policy",
      policyType: "balanced",
      membershipId: "balanced-b",
      userId: "balanced-b",
      teamId,
      reason: "balanced_selected",
    });
    await expect(env.DB.prepare(
      `SELECT assigned_user_id, assigned_team_id FROM conversations
       WHERE id = ? AND project_id = ?`,
    ).bind(conversationId, projectId).first()).resolves.toMatchObject({
      assigned_user_id: "balanced-b",
      assigned_team_id: teamId,
    });
    const event = await env.DB.prepare(
      `SELECT reason, payload_json FROM support_assignment_events
       WHERE conversation_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(conversationId, projectId).first<{
      reason: string;
      payload_json: string;
    }>();
    expect(event?.reason).toBe("balanced_selected");
    expect(JSON.parse(event!.payload_json)).toMatchObject({
      evaluated_members: 8,
      eligible_members: 2,
      selected_user_id: "balanced-b",
      active_load: 1,
      effective_capacity: 4,
      rejected: {
        not_online: 1,
        capacity_exhausted: 1,
        not_in_policy_team: 1,
        not_in_inbox: 1,
        on_leave: 1,
        presence_stale: 1,
      },
    });
  });

  it("applies assignment and SLA policies through the native creation route", async () => {
    const projectId = 12;
    const suffix = crypto.randomUUID();
    const inboxId = `route-inbox-${suffix}`;
    const membershipId = `route-membership-${suffix}`;
    await insertInbox(projectId, inboxId);
    await insertMembership(projectId, membershipId);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_inbox_members (project_id, inbox_id, membership_id)
         VALUES (?, ?, ?)`,
      ).bind(projectId, inboxId, membershipId),
      env.DB.prepare(
        `INSERT INTO support_assignment_policies
          (id, project_id, name, policy_type, inbox_ids_json, team_ids_json, active)
         VALUES (?, ?, ?, 'round_robin', ?, '[]', 1)`,
      ).bind(
        `route-assignment-${suffix}`,
        projectId,
        `Route assignment ${suffix}`,
        JSON.stringify([inboxId]),
      ),
      env.DB.prepare(
        `INSERT INTO support_sla_policies
          (id, project_id, name, first_response_minutes, next_response_minutes,
           resolution_minutes, business_hours_only, conditions_json, active)
         VALUES (?, ?, ?, 30, 20, 120, 0, ?, 1)`,
      ).bind(
        `route-sla-${suffix}`,
        projectId,
        `Route SLA ${suffix}`,
        JSON.stringify([
          { field: "inbox_id", operator: "equals", value: inboxId },
        ]),
      ),
    ]);

    const response = await SELF.fetch(await signedCreationRequest(projectId, {
      external_user_id: `route-customer-${suffix}`,
      client_conversation_id: `route-conversation-${suffix}`,
      subject: "Native policy application",
      inbox_id: inboxId,
    }));
    expect(response.status).toBe(201);
    const payload = await response.json<{
      data: { id: string; assigned_user_id: string | null };
    }>();
    expect(payload.data.assigned_user_id).toBe(membershipId);
    await expect(env.DB.prepare(
      `SELECT policy_id, status FROM support_applied_slas
       WHERE project_id = ? AND conversation_id = ?`,
    ).bind(projectId, payload.data.id).first()).resolves.toMatchObject({
      policy_id: `route-sla-${suffix}`,
      status: "active",
    });
    await expect(env.DB.prepare(
      `SELECT membership_id, reason FROM support_assignment_events
       WHERE project_id = ? AND conversation_id = ?`,
    ).bind(projectId, payload.data.id).first()).resolves.toMatchObject({
      membership_id: membershipId,
      reason: "round_robin_selected",
    });
  });

  it("round-robins by the oldest assignment and journals each selection", async () => {
    const projectId = 302;
    const inboxId = "round-robin-inbox";
    await insertInbox(projectId, inboxId);
    await Promise.all([
      insertMembership(projectId, "round-robin-a"),
      insertMembership(projectId, "round-robin-b"),
    ]);
    for (const membershipId of ["round-robin-a", "round-robin-b"]) {
      await env.DB.prepare(
        `INSERT INTO support_inbox_members (project_id, inbox_id, membership_id)
         VALUES (?, ?, ?)`,
      ).bind(projectId, inboxId, membershipId).run();
    }
    await env.DB.prepare(
      `INSERT INTO support_assignment_policies
        (id, project_id, name, policy_type, inbox_ids_json, team_ids_json, active)
       VALUES ('round-robin-policy', ?, 'Round robin', 'round_robin', ?, '[]', 1)`,
    ).bind(projectId, JSON.stringify([inboxId])).run();
    await insertConversation(projectId, "round-robin-history", {
      inboxId,
      assignedUserId: "round-robin-a",
    });
    await env.DB.prepare(
      `INSERT INTO support_assignment_events
        (id, project_id, conversation_id, policy_id, membership_id, reason,
         payload_json, created_at)
       VALUES ('round-robin-history-event', ?, 'round-robin-history',
         'round-robin-policy', 'round-robin-a', 'round_robin_selected', '{}',
         '2026-01-01T00:00:00.000Z')`,
    ).bind(projectId).run();
    await insertConversation(projectId, "round-robin-first", { inboxId });
    await insertConversation(projectId, "round-robin-second", { inboxId });

    const first = await assignConversation(
      env.DB,
      projectId,
      "round-robin-first",
      new Date("2026-08-13T12:00:00.000Z"),
    );
    const second = await assignConversation(
      env.DB,
      projectId,
      "round-robin-second",
      new Date("2026-08-13T12:01:00.000Z"),
    );
    expect(first.userId).toBe("round-robin-b");
    expect(second.userId).toBe("round-robin-a");
    await expect(env.DB.prepare(
      `SELECT COUNT(*) count FROM support_assignment_events
       WHERE project_id = ? AND policy_id = 'round-robin-policy'
         AND reason = 'round_robin_selected'`,
    ).bind(projectId).first()).resolves.toMatchObject({ count: 3 });
  });
});

describe("native Support SLA engine", () => {
  it("applies an inbox SLA in business hours and records response and resolution outcomes", async () => {
    const projectId = 303;
    const inboxId = "sla-inbox";
    const conversationId = "sla-conversation";
    const createdAt = "2026-10-23T13:30:00.000Z";
    await insertInbox(projectId, inboxId);
    await env.DB.prepare(
      `INSERT INTO support_working_hours
        (id, project_id, inbox_id, timezone, weekly_schedule_json,
         closed_dates_json, active)
       VALUES ('sla-hours', ?, ?, 'Europe/Zurich', ?, '["2026-10-26"]', 1)`,
    ).bind(projectId, inboxId, JSON.stringify({
      monday: [{ start: "09:00", end: "17:00" }],
      tuesday: [{ start: "09:00", end: "17:00" }],
      wednesday: [{ start: "09:00", end: "17:00" }],
      thursday: [{ start: "09:00", end: "17:00" }],
      friday: [{ start: "09:00", end: "17:00" }],
      saturday: [],
      sunday: [],
    })).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_sla_policies
          (id, project_id, name, first_response_minutes, next_response_minutes,
           resolution_minutes, business_hours_only, conditions_json, active,
           created_at)
         VALUES ('sla-unmatched', ?, 'Unmatched', 10, 10, 20, 0, ?, 1,
           '2026-01-01T00:00:00.000Z')`,
      ).bind(projectId, JSON.stringify([
        { field: "priority", operator: "equals", value: "low" },
      ])),
      env.DB.prepare(
        `INSERT INTO support_sla_policies
          (id, project_id, name, first_response_minutes, next_response_minutes,
           resolution_minutes, business_hours_only, conditions_json, active,
           created_at)
         VALUES ('sla-matched', ?, 'Matched', 120, 60, 540, 1, ?, 1,
           '2026-01-02T00:00:00.000Z')`,
      ).bind(projectId, JSON.stringify({
        mode: "all",
        conditions: [
          { field: "inbox_id", operator: "equals", value: inboxId },
          { field: "priority", operator: "equals", value: "urgent" },
        ],
      })),
    ]);
    await insertConversation(projectId, conversationId, {
      inboxId,
      priority: "urgent",
      createdAt,
    });

    const initialized = await initializeConversationPolicies(
      env.DB,
      projectId,
      conversationId,
      new Date(createdAt),
    );
    expect(initialized.sla).toMatchObject({
      applied: true,
      policyId: "sla-matched",
      firstResponseDueAt: "2026-10-27T08:30:00.000Z",
      resolutionDueAt: "2026-10-27T15:30:00.000Z",
      reason: "applied",
    });
    expect(initialized.assignment).toMatchObject({
      assigned: false,
      reason: "no_matching_policy",
    });

    const firstResponse = await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "agent",
      "public",
      new Date("2026-10-27T08:00:00.000Z"),
    );
    expect(firstResponse).toMatchObject({ changed: true, status: "active" });
    const firstCustomerMessage = await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "user",
      "public",
      new Date("2026-10-27T09:00:00.000Z"),
    );
    expect(firstCustomerMessage.changed).toBe(true);
    const replayedCustomerMessage = await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "user",
      "public",
      new Date("2026-10-27T09:00:00.000Z"),
    );
    expect(replayedCustomerMessage.changed).toBe(false);
    await expect(env.DB.prepare(
      `SELECT next_response_due_at FROM support_applied_slas
       WHERE conversation_id = ? AND project_id = ?`,
    ).bind(conversationId, projectId).first()).resolves.toMatchObject({
      next_response_due_at: "2026-10-27T10:00:00.000Z",
    });
    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "agent",
      "public",
      new Date("2026-10-27T09:30:00.000Z"),
    );
    const resolved = await recordSlaResolution(
      env.DB,
      projectId,
      conversationId,
      new Date("2026-10-27T15:00:00.000Z"),
    );
    expect(resolved).toMatchObject({ changed: true, status: "met" });

    await expect(env.DB.prepare(
      `SELECT status, first_response_met_at, next_response_due_at,
        resolution_met_at FROM support_applied_slas
       WHERE conversation_id = ? AND project_id = ?`,
    ).bind(conversationId, projectId).first()).resolves.toMatchObject({
      status: "met",
      first_response_met_at: "2026-10-27T08:00:00.000Z",
      next_response_due_at: null,
      resolution_met_at: "2026-10-27T15:00:00.000Z",
    });
    await expect(env.DB.prepare(
      `SELECT first_reply_at, resolved_at FROM conversations
       WHERE id = ? AND project_id = ?`,
    ).bind(conversationId, projectId).first()).resolves.toMatchObject({
      first_reply_at: "2026-10-27T08:00:00.000Z",
      resolved_at: "2026-10-27T15:00:00.000Z",
    });
    await expect(env.DB.prepare(
      `SELECT COUNT(*) count FROM support_sla_events
       WHERE conversation_id = ? AND event_type = 'met'`,
    ).bind(conversationId).first()).resolves.toMatchObject({ count: 3 });
    await expect(env.DB.prepare(
      `SELECT COUNT(*) count FROM support_sla_events
       WHERE conversation_id = ? AND event_type = 'breach'`,
    ).bind(conversationId).first()).resolves.toMatchObject({ count: 0 });

    const replay = await applyConversationSla(
      env.DB,
      projectId,
      conversationId,
      new Date(createdAt),
    );
    expect(replay.reason).toBe("already_applied");
    await expect(env.DB.prepare(
      `SELECT COUNT(*) count FROM support_applied_slas
       WHERE conversation_id = ? AND project_id = ?`,
    ).bind(conversationId, projectId).first()).resolves.toMatchObject({ count: 1 });
  });

  it("evaluates overdue targets idempotently and keeps the applied SLA breached", async () => {
    const projectId = 305;
    const conversationId = "sla-overdue";
    await env.DB.prepare(
      `INSERT INTO support_sla_policies
        (id, project_id, name, first_response_minutes, next_response_minutes,
         resolution_minutes, business_hours_only, conditions_json, active)
       VALUES ('sla-overdue-policy', ?, 'Overdue policy', 10, 5, 60, 0, '[]', 1)`,
    ).bind(projectId).run();
    await insertConversation(projectId, conversationId, {
      createdAt: "2090-08-13T12:00:00.000Z",
    });
    const applied = await applyConversationSla(
      env.DB,
      projectId,
      conversationId,
      new Date("2090-08-13T12:00:00.000Z"),
    );
    const first = await evaluateAppliedSla(
      env.DB,
      projectId,
      applied.appliedSlaId!,
      new Date("2090-08-13T12:11:00.000Z"),
    );
    const replay = await evaluateAppliedSla(
      env.DB,
      projectId,
      applied.appliedSlaId!,
      new Date("2090-08-13T12:12:00.000Z"),
    );
    expect(first).toMatchObject({
      evaluated: true,
      breachedTargets: ["first_response"],
      status: "breached",
    });
    expect(replay).toMatchObject({
      evaluated: true,
      breachedTargets: [],
      status: "breached",
    });
    await expect(env.DB.prepare(
      `SELECT COUNT(*) count FROM support_sla_events
       WHERE conversation_id = ? AND event_type = 'breach'
         AND target = 'first_response'`,
    ).bind(conversationId).first()).resolves.toMatchObject({ count: 1 });
  });

  it("closes first-response tracking when a conversation resolves without an agent reply", async () => {
    const projectId = 304;
    const conversationId = "sla-resolved-without-reply";
    await env.DB.prepare(
      `INSERT INTO support_sla_policies
        (id, project_id, name, first_response_minutes, next_response_minutes,
         resolution_minutes, business_hours_only, conditions_json, active)
       VALUES ('sla-resolution-policy', ?, 'Resolution policy', 10, 5, 20, 0, '[]', 1)`,
    ).bind(projectId).run();
    await insertConversation(projectId, conversationId, {
      createdAt: "2026-08-13T12:00:00.000Z",
    });
    await applyConversationSla(
      env.DB,
      projectId,
      conversationId,
      new Date("2026-08-13T12:00:00.000Z"),
    );

    const resolved = await recordSlaResolution(
      env.DB,
      projectId,
      conversationId,
      new Date("2026-08-13T12:15:00.000Z"),
    );
    expect(resolved).toMatchObject({ changed: true, status: "breached" });
    expect(await recordSlaResolution(
      env.DB,
      projectId,
      conversationId,
      new Date("2026-08-13T12:16:00.000Z"),
    )).toMatchObject({ changed: false, status: "breached" });
    await expect(env.DB.prepare(
      `SELECT first_response_due_at, resolution_met_at, status
       FROM support_applied_slas WHERE project_id = ? AND conversation_id = ?`,
    ).bind(projectId, conversationId).first()).resolves.toMatchObject({
      first_response_due_at: null,
      resolution_met_at: "2026-08-13T12:15:00.000Z",
      status: "breached",
    });
    const events = await env.DB.prepare(
      `SELECT event_type, target FROM support_sla_events
       WHERE project_id = ? AND conversation_id = ?
       ORDER BY target, event_type`,
    ).bind(projectId, conversationId).all<{
      event_type: string;
      target: string;
    }>();
    expect(events.results).toEqual([
      { event_type: "breach", target: "first_response" },
      { event_type: "cancelled", target: "first_response" },
      { event_type: "met", target: "resolution" },
    ]);
  });

  it("keeps a breached SLA eligible for its later unresolved resolution deadline", async () => {
    const projectId = 306;
    const conversationId = "sla-breached-resolution-due";
    await env.DB.prepare(
      `INSERT INTO support_sla_policies
        (id, project_id, name, first_response_minutes, next_response_minutes,
         resolution_minutes, business_hours_only, conditions_json, active)
       VALUES ('sla-later-target-policy', ?, 'Later target policy', 10, 5, 60, 0, '[]', 1)`,
    ).bind(projectId).run();
    await insertConversation(projectId, conversationId, {
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    const applied = await applyConversationSla(
      env.DB,
      projectId,
      conversationId,
      new Date("2000-01-01T00:00:00.000Z"),
    );
    await evaluateAppliedSla(
      env.DB,
      projectId,
      applied.appliedSlaId!,
      new Date("2000-01-01T00:11:00.000Z"),
    );

    const claimed = await claimScheduledSupportJobs(env);
    expect(claimed.slas).toBe(1);
  });

  it("does not let an older idempotent message replay replace the latest response target", async () => {
    const projectId = 307;
    const conversationId = "sla-message-order";
    await env.DB.prepare(
      `INSERT INTO support_sla_policies
        (id, project_id, name, first_response_minutes, next_response_minutes,
         resolution_minutes, business_hours_only, conditions_json, active)
       VALUES ('sla-message-order-policy', ?, 'Message order policy', 10, 5, 60, 0, '[]', 1)`,
    ).bind(projectId).run();
    await insertConversation(projectId, conversationId, {
      createdAt: "2091-01-01T12:00:00.000Z",
    });
    await applyConversationSla(
      env.DB,
      projectId,
      conversationId,
      new Date("2091-01-01T12:00:00.000Z"),
    );

    await insertMessage(
      conversationId,
      "ordered-agent-first",
      1,
      "agent",
      "2091-01-01T12:05:00.000Z",
    );
    await insertMessage(
      conversationId,
      "ordered-user-first",
      2,
      "user",
      "2091-01-01T12:10:00.000Z",
    );
    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "user",
      "public",
      new Date("2091-01-01T12:10:00.000Z"),
      "ordered-user-first",
    );
    await expect(env.DB.prepare(
      `SELECT first_response_met_at FROM support_applied_slas
       WHERE project_id = ? AND conversation_id = ?`,
    ).bind(projectId, conversationId).first()).resolves.toMatchObject({
      first_response_met_at: "2091-01-01T12:05:00.000Z",
    });
    await insertMessage(
      conversationId,
      "ordered-agent-second",
      3,
      "agent",
      "2091-01-01T12:12:00.000Z",
    );
    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "agent",
      "public",
      new Date("2091-01-01T12:12:00.000Z"),
      "ordered-agent-second",
    );
    await insertMessage(
      conversationId,
      "ordered-user-latest",
      4,
      "user",
      "2091-01-01T12:20:00.000Z",
    );
    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "user",
      "public",
      new Date("2091-01-01T12:20:00.000Z"),
      "ordered-user-latest",
    );

    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "agent",
      "public",
      new Date("2091-01-01T12:12:00.000Z"),
      "ordered-agent-second",
    );
    await recordSlaMessage(
      env.DB,
      projectId,
      conversationId,
      "user",
      "public",
      new Date("2091-01-01T12:10:00.000Z"),
      "ordered-user-first",
    );
    await expect(env.DB.prepare(
      `SELECT next_response_due_at FROM support_applied_slas
       WHERE project_id = ? AND conversation_id = ?`,
    ).bind(projectId, conversationId).first()).resolves.toMatchObject({
      next_response_due_at: "2091-01-01T12:25:00.000Z",
    });
  });
});
