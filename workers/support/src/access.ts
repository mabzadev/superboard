import type { ProjectContext } from "@superboard/contracts/project-context";

export type SupportRole = "owner" | "admin" | "supervisor" | "agent";

export type SupportPrincipal = {
  actorId: string;
  identityRole: string;
  supportRole: SupportRole;
  membershipId: string | null;
  projectId: number;
};

const roleRank: Record<SupportRole, number> = {
  agent: 1,
  supervisor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Resolves the signed Identity principal into Support's own authorization model.
 * Identity owner/admin remain project-wide overrides. Identity members must be
 * linked to an active Support membership; Support roles never leak back into
 * the Identity project context.
 */
export async function resolveSupportPrincipal(
  db: D1Database,
  context: Pick<ProjectContext, "projectId" | "actorId" | "role">,
): Promise<SupportPrincipal> {
  const identityRole = String(context.role || "").toLowerCase();
  const actorId = String(context.actorId);
  if (identityRole === "owner" || identityRole === "admin") {
    return {
      actorId,
      identityRole,
      supportRole: identityRole,
      membershipId: null,
      projectId: context.projectId,
    };
  }
  if (identityRole !== "member") {
    throw failure(
      "support_access_denied",
      "The signed project role is not eligible for Support access",
      403,
    );
  }
  const membership = await db
    .prepare(
      `
      SELECT id, role FROM support_memberships
      WHERE project_id = ? AND auth_user_id = ? AND active = 1
      LIMIT 1
    `,
    )
    .bind(context.projectId, actorId)
    .first<{ id: string; role: "supervisor" | "agent" }>();
  if (!membership) {
    throw failure(
      "support_membership_required",
      "An active Support membership is required",
      403,
    );
  }
  return {
    actorId,
    identityRole,
    supportRole: membership.role,
    membershipId: membership.id,
    projectId: context.projectId,
  };
}

export function requireSupportRole(
  principal: SupportPrincipal,
  minimum: SupportRole,
) {
  if (roleRank[principal.supportRole] < roleRank[minimum]) {
    throw failure(
      "support_role_insufficient",
      `The requested operation requires the ${minimum} Support role`,
      403,
    );
  }
}

export async function requireInboxAccess(
  db: D1Database,
  principal: SupportPrincipal,
  inboxId: string | null | undefined,
) {
  if (!inboxId || principal.membershipId === null) return;
  const allowed = await db
    .prepare(
      `
      SELECT 1 allowed FROM support_inbox_members
      WHERE project_id = ? AND inbox_id = ? AND membership_id = ?
      LIMIT 1
    `,
    )
    .bind(principal.projectId, inboxId, principal.membershipId)
    .first();
  if (!allowed) {
    throw failure(
      "support_inbox_forbidden",
      "This Support membership cannot access the requested inbox",
      403,
    );
  }
}

export function supportPrincipalFromHeaders(request: Request) {
  const projectId = Number(request.headers.get("x-project-id"));
  const actorId = Number(request.headers.get("x-actor-id"));
  const role = request.headers.get("x-role") || "";
  if (
    !Number.isSafeInteger(projectId) ||
    projectId <= 0 ||
    !Number.isSafeInteger(actorId) ||
    actorId < 0 ||
    !role
  ) {
    throw failure(
      "project_context_invalid",
      "Signed project context headers are incomplete",
      401,
    );
  }
  return { projectId, actorId, role };
}

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
