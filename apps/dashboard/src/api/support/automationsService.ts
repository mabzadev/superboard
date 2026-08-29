import {
  createSupportResource,
  deleteSupportResource,
  listSupportResource,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportAutomation = SupportEntity & {
  name: string;
  event_name: string;
  condition_mode: "all" | "any";
  conditions: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  position: number;
  active: boolean;
};

export type SupportAssignmentPolicy = SupportEntity & {
  name: string;
  policy_type: "round_robin" | "balanced" | "manual";
  queue_order: "oldest" | "priority" | "recent";
  max_assignments_per_agent?: number | null;
  active: boolean;
};

export type SupportWorkingHours = SupportEntity & {
  inbox_id?: string | null;
  timezone: string;
  weekly_schedule: Record<string, { start: string; end: string }[]>;
  closed_dates: string[];
  unavailable_message?: string | null;
  active: boolean;
};

export type SupportSlaPolicy = SupportEntity & {
  name: string;
  first_response_minutes: number;
  next_response_minutes?: number | null;
  resolution_minutes: number;
  business_hours_only: boolean;
  active: boolean;
};

export type SupportMacro = SupportEntity & {
  name: string;
  actions: Array<Record<string, unknown>>;
  position: number;
  active: boolean;
};

export type SupportCannedResponse = SupportEntity & {
  name: string;
  content: string;
  shortcut?: string | null;
  position: number;
  active: boolean;
};

const crud = <T>(resource: string) => ({
  list: (projectRef: string, query?: SupportCursorQuery) =>
    listSupportResource<T>(projectRef, resource, query),
  create: <TInput>(projectRef: string, input: TInput) =>
    createSupportResource<T, TInput>(projectRef, resource, input),
  update: <TInput>(projectRef: string, id: string, input: TInput) =>
    updateSupportResource<T, TInput>(projectRef, resource, id, input),
  remove: (projectRef: string, id: string) =>
    deleteSupportResource(projectRef, resource, id),
});

export const supportAutomations = crud<SupportAutomation>("automations");
export const supportAssignmentPolicies = crud<SupportAssignmentPolicy>(
  "assignment-policies"
);
export const supportWorkingHours =
  crud<SupportWorkingHours>("sla/working-hours");
export const supportSlaPolicies = crud<SupportSlaPolicy>("sla/policies");
export const supportMacros = crud<SupportMacro>("macros");
export const supportCannedResponses =
  crud<SupportCannedResponse>("canned-responses");
