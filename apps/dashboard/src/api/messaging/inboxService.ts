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
  attachment_content_type?: string | null;
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

export const sendInboxMessage = async (
  projectId: string,
  conversationId: string,
  body: string,
  clientMessageId: string,
) =>
  (await POST(path(projectId, `/conversations/${conversationId}/messages`), {
    body,
    client_message_id: clientMessageId,
  })).data;

export const markInboxConversationRead = async (projectId: string, conversationId: string) =>
  (await POST(path(projectId, `/conversations/${conversationId}/read`), {})).data;

export const setInboxConversationTyping = async (
  projectId: string,
  conversationId: string,
  active: boolean,
) => (await POST(path(projectId, `/conversations/${conversationId}/typing`), { active })).data;

export const uploadInboxAttachment = async (
  projectId: string,
  conversationId: string,
  file: File,
): Promise<{ key: string; filename: string; content_type: string; size: number }> =>
  (await POST(path(projectId, `/conversations/${conversationId}/attachments`), file, {
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": file.name,
    },
    retry: false,
  })).data;

export const sendInboxAttachment = async (
  projectId: string,
  conversationId: string,
  attachment: { key: string; filename: string; content_type: string },
  clientMessageId: string,
  body = "",
) => (await POST(path(projectId, `/conversations/${conversationId}/messages`), {
  ...(body.trim() ? { body: body.trim() } : {}),
  attachment_key: attachment.key,
  attachment_name: attachment.filename,
  attachment_content_type: attachment.content_type,
  client_message_id: clientMessageId,
})).data;

export const downloadInboxAttachment = async (
  projectId: string,
  conversationId: string,
  messageId: string,
) => (await GET(path(projectId, `/conversations/${conversationId}/attachments/${messageId}`), {
  responseType: "blob",
})).data as Blob;

export const updateInboxConversation = async (
  projectId: string,
  conversationId: string,
  update: Partial<Pick<InboxConversation, "status" | "priority" | "assigned_user_id">> & { labels?: string[] },
) => (await PATCH(path(projectId, `/conversations/${conversationId}`), update)).data;
