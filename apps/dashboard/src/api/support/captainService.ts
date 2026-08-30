import {
  createSupportResource,
  deleteSupportResource,
  getSupportResource,
  listSupportResource,
  postSupportAction,
  updateSupportResource,
  type SupportCursorQuery,
  type SupportEntity,
} from "./nativeClient";

export type SupportAssistant = SupportEntity & {
  name: string;
  description?: string | null;
  instructions: string;
  response_mode: "suggestion" | "draft" | "automatic";
  handoff_enabled: boolean;
  active: boolean;
};
export type SupportAssistantScenario = SupportEntity & {
  assistant_id: string;
  name: string;
  instructions: string;
  position: number;
  active: boolean;
};
export type SupportAssistantTool = SupportEntity & {
  assistant_id: string;
  name: string;
  description: string;
  endpoint_url: string;
  method: "GET" | "POST";
  input_schema?: Record<string, unknown>;
  allowed: boolean;
};
export type SupportAssistantTask = SupportEntity & {
  assistant_id?: string | null;
  conversation_id?: string | null;
  task_type: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  result: {
    text?: string;
    handoff?: boolean;
    tool_id?: string;
    output?: unknown;
    sources?: Array<{ id: string; title: string; slug: string; score: number }>;
    allowed_tools?: Array<{ id: string; name: string }>;
  };
  error_code?: string | null;
};

const resource = <T>(path: string) => ({
  list: (projectRef: string, query?: SupportCursorQuery) =>
    listSupportResource<T>(projectRef, path, query),
  create: <TInput>(projectRef: string, input: TInput) =>
    createSupportResource<T, TInput>(projectRef, path, input),
  update: <TInput>(projectRef: string, id: string, input: TInput) =>
    updateSupportResource<T, TInput>(projectRef, path, id, input),
  remove: (projectRef: string, id: string) =>
    deleteSupportResource(projectRef, path, id),
});

export const supportAssistants =
  resource<SupportAssistant>("captain/assistants");
export const supportAssistantScenarios =
  resource<SupportAssistantScenario>("captain/scenarios");
export const supportAssistantTools =
  resource<SupportAssistantTool>("captain/tools");
export const listSupportAssistantTasks = (
  projectRef: string,
  query?: SupportCursorQuery
) => listSupportResource<SupportAssistantTask>(projectRef, "captain/tasks", query);
export const getSupportAssistantTask = (projectRef: string, id: string) =>
  getSupportResource<SupportAssistantTask>(projectRef, "captain/tasks", id);

export const createSupportAssistantTask = (
  projectRef: string,
  input: {
    task_type:
      | "suggest_reply"
      | "summarize"
      | "translate"
      | "index_document"
      | "copilot"
      | "handoff"
      | "run_tool";
    assistant_id?: string;
    conversation_id?: string;
    input?: Record<string, unknown>;
  }
) =>
  postSupportAction<{
    id: string;
    task_type: string;
    status: "queued";
  }>(projectRef, "captain/tasks", input);
