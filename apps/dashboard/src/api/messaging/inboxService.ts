import { GET, PATCH, POST } from "@/lib/api";
import { config } from "@/lib/config";

export type InboxConversation = {
  id: string;
  project_id: number;
  external_user_id: string;
  subject?: string | null;
  status: "open" | "pending" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_user_id?: string | null;
  labels_json: string;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  agent_last_read_at?: string | null;
  message_count: number;
  updated_at: string;
};

export type InboxMessage = {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "agent" | "system";
  sender_id: string;
  body?: string | null;
  attachment_name?: string | null;
  sequence: number;
  created_at: string;
};

export type UnifiedInboxItem = {
  id: string;
  source_type: "conversation" | "store_review" | "refund_case";
  source_id: string;
  title: string;
  preview: string;
  status: "open" | "pending" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  customer_reference?: string | null;
  updated_at: string;
  destination: string;
  capabilities: string[];
  source: Record<string, unknown>;
};

const path = (projectId: string, resource: string) => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/messaging/projects/${projectId}${resource}`;
};

const unifiedPath = (projectId: string, resource: string) => {
  const apiV2 = config.apiPath.replace(/\/v1\/?$/, "/v2");
  return `${apiV2}/inbox/projects/${projectId}${resource}`;
};

export const getUnifiedInboxItems = async (
  projectId: string,
  filters: { type?: string; status?: string } = {},
): Promise<{ data: UnifiedInboxItem[]; degraded_sources: Array<{ source_type: string; code: string; message: string }> }> => {
  const query = new URLSearchParams();
  if (filters.type) query.set("type", filters.type);
  if (filters.status) query.set("status", filters.status);
  return (await GET(unifiedPath(projectId, `/items${query.size ? `?${query}` : ""}`))).data;
};

export const getInboxConversations = async (projectId: string, status = ""):
Promise<{ data: InboxConversation[] }> =>
  (await GET(path(projectId, `/conversations${status ? `?status=${status}` : ""}`))).data;

export const getInboxMessages = async (projectId: string, conversationId: string):
Promise<{ data: InboxMessage[] }> =>
  (await GET(path(projectId, `/conversations/${conversationId}/messages`))).data;

export const sendInboxMessage = async (projectId: string, conversationId: string, body: string) =>
  (await POST(path(projectId, `/conversations/${conversationId}/messages`), {
    body,
    client_message_id: crypto.randomUUID(),
  })).data;

export const updateInboxConversation = async (
  projectId: string,
  conversationId: string,
  update: Partial<Pick<InboxConversation, "status" | "priority" | "assigned_user_id">> & { labels?: string[] },
) => (await PATCH(path(projectId, `/conversations/${conversationId}`), update)).data;
