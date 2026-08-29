import {
  createSupportResource,
  deleteSupportAction,
  deleteSupportResource,
  getSupportAction,
  listSupportResource,
  putSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportMembership = SupportEntity & {
  auth_user_id: string;
  display_name: string;
  role: "supervisor" | "agent";
  availability: "online" | "busy" | "offline";
  active: boolean;
  capacity: number;
  auto_offline: boolean;
};

export type SupportTeam = SupportEntity & {
  name: string;
  description?: string | null;
  allow_auto_assign: boolean;
  active: boolean;
};

export type SupportInbox = SupportEntity & {
  name: string;
  identifier: string;
  channel_type: string;
  status: "active" | "disabled" | "degraded";
  auto_assignment: boolean;
  allow_reopen: boolean;
  csat_enabled: boolean;
};

export type SupportCapacityPolicy = SupportEntity & {
  name: string;
  default_capacity: number;
  active: boolean;
};

export type SupportLeave = SupportEntity & {
  membership_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
};

export type WorkforceSummary = {
  memberships: Array<{
    role: SupportMembership["role"];
    availability: SupportMembership["availability"];
    active: boolean | number;
    count: number;
  }>;
  active_teams: number;
  active_inboxes: number;
  assignments: Array<{ assigned_user_id: string; count: number }>;
  active_leaves: number;
};

export const getWorkforceSummary = (projectRef: string) =>
  getSupportAction<WorkforceSummary>(projectRef, "workforce");

export const listSupportMemberships = (
  projectRef: string,
  query?: SupportCursorQuery
) =>
  listSupportResource<SupportMembership>(
    projectRef,
    "workforce/memberships",
    query
  );

export const createSupportMembership = (
  projectRef: string,
  input: Omit<SupportMembership, keyof SupportEntity>
) =>
  createSupportResource<SupportMembership, typeof input>(
    projectRef,
    "workforce/memberships",
    input
  );

export const updateSupportMembership = (
  projectRef: string,
  id: string,
  input: Partial<Omit<SupportMembership, keyof SupportEntity | "auth_user_id">>
) =>
  updateSupportResource<SupportMembership, typeof input>(
    projectRef,
    "workforce/memberships",
    id,
    input
  );

export const deleteSupportMembership = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "workforce/memberships", id);

export const listSupportTeams = (
  projectRef: string,
  query?: SupportCursorQuery
) => listSupportResource<SupportTeam>(projectRef, "workforce/teams", query);

export const createSupportTeam = (
  projectRef: string,
  input: Pick<
    SupportTeam,
    "name" | "description" | "allow_auto_assign" | "active"
  >
) =>
  createSupportResource<SupportTeam, typeof input>(
    projectRef,
    "workforce/teams",
    input
  );

export const updateSupportTeam = (
  projectRef: string,
  id: string,
  input: Partial<
    Pick<SupportTeam, "name" | "description" | "allow_auto_assign" | "active">
  >
) =>
  updateSupportResource<SupportTeam, typeof input>(
    projectRef,
    "workforce/teams",
    id,
    input
  );

export const deleteSupportTeam = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "workforce/teams", id);

export const listSupportInboxes = (
  projectRef: string,
  query?: SupportCursorQuery
) => listSupportResource<SupportInbox>(projectRef, "workforce/inboxes", query);

export const createSupportInbox = (
  projectRef: string,
  input: Omit<SupportInbox, keyof SupportEntity>
) =>
  createSupportResource<SupportInbox, typeof input>(
    projectRef,
    "workforce/inboxes",
    input
  );

export const updateSupportInbox = (
  projectRef: string,
  id: string,
  input: Partial<Omit<SupportInbox, keyof SupportEntity | "identifier" | "channel_type">>
) =>
  updateSupportResource<SupportInbox, typeof input>(
    projectRef,
    "workforce/inboxes",
    id,
    input
  );

export const deleteSupportInbox = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "workforce/inboxes", id);

export const listSupportCapacityPolicies = (
  projectRef: string,
  query?: SupportCursorQuery
) =>
  listSupportResource<SupportCapacityPolicy>(
    projectRef,
    "workforce/capacity-policies",
    query
  );

export const createSupportCapacityPolicy = (
  projectRef: string,
  input: Omit<SupportCapacityPolicy, keyof SupportEntity>
) =>
  createSupportResource<SupportCapacityPolicy, typeof input>(
    projectRef,
    "workforce/capacity-policies",
    input
  );

export const updateSupportCapacityPolicy = (
  projectRef: string,
  id: string,
  input: Partial<Omit<SupportCapacityPolicy, keyof SupportEntity>>
) =>
  updateSupportResource<SupportCapacityPolicy, typeof input>(
    projectRef,
    "workforce/capacity-policies",
    id,
    input
  );

export const deleteSupportCapacityPolicy = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "workforce/capacity-policies", id);

export const listSupportLeaves = (
  projectRef: string,
  query?: SupportCursorQuery
) =>
  listSupportResource<SupportLeave>(
    projectRef,
    "workforce/leave-schedules",
    query
  );

export const createSupportLeave = (
  projectRef: string,
  input: Omit<SupportLeave, keyof SupportEntity>
) =>
  createSupportResource<SupportLeave, typeof input>(
    projectRef,
    "workforce/leave-schedules",
    input
  );

export const updateSupportLeave = (
  projectRef: string,
  id: string,
  input: Partial<Omit<SupportLeave, keyof SupportEntity | "membership_id">>
) =>
  updateSupportResource<SupportLeave, typeof input>(
    projectRef,
    "workforce/leave-schedules",
    id,
    input
  );

export const deleteSupportLeave = (projectRef: string, id: string) =>
  deleteSupportResource(projectRef, "workforce/leave-schedules", id);

export const listSupportTeamMembers = (projectRef: string, teamId: string) =>
  getSupportAction<SupportMembership[]>(
    projectRef,
    `workforce/teams/${encodeURIComponent(teamId)}/members`
  );

export const linkSupportTeamMember = (
  projectRef: string,
  teamId: string,
  membershipId: string
) =>
  putSupportAction(
    projectRef,
    `workforce/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}`,
    {}
  );

export const unlinkSupportTeamMember = (
  projectRef: string,
  teamId: string,
  membershipId: string
) =>
  deleteSupportAction(
    projectRef,
    `workforce/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(membershipId)}`
  );

export const listSupportInboxMembers = (
  projectRef: string,
  inboxId: string
) =>
  getSupportAction<SupportMembership[]>(
    projectRef,
    `workforce/inboxes/${encodeURIComponent(inboxId)}/members`
  );

export const linkSupportInboxMember = (
  projectRef: string,
  inboxId: string,
  membershipId: string
) =>
  putSupportAction(
    projectRef,
    `workforce/inboxes/${encodeURIComponent(inboxId)}/members/${encodeURIComponent(membershipId)}`,
    {}
  );

export const unlinkSupportInboxMember = (
  projectRef: string,
  inboxId: string,
  membershipId: string
) =>
  deleteSupportAction(
    projectRef,
    `workforce/inboxes/${encodeURIComponent(inboxId)}/members/${encodeURIComponent(membershipId)}`
  );
