type ConversationRecord = Record<string, unknown> & {
  id: string;
  project_id: number;
  inbox_id: string | null;
  assigned_user_id: string | null;
  assigned_team_id: string | null;
  priority: string;
  status: string;
  created_at: string;
};

type SlaPolicy = {
  id: string;
  first_response_minutes: number;
  next_response_minutes: number | null;
  resolution_minutes: number;
  business_hours_only: number;
  conditions_json: string;
};

type WorkingHours = {
  timezone: string;
  weekly_schedule_json: string;
  closed_dates_json: string;
};

type AppliedSla = {
  id: string;
  project_id: number;
  conversation_id: string;
  policy_id: string;
  first_response_due_at: string | null;
  next_response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_met_at: string | null;
  resolution_met_at: string | null;
  status: "active" | "met" | "breached" | "cancelled";
};

type AssignmentPolicy = {
  id: string;
  policy_type: "round_robin" | "balanced" | "manual";
  max_assignments_per_agent: number | null;
  inbox_ids_json: string;
  team_ids_json: string;
};

type AssignmentCandidate = {
  id: string;
  auth_user_id: string;
  availability: string;
  auto_offline: number;
  last_active_at: string | null;
  capacity: number;
  active_load: number;
  active_leave: number;
  inbox_member: number;
  team_ids_json: string;
  last_assigned_at: string | null;
};

export type AssignmentResult = {
  assigned: boolean;
  policyId: string | null;
  policyType: "round_robin" | "balanced" | null;
  membershipId: string | null;
  userId: string | null;
  teamId: string | null;
  reason: string;
};

export type SlaApplicationResult = {
  applied: boolean;
  appliedSlaId: string | null;
  policyId: string | null;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  reason: string;
};

export type ConversationInitializationResult = {
  assignment: AssignmentResult;
  sla: SlaApplicationResult;
};

type WeeklySchedule = Record<string, Array<{ start: string; end: string }>>;

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const MAX_BUSINESS_CALENDAR_DAYS = 3_660;

export async function initializeConversationPolicies(
  db: D1Database,
  projectId: number,
  conversationId: string,
  now = new Date(),
): Promise<ConversationInitializationResult> {
  const assignment = await assignConversation(
    db,
    projectId,
    conversationId,
    now,
  );
  const sla = await applyConversationSla(
    db,
    projectId,
    conversationId,
    now,
  );
  const current = await conversationRecord(db, projectId, conversationId);
  if (current.status === "closed" && sla.applied) {
    await recordSlaResolution(db, projectId, conversationId, now);
  }
  return { assignment, sla };
}

export async function assignConversation(
  db: D1Database,
  projectId: number,
  conversationId: string,
  now = new Date(),
): Promise<AssignmentResult> {
  const conversation = await conversationRecord(db, projectId, conversationId);
  if (conversation.status === "closed") {
    await recordAssignmentAttempt(
      db,
      projectId,
      conversationId,
      null,
      null,
      conversation.assigned_team_id,
      "conversation_closed",
      { status: conversation.status },
    );
    return assignmentResult("conversation_closed");
  }
  if (conversation.assigned_user_id) {
    return assignmentResult("already_assigned");
  }

  if (conversation.inbox_id) {
    const inbox = await db.prepare(
      `SELECT auto_assignment FROM support_inboxes
       WHERE id = ? AND project_id = ? AND status = 'active'`,
    ).bind(conversation.inbox_id, projectId).first<{ auto_assignment: number }>();
    if (!inbox || inbox.auto_assignment !== 1) {
      await recordAssignmentAttempt(db, projectId, conversationId, null, null,
        null, "inbox_auto_assignment_disabled", { inbox_id: conversation.inbox_id });
      return assignmentResult("inbox_auto_assignment_disabled");
    }
  }

  const policies = await db.prepare(
    `SELECT id, policy_type, max_assignments_per_agent, inbox_ids_json, team_ids_json
     FROM support_assignment_policies
     WHERE project_id = ? AND active = 1 AND policy_type != 'manual'
     ORDER BY CASE WHEN json_array_length(inbox_ids_json) > 0 THEN 0 ELSE 1 END,
       created_at, id`,
  ).bind(projectId).all<AssignmentPolicy>();
  const conversationTeamId = conversation.assigned_team_id;
  const policy = policies.results.find((candidate) => {
    const inboxes = stringArray(candidate.inbox_ids_json);
    const teams = stringArray(candidate.team_ids_json);
    const inboxMatches = inboxes.length === 0
      || (conversation.inbox_id != null && inboxes.includes(conversation.inbox_id));
    const teamMatches = !conversationTeamId || teams.length === 0 || teams.includes(conversationTeamId);
    return inboxMatches && teamMatches;
  });
  if (!policy) {
    await recordAssignmentAttempt(db, projectId, conversationId, null, null,
      null, "no_matching_policy", { inbox_id: conversation.inbox_id });
    return assignmentResult("no_matching_policy");
  }

  const configuredTeams = conversationTeamId
    ? [conversationTeamId]
    : stringArray(policy.team_ids_json);
  const members = await db.prepare(
    `SELECT membership.id, membership.auth_user_id, membership.availability,
       membership.auto_offline, membership.last_active_at,
       membership.capacity,
       (SELECT COUNT(*) FROM conversations assigned
        WHERE assigned.project_id = membership.project_id
          AND assigned.assigned_user_id IN (membership.auth_user_id, membership.id)
          AND assigned.status != 'closed') active_load,
       EXISTS(SELECT 1 FROM support_leave_schedules leave
        WHERE leave.project_id = membership.project_id
          AND leave.membership_id = membership.id
          AND julianday(leave.starts_at) <= julianday(?)
          AND julianday(leave.ends_at) > julianday(?)) active_leave,
       CASE WHEN ? IS NULL THEN 1 ELSE EXISTS(
         SELECT 1 FROM support_inbox_members linked
         WHERE linked.project_id = membership.project_id
           AND linked.membership_id = membership.id AND linked.inbox_id = ?
       ) END inbox_member,
       COALESCE((SELECT json_group_array(team_member.team_id)
        FROM support_team_members team_member
        INNER JOIN support_teams team ON team.id = team_member.team_id
          AND team.project_id = team_member.project_id
        WHERE team_member.project_id = membership.project_id
          AND team_member.membership_id = membership.id
          AND team.active = 1 AND team.allow_auto_assign = 1), '[]') team_ids_json,
       (SELECT MAX(event.created_at) FROM support_assignment_events event
        WHERE event.project_id = membership.project_id
          AND event.membership_id = membership.id) last_assigned_at
     FROM support_memberships membership
     WHERE membership.project_id = ? AND membership.active = 1
     ORDER BY membership.id LIMIT 10000`,
  ).bind(
    now.toISOString(),
    now.toISOString(),
    conversation.inbox_id,
    conversation.inbox_id,
    projectId,
  ).all<AssignmentCandidate>();

  const capacityPolicy = await db.prepare(
    `SELECT default_capacity, priority_limits_json FROM support_capacity_policies
     WHERE project_id = ? AND active = 1 ORDER BY created_at, id LIMIT 1`,
  ).bind(projectId).first<{
    default_capacity: number;
    priority_limits_json: string;
  }>();
  const priorityLimits = objectValue(capacityPolicy?.priority_limits_json);
  const configuredPriorityLimit = finiteNonNegative(priorityLimits[conversation.priority]);
  const rejected: Record<string, number> = {};
  const eligible: Array<AssignmentCandidate & {
    effectiveCapacity: number;
    selectedTeamId: string | null;
  }> = [];
  for (const member of members.results) {
    let rejection: string | null = null;
    const lastActiveAt = validDate(member.last_active_at);
    const memberTeams = stringArray(member.team_ids_json).sort();
    const selectedTeamId = configuredTeams.length
      ? configuredTeams.filter((id) => memberTeams.includes(id)).sort()[0] || null
      : null;
    const limits = [
      Number(member.capacity),
      policy.max_assignments_per_agent,
      capacityPolicy?.default_capacity,
      configuredPriorityLimit,
    ].filter((value): value is number => value != null && Number.isFinite(value));
    const effectiveCapacity = Math.max(0, Math.min(...limits));
    if (member.availability !== "online") rejection = "not_online";
    else if (Number(member.auto_offline) === 1 && (
      !lastActiveAt
      || lastActiveAt.getTime() < now.getTime() - 15 * 60_000
    )) rejection = "presence_stale";
    else if (Number(member.active_leave) === 1) rejection = "on_leave";
    else if (Number(member.inbox_member) !== 1) rejection = "not_in_inbox";
    else if (configuredTeams.length > 0 && !selectedTeamId) rejection = "not_in_policy_team";
    else if (effectiveCapacity <= Number(member.active_load)) rejection = "capacity_exhausted";
    if (rejection) {
      rejected[rejection] = (rejected[rejection] || 0) + 1;
    } else {
      eligible.push({ ...member, effectiveCapacity, selectedTeamId });
    }
  }

  const explanation = {
    policy_type: policy.policy_type,
    inbox_id: conversation.inbox_id,
    evaluated_members: members.results.length,
    eligible_members: eligible.length,
    rejected,
  };
  if (eligible.length === 0) {
    await recordAssignmentAttempt(db, projectId, conversationId, policy.id,
      null, null, "no_eligible_members", explanation);
    return assignmentResult("no_eligible_members", policy);
  }

  eligible.sort(policy.policy_type === "round_robin"
    ? roundRobinOrder
    : balancedOrder);
  const selected = eligible[0];
  const reason = `${policy.policy_type}_selected`;
  const assignmentPayload = {
    ...explanation,
    selected_user_id: selected.id,
    active_load: Number(selected.active_load),
    effective_capacity: selected.effectiveCapacity,
    utilization: selected.effectiveCapacity === 0
      ? null
      : Number(selected.active_load) / selected.effectiveCapacity,
    last_assigned_at: selected.last_assigned_at,
  };
  const auditPayload = {
    policy_id: policy.id,
    policy_type: policy.policy_type,
    membership_id: selected.id,
    assigned_user_id: selected.id,
    assigned_team_id: selected.selectedTeamId,
    reason,
  };
  const assignmentEventId = crypto.randomUUID();
  const assignmentAuditId = crypto.randomUUID();
  const [update] = await db.batch([
    db.prepare(
      `UPDATE conversations SET assigned_user_id = ?, assigned_team_id = COALESCE(?, assigned_team_id),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND project_id = ? AND assigned_user_id IS NULL`,
    ).bind(selected.id, selected.selectedTeamId, conversationId, projectId),
    db.prepare(
      `INSERT INTO support_assignment_events
        (id, project_id, conversation_id, policy_id, membership_id, team_id, reason, payload_json)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(
      assignmentEventId,
      projectId,
      conversationId,
      policy.id,
      selected.id,
      selected.selectedTeamId,
      reason,
      JSON.stringify(assignmentPayload),
    ),
    db.prepare(
      `INSERT INTO support_audit_events
        (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
       SELECT ?, ?, ?, 'assignment.updated', 'system', 'support', ?
       WHERE EXISTS (SELECT 1 FROM support_assignment_events
         WHERE id = ? AND project_id = ?)`,
    ).bind(
      assignmentAuditId,
      conversationId,
      projectId,
      JSON.stringify(auditPayload),
      assignmentEventId,
      projectId,
    ),
  ]);
  if (update.meta.changes !== 1) return assignmentResult("already_assigned", policy);
  return {
    assigned: true,
    policyId: policy.id,
    policyType: policy.policy_type === "round_robin" ? "round_robin" : "balanced",
    membershipId: selected.id,
    userId: selected.id,
    teamId: selected.selectedTeamId,
    reason,
  };
}

export async function applyConversationSla(
  db: D1Database,
  projectId: number,
  conversationId: string,
  now = new Date(),
): Promise<SlaApplicationResult> {
  const existing = await appliedSla(db, projectId, conversationId);
  if (existing) return slaResult(existing, "already_applied");
  const conversation = await conversationRecord(db, projectId, conversationId);
  const policies = await db.prepare(
    `SELECT id, first_response_minutes, next_response_minutes, resolution_minutes,
       business_hours_only, conditions_json
     FROM support_sla_policies WHERE project_id = ? AND active = 1
     ORDER BY created_at, id`,
  ).bind(projectId).all<SlaPolicy>();
  const policy = policies.results.find((candidate) =>
    matchesSlaConditions(candidate.conditions_json, conversation));
  if (!policy) return emptySlaResult("no_matching_policy");

  const start = validDate(conversation.created_at) || now;
  const hours = policy.business_hours_only === 1
    ? await workingHours(db, projectId, conversation.inbox_id)
    : null;
  if (policy.business_hours_only === 1 && !hours) {
    await auditEvent(db, projectId, conversationId, "sla.not_applied", {
      policy_id: policy.id,
      reason: "working_hours_not_configured",
    });
    return emptySlaResult("working_hours_not_configured", policy.id);
  }
  const firstDue = deadline(start, policy.first_response_minutes, hours);
  const resolutionDue = deadline(start, policy.resolution_minutes, hours);
  if (!firstDue || !resolutionDue) {
    await auditEvent(db, projectId, conversationId, "sla.not_applied", {
      policy_id: policy.id,
      reason: "working_hours_invalid",
    });
    return emptySlaResult("working_hours_invalid", policy.id);
  }

  const id = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO support_applied_slas
        (id, project_id, conversation_id, policy_id, first_response_due_at, resolution_due_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      projectId,
      conversationId,
      policy.id,
      firstDue.toISOString(),
      resolutionDue.toISOString(),
    ),
    db.prepare(
      `INSERT INTO support_audit_events
        (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
       SELECT ?, ?, ?, 'sla.applied', 'system', 'support', ?
       WHERE NOT EXISTS (
         SELECT 1 FROM support_applied_slas WHERE conversation_id = ? AND id != ?
       )`,
    ).bind(
      crypto.randomUUID(),
      conversationId,
      projectId,
      JSON.stringify({
        policy_id: policy.id,
        first_response_due_at: firstDue.toISOString(),
        resolution_due_at: resolutionDue.toISOString(),
        business_hours_only: policy.business_hours_only === 1,
      }),
      conversationId,
      id,
    ),
  ]);
  const persisted = await appliedSla(db, projectId, conversationId);
  return persisted
    ? slaResult(persisted, persisted.id === id ? "applied" : "already_applied")
    : emptySlaResult("not_applied", policy.id);
}

export async function recordSlaMessage(
  db: D1Database,
  projectId: number,
  conversationId: string,
  senderKind: "user" | "agent" | "system",
  visibility: "public" | "private",
  occurredAt = new Date(),
  messageId?: string,
): Promise<{ changed: boolean; appliedSlaId: string | null; status: string | null }> {
  if (visibility !== "public" || senderKind === "system") {
    return { changed: false, appliedSlaId: null, status: null };
  }
  const sla = await appliedSla(db, projectId, conversationId);
  if (!sla) return { changed: false, appliedSlaId: null, status: null };
  const at = occurredAt.toISOString();
  const messageContext = messageId
    ? await slaMessageContext(db, conversationId, messageId)
    : { latest: true, firstAgentAt: null };
  let firstResponseMetAt = sla.first_response_met_at;
  let changed = false;
  if (!firstResponseMetAt && messageContext.firstAgentAt) {
    await markTargetMet(
      db,
      sla,
      "first_response",
      sla.first_response_due_at,
      messageContext.firstAgentAt,
    );
    await db.batch([
      db.prepare(
        `UPDATE support_applied_slas SET first_response_met_at = COALESCE(first_response_met_at, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ?`,
      ).bind(messageContext.firstAgentAt, sla.id, projectId),
      db.prepare(
        `UPDATE conversations SET first_reply_at = COALESCE(first_reply_at, ?)
         WHERE id = ? AND project_id = ?`,
      ).bind(messageContext.firstAgentAt, conversationId, projectId),
    ]);
    firstResponseMetAt = messageContext.firstAgentAt;
    changed = true;
  }
  if (senderKind === "agent") {
    if (!firstResponseMetAt) {
      await markTargetMet(db, sla, "first_response", sla.first_response_due_at, at);
      await db.prepare(
        `UPDATE support_applied_slas SET first_response_met_at = COALESCE(first_response_met_at, ?),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ?`,
      ).bind(at, sla.id, projectId).run();
      await db.prepare(
        `UPDATE conversations SET first_reply_at = COALESCE(first_reply_at, ?)
         WHERE id = ? AND project_id = ?`,
      ).bind(at, conversationId, projectId).run();
      firstResponseMetAt = at;
      changed = true;
    }
    if (sla.next_response_due_at && messageContext.latest) {
      await markTargetMet(db, sla, "next_response", sla.next_response_due_at, at);
      await db.prepare(
        `UPDATE support_applied_slas SET next_response_due_at = NULL,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND project_id = ?`,
      ).bind(sla.id, projectId).run();
      changed = true;
    }
  } else if (firstResponseMetAt && messageContext.latest) {
    const policy = await db.prepare(
      `SELECT id, first_response_minutes, next_response_minutes, resolution_minutes,
         business_hours_only, conditions_json
       FROM support_sla_policies WHERE id = ? AND project_id = ? AND active = 1`,
    ).bind(sla.policy_id, projectId).first<SlaPolicy>();
    if (policy?.next_response_minutes) {
      const conversation = await conversationRecord(db, projectId, conversationId);
      const hours = policy.business_hours_only === 1
        ? await workingHours(db, projectId, conversation.inbox_id)
        : null;
      const due = policy.business_hours_only === 0 || hours
        ? deadline(occurredAt, policy.next_response_minutes, hours)
        : null;
      if (due && due.toISOString() !== sla.next_response_due_at) {
        await db.prepare(
          `UPDATE support_applied_slas SET next_response_due_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND project_id = ?`,
        ).bind(due.toISOString(), sla.id, projectId).run();
        changed = true;
      }
    }
  }
  const status = await synchronizeSlaStatus(db, projectId, sla.id);
  if (changed) await auditEvent(db, projectId, conversationId, "sla.updated", {
    applied_sla_id: sla.id,
    sender_kind: senderKind,
    occurred_at: at,
    status,
  });
  return { changed, appliedSlaId: sla.id, status };
}

export async function recordSlaResolution(
  db: D1Database,
  projectId: number,
  conversationId: string,
  resolvedAt = new Date(),
): Promise<{ changed: boolean; appliedSlaId: string | null; status: string | null }> {
  const sla = await appliedSla(db, projectId, conversationId);
  if (!sla || sla.resolution_met_at) {
    return { changed: false, appliedSlaId: sla?.id || null, status: sla?.status || null };
  }
  const at = resolvedAt.toISOString();
  if (!sla.first_response_met_at && sla.first_response_due_at) {
    const firstDue = validDate(sla.first_response_due_at);
    if (firstDue && resolvedAt.getTime() > firstDue.getTime()) {
      await recordSlaEvent(db, sla, "breach", "first_response", {
        due_at: sla.first_response_due_at,
        resolved_at: at,
        reason: "resolved_without_first_response",
      });
    }
    await recordSlaEvent(db, sla, "cancelled", "first_response", {
      due_at: sla.first_response_due_at,
      cancelled_at: at,
      reason: "conversation_resolved",
    });
  }
  await markTargetMet(db, sla, "resolution", sla.resolution_due_at, at);
  await db.batch([
    db.prepare(
      `UPDATE support_applied_slas SET resolution_met_at = ?,
         first_response_due_at = CASE WHEN first_response_met_at IS NULL THEN NULL ELSE first_response_due_at END,
         next_response_due_at = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND project_id = ?`,
    ).bind(at, sla.id, projectId),
    db.prepare(
      `UPDATE conversations SET resolved_at = COALESCE(resolved_at, ?)
       WHERE id = ? AND project_id = ?`,
    ).bind(at, conversationId, projectId),
  ]);
  const status = await synchronizeSlaStatus(db, projectId, sla.id);
  await auditEvent(db, projectId, conversationId, "sla.updated", {
    applied_sla_id: sla.id,
    target: "resolution",
    occurred_at: at,
    status,
  });
  return { changed: true, appliedSlaId: sla.id, status };
}

export async function evaluateAppliedSla(
  db: D1Database,
  projectId: number,
  appliedSlaId: string,
  now = new Date(),
) {
  const sla = await db.prepare(
    `SELECT * FROM support_applied_slas
     WHERE id = ? AND project_id = ? AND status IN ('active', 'breached')`,
  ).bind(appliedSlaId, projectId).first<AppliedSla>();
  if (!sla) {
    return {
      evaluated: false,
      conversationId: null,
      breachedTargets: [] as string[],
      status: null,
    };
  }
  const targets: Array<["first_response" | "next_response" | "resolution", string | null, boolean]> = [
    ["first_response", sla.first_response_due_at, Boolean(sla.first_response_met_at)],
    ["next_response", sla.next_response_due_at, false],
    ["resolution", sla.resolution_due_at, Boolean(sla.resolution_met_at)],
  ];
  const breachedTargets: string[] = [];
  for (const [target, dueAt, met] of targets) {
    const due = dueAt ? validDate(dueAt) : null;
    if (!met && due && due.getTime() <= now.getTime()) {
      const inserted = await recordSlaEvent(db, sla, "breach", target, {
        due_at: dueAt,
        evaluated_at: now.toISOString(),
      });
      if (inserted) breachedTargets.push(target);
    }
  }
  const status = await synchronizeSlaStatus(db, projectId, sla.id);
  if (breachedTargets.length) await auditEvent(db, projectId, sla.conversation_id, "sla.breached", {
    applied_sla_id: sla.id,
    targets: breachedTargets,
    evaluated_at: now.toISOString(),
  });
  return {
    evaluated: true,
    conversationId: sla.conversation_id,
    breachedTargets,
    status,
  };
}

export function addBusinessMinutes(
  start: Date,
  minutes: number,
  timezone: string,
  weeklySchedule: unknown,
  closedDates: unknown = [],
): Date | null {
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(minutes) || minutes < 1
    || !validTimeZone(timezone)) return null;
  const schedule = normalizedSchedule(weeklySchedule);
  if (!schedule) return null;
  const closed = new Set(Array.isArray(closedDates)
    ? closedDates.map(String).filter((value) => /^\d{4}-\d{2}-\d{2}$/u.test(value))
    : []);
  const formatter = localFormatter(timezone);
  let remainingMs = minutes * 60_000;
  const initial = localParts(start, formatter);
  let date = localDate(initial);
  for (let day = 0; day < MAX_BUSINESS_CALENDAR_DAYS; day += 1) {
    if (!closed.has(date)) {
      const weekday = WEEKDAYS[localWeekday(date)];
      const ranges = schedule[weekday] || [];
      for (const range of ranges) {
        const intervalStart = zonedDateTime(date, range.start, formatter);
        const intervalEnd = zonedDateTime(date, range.end, formatter);
        if (intervalStart == null || intervalEnd == null || intervalEnd <= intervalStart) continue;
        const cursor = Math.max(start.getTime(), intervalStart);
        if (cursor >= intervalEnd) continue;
        const available = intervalEnd - cursor;
        if (remainingMs <= available) return new Date(cursor + remainingMs);
        remainingMs -= available;
      }
    }
    date = addLocalDays(date, 1);
  }
  return null;
}

export function matchesSlaConditions(
  encoded: string,
  conversation: Record<string, unknown>,
): boolean {
  let value: unknown;
  try { value = JSON.parse(encoded || "[]"); } catch { return false; }
  if (Array.isArray(value)) return value.every((item) => matchesCondition(item, conversation));
  if (!value || typeof value !== "object") return false;
  const group = value as Record<string, unknown>;
  if (Array.isArray(group.conditions)) {
    return group.mode === "any"
      ? group.conditions.some((item) => matchesCondition(item, conversation))
      : group.conditions.every((item) => matchesCondition(item, conversation));
  }
  return Object.entries(group).every(([field, expected]) =>
    matchesCondition({ field, operator: "equals", value: expected }, conversation));
}

function matchesCondition(value: unknown, conversation: Record<string, unknown>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const condition = value as Record<string, unknown>;
  const field = String(condition.field || "");
  if (!new Set(["inbox_id", "priority", "status", "assigned_team_id", "channel_type", "labels"]).has(field)) return false;
  const actual = field === "labels" ? stringArray(String(conversation.labels_json || "[]")) : conversation[field];
  const expected = condition.value;
  const operator = String(condition.operator || "equals");
  if (operator === "present") return actual != null && String(actual).length > 0;
  if (operator === "not_present") return actual == null || String(actual).length === 0;
  if (operator === "not_equals") return String(actual ?? "") !== String(expected ?? "");
  if (operator === "includes_any") {
    const actualValues = Array.isArray(actual) ? actual.map(String) : [String(actual ?? "")];
    const expectedValues = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
    return expectedValues.some((item) => actualValues.includes(item));
  }
  if (operator === "includes_all") {
    const actualValues = Array.isArray(actual) ? actual.map(String) : [String(actual ?? "")];
    const expectedValues = Array.isArray(expected) ? expected.map(String) : [String(expected ?? "")];
    return expectedValues.every((item) => actualValues.includes(item));
  }
  return String(actual ?? "") === String(expected ?? "");
}

async function conversationRecord(db: D1Database, projectId: number, conversationId: string) {
  const row = await db.prepare(
    `SELECT conversation.*, inbox.channel_type
     FROM conversations conversation
     LEFT JOIN support_inboxes inbox ON inbox.id = conversation.inbox_id
       AND inbox.project_id = conversation.project_id
     WHERE conversation.id = ? AND conversation.project_id = ?`,
  ).bind(conversationId, projectId).first<ConversationRecord>();
  if (!row) throw failure("conversation_not_found", "Conversation not found", 404);
  return row;
}

async function appliedSla(db: D1Database, projectId: number, conversationId: string) {
  return db.prepare(
    `SELECT * FROM support_applied_slas WHERE conversation_id = ? AND project_id = ?`,
  ).bind(conversationId, projectId).first<AppliedSla>();
}

async function slaMessageContext(
  db: D1Database,
  conversationId: string,
  messageId: string,
) {
  const context = await db.prepare(
    `SELECT
       (SELECT id FROM messages WHERE conversation_id = ? AND visibility = 'public'
          AND deleted_at IS NULL ORDER BY sequence DESC LIMIT 1) latest_id,
       (SELECT created_at FROM messages WHERE conversation_id = ?
          AND visibility = 'public' AND sender_kind = 'agent' AND deleted_at IS NULL
          ORDER BY sequence, created_at, id LIMIT 1) first_agent_at`,
  ).bind(conversationId, conversationId).first<{
    latest_id: string | null;
    first_agent_at: string | null;
  }>();
  return {
    latest: context?.latest_id === messageId,
    firstAgentAt: validDate(context?.first_agent_at)?.toISOString() || null,
  };
}

async function workingHours(db: D1Database, projectId: number, inboxId: string | null) {
  return db.prepare(
    `SELECT timezone, weekly_schedule_json, closed_dates_json
     FROM support_working_hours
     WHERE project_id = ? AND active = 1 AND (inbox_id = ? OR inbox_id IS NULL)
     ORDER BY CASE WHEN inbox_id = ? THEN 0 ELSE 1 END, created_at, id LIMIT 1`,
  ).bind(projectId, inboxId, inboxId).first<WorkingHours>();
}

function deadline(start: Date, minutes: number, hours: WorkingHours | null): Date | null {
  if (!hours) return new Date(start.getTime() + minutes * 60_000);
  return addBusinessMinutes(
    start,
    minutes,
    hours.timezone,
    jsonValue(hours.weekly_schedule_json, null),
    jsonValue(hours.closed_dates_json, []),
  );
}

async function markTargetMet(
  db: D1Database,
  sla: AppliedSla,
  target: "first_response" | "next_response" | "resolution",
  dueAt: string | null,
  metAt: string,
) {
  const overdue = dueAt != null && new Date(metAt).getTime() > new Date(dueAt).getTime();
  if (overdue) await recordSlaEvent(db, sla, "breach", target, { due_at: dueAt, met_at: metAt });
  await recordSlaEvent(db, sla, "met", target, {
    due_at: dueAt,
    met_at: metAt,
    within_target: !overdue,
  });
}

async function recordSlaEvent(
  db: D1Database,
  sla: AppliedSla,
  eventType: "breach" | "met" | "cancelled",
  target: "first_response" | "next_response" | "resolution",
  payload: Record<string, unknown>,
) {
  const result = await db.prepare(
    `INSERT OR IGNORE INTO support_sla_events
      (id, project_id, applied_sla_id, conversation_id, event_type, target, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    sla.project_id,
    sla.id,
    sla.conversation_id,
    eventType,
    target,
    JSON.stringify(payload),
  ).run();
  // D1 may include rows written by AFTER INSERT reporting triggers in
  // meta.changes. Any positive value still means the idempotent SLA event was
  // inserted; a replay remains zero because the source INSERT is ignored.
  return result.meta.changes > 0;
}

async function synchronizeSlaStatus(db: D1Database, projectId: number, appliedSlaId: string) {
  const row = await db.prepare(
    `SELECT first_response_due_at, first_response_met_at, resolution_met_at,
       EXISTS(SELECT 1 FROM support_sla_events event
        WHERE event.applied_sla_id = applied.id AND event.event_type = 'breach') breached
     FROM support_applied_slas applied WHERE applied.id = ? AND applied.project_id = ?`,
  ).bind(appliedSlaId, projectId).first<{
    first_response_due_at: string | null;
    first_response_met_at: string | null;
    resolution_met_at: string | null;
    breached: number;
  }>();
  if (!row) return null;
  const status = row.breached
    ? "breached"
    : row.resolution_met_at && (row.first_response_met_at || !row.first_response_due_at)
      ? "met"
      : "active";
  await db.prepare(
    `UPDATE support_applied_slas SET status = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND project_id = ?`,
  ).bind(status, appliedSlaId, projectId).run();
  return status;
}

async function recordAssignmentAttempt(
  db: D1Database,
  projectId: number,
  conversationId: string,
  policyId: string | null,
  membershipId: string | null,
  teamId: string | null,
  reason: string,
  payload: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO support_assignment_events
      (id, project_id, conversation_id, policy_id, membership_id, team_id, reason, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    projectId,
    conversationId,
    policyId,
    membershipId,
    teamId,
    reason,
    JSON.stringify(payload),
  ).run();
}

async function auditEvent(
  db: D1Database,
  projectId: number,
  conversationId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  await db.prepare(
    `INSERT INTO support_audit_events
      (id, conversation_id, project_id, event_type, actor_kind, actor_id, payload_json)
     VALUES (?, ?, ?, ?, 'system', 'support', ?)`,
  ).bind(
    crypto.randomUUID(),
    conversationId,
    projectId,
    eventType,
    JSON.stringify(payload),
  ).run();
}

function roundRobinOrder(
  left: AssignmentCandidate & { effectiveCapacity: number },
  right: AssignmentCandidate & { effectiveCapacity: number },
) {
  if (left.last_assigned_at == null && right.last_assigned_at != null) return -1;
  if (left.last_assigned_at != null && right.last_assigned_at == null) return 1;
  const time = String(left.last_assigned_at || "").localeCompare(String(right.last_assigned_at || ""));
  return time || left.id.localeCompare(right.id);
}

function balancedOrder(
  left: AssignmentCandidate & { effectiveCapacity: number },
  right: AssignmentCandidate & { effectiveCapacity: number },
) {
  const leftRatio = Number(left.active_load) / left.effectiveCapacity;
  const rightRatio = Number(right.active_load) / right.effectiveCapacity;
  return leftRatio - rightRatio
    || Number(left.active_load) - Number(right.active_load)
    || roundRobinOrder(left, right);
}

function assignmentResult(
  reason: string,
  policy?: AssignmentPolicy,
): AssignmentResult {
  return {
    assigned: false,
    policyId: policy?.id || null,
    policyType: policy?.policy_type === "round_robin" || policy?.policy_type === "balanced"
      ? policy.policy_type
      : null,
    membershipId: null,
    userId: null,
    teamId: null,
    reason,
  };
}

function slaResult(sla: AppliedSla, reason: string): SlaApplicationResult {
  return {
    applied: true,
    appliedSlaId: sla.id,
    policyId: sla.policy_id,
    firstResponseDueAt: sla.first_response_due_at,
    resolutionDueAt: sla.resolution_due_at,
    reason,
  };
}

function emptySlaResult(reason: string, policyId: string | null = null): SlaApplicationResult {
  return {
    applied: false,
    appliedSlaId: null,
    policyId,
    firstResponseDueAt: null,
    resolutionDueAt: null,
    reason,
  };
}

function normalizedSchedule(value: unknown): WeeklySchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const result: WeeklySchedule = {};
  let intervalCount = 0;
  for (const weekday of WEEKDAYS) {
    const raw = source[weekday] ?? [];
    if (!Array.isArray(raw) || raw.length > 16) return null;
    const intervals: Array<{ start: string; end: string }> = [];
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const start = String((item as Record<string, unknown>).start || "");
      const end = String((item as Record<string, unknown>).end || "");
      if (!validClock(start) || !validClock(end) || start >= end) return null;
      intervals.push({ start, end });
      intervalCount += 1;
    }
    intervals.sort((left, right) => left.start.localeCompare(right.start));
    for (let index = 1; index < intervals.length; index += 1) {
      if (intervals[index].start < intervals[index - 1].end) return null;
    }
    result[weekday] = intervals;
  }
  return intervalCount > 0 ? result : null;
}

function zonedDateTime(date: string, clock: string, formatter: Intl.DateTimeFormat): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const actual = localParts(new Date(guess), formatter);
    const actualValue = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const delta = target - actualValue;
    if (delta === 0) return guess;
    guess += delta;
  }
  const final = localParts(new Date(guess), formatter);
  return final.year === year && final.month === month && final.day === day
      && final.hour === hour && final.minute === minute
    ? guess
    : null;
}

function localFormatter(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function localParts(date: Date, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
  };
}

function localDate(value: { year: number; month: number; day: number }) {
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function localWeekday(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function addLocalDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function validTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function validClock(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function validDate(value: unknown): Date | null {
  const result = new Date(String(value || ""));
  return Number.isNaN(result.getTime()) ? null : result;
}

function stringArray(encoded: string): string[] {
  const value = jsonValue(encoded, []);
  return Array.isArray(value)
    ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].slice(0, 1000)
    : [];
}

function objectValue(encoded: string | undefined): Record<string, unknown> {
  const value = jsonValue(encoded, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonValue(encoded: string | undefined, fallback: unknown): unknown {
  try { return JSON.parse(String(encoded || "")); } catch { return fallback; }
}

function finiteNonNegative(value: unknown): number | null {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
