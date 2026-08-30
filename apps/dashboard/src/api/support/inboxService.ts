import { GET, PATCH, POST } from "@/lib/api";
import { config } from "@/lib/config";
import { listSupportResource } from "./nativeClient";

// Canonical Grow client for the native SuperBoard Support inbox.

export type InboxConversation = {
  id: string;
  project_id: number;
  external_user_id: string;
  subject?: string | null;
  status: "open" | "pending" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_user_id?: string | null;
  assigned_team_id?: string | null;
  inbox_id?: string | null;
  snoozed_until?: string | null;
  custom_attributes_json?: string;
  labels_json: string;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  agent_last_read_at?: string | null;
  message_count: number;
  unread_count: number;
  updated_at: string;
};

export type InboxMessage = {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "agent" | "system";
  sender_id: string;
  visibility?: "public" | "private";
  content_type?: string;
  reply_to_message_id?: string | null;
  body?: string | null;
  attachment_name?: string | null;
  attachment_content_type?: string | null;
  sequence: number;
  created_at: string;
};

export type InboxRealtimeEvent = {
  schema_version: 1;
  type:
    | "connected"
    | "message.created"
    | "message.updated"
    | "message.deleted"
    | "conversation.updated"
    | "typing.started"
    | "typing.stopped"
    | "conversation.read"
    | "delivery.updated"
    | "presence.updated"
    | "assignment.updated"
    | "error";
  event_id: string;
  conversation_id: string;
  occurred_at: string;
  message?: InboxMessage;
  actor_id?: string | null;
  actor_kind?: "user" | "agent" | "bot";
  presence?: "online" | "away" | "offline";
  read_at?: string;
  error?: { code: string; message: string; retryable: boolean };
};

export type UnifiedInboxItem = {
  id: string;
  source_type: "conversation" | "refund_case";
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

export type SupportInboxMacro = {
  id: string;
  name: string;
  active: boolean;
  actions: unknown[];
};

export type SupportInboxCannedResponse = {
  id: string;
  name: string;
  content: string;
  shortcut?: string | null;
  active: boolean;
};

const path = (projectId: string, resource: string) => {
  return `${config.apiPath}/support/projects/${projectId}${resource}`;
};

const unifiedPath = (projectId: string, resource: string) => {
  return `${config.apiPath}/support/projects/${projectId}${resource}`;
};

const encodedId = (value: string) => encodeURIComponent(value);

export const listInboxMacros = (projectId: string) =>
  listSupportResource<SupportInboxMacro>(projectId, "macros", { limit: 100 });

export const listInboxCannedResponses = (projectId: string) =>
  listSupportResource<SupportInboxCannedResponse>(
    projectId,
    "canned-responses",
    { limit: 100 }
  );

export const getUnifiedInboxItems = async (
  projectId: string,
  filters: { type?: string; status?: string } = {}
): Promise<{
  data: UnifiedInboxItem[];
  degraded_sources: Array<{
    source_type: string;
    code: string;
    message: string;
  }>;
}> => {
  const query = new URLSearchParams();
  if (filters.type) query.set("type", filters.type);
  if (filters.status) query.set("status", filters.status);
  return (
    await GET(unifiedPath(projectId, `/items${query.size ? `?${query}` : ""}`))
  ).data;
};

export const getInboxConversations = async (
  projectId: string,
  status = ""
): Promise<{ data: InboxConversation[] }> =>
  (
    await GET(
      path(projectId, `/conversations${status ? `?status=${status}` : ""}`)
    )
  ).data;

export const getInboxMessages = async (
  projectId: string,
  conversationId: string
): Promise<{ data: InboxMessage[] }> =>
  (
    await GET(
      path(projectId, `/conversations/${encodedId(conversationId)}/messages`)
    )
  ).data;

export const sendInboxMessage = async (
  projectId: string,
  conversationId: string,
  body: string,
  clientMessageId: string,
  privateNote = false
) =>
  (
    await POST(
      path(projectId, `/conversations/${encodedId(conversationId)}/messages`),
      {
        body,
        client_message_id: clientMessageId,
        private: privateNote,
      }
    )
  ).data;

export const markInboxConversationRead = async (
  projectId: string,
  conversationId: string
) =>
  (
    await POST(
      path(projectId, `/conversations/${encodedId(conversationId)}/read`),
      {}
    )
  ).data;

export const setInboxConversationTyping = async (
  projectId: string,
  conversationId: string,
  active: boolean
) =>
  (
    await POST(
      path(projectId, `/conversations/${encodedId(conversationId)}/typing`),
      { active }
    )
  ).data;

export const uploadInboxAttachment = async (
  projectId: string,
  conversationId: string,
  file: File
): Promise<{
  key: string;
  filename: string;
  content_type: string;
  size: number;
}> =>
  (
    await POST(
      path(
        projectId,
        `/conversations/${encodedId(conversationId)}/attachments`
      ),
      file,
      {
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        retry: false,
      }
    )
  ).data;

export const sendInboxAttachment = async (
  projectId: string,
  conversationId: string,
  attachment: { key: string; filename: string; content_type: string },
  clientMessageId: string,
  body = ""
) =>
  (
    await POST(
      path(projectId, `/conversations/${encodedId(conversationId)}/messages`),
      {
        ...(body.trim() ? { body: body.trim() } : {}),
        attachment_key: attachment.key,
        attachment_name: attachment.filename,
        attachment_content_type: attachment.content_type,
        client_message_id: clientMessageId,
      }
    )
  ).data;

export const downloadInboxAttachment = async (
  projectId: string,
  conversationId: string,
  messageId: string
) =>
  (
    await GET(
      path(
        projectId,
        `/conversations/${encodedId(conversationId)}/attachments/${encodedId(messageId)}`
      ),
      {
        responseType: "blob",
      }
    )
  ).data as Blob;

export const updateInboxConversation = async (
  projectId: string,
  conversationId: string,
  update: Partial<
    Pick<
      InboxConversation,
      | "status"
      | "priority"
      | "assigned_user_id"
      | "assigned_team_id"
      | "inbox_id"
      | "snoozed_until"
    >
  > & { labels?: string[]; custom_attributes?: Record<string, unknown> }
) =>
  (
    await PATCH(
      path(projectId, `/conversations/${encodedId(conversationId)}`),
      update
    )
  ).data;

export const createInboxRealtimeTicket = async (
  projectId: string,
  conversationId: string
): Promise<{ ticket: string; expires_at: string }> =>
  (
    await POST(
      path(
        projectId,
        `/conversations/${encodedId(conversationId)}/realtime-ticket`
      ),
      {},
      { retry: false }
    )
  ).data.data;

export function inboxRealtimeUrl(
  projectId: string,
  conversationId: string,
  ticket: string
) {
  void projectId;
  void conversationId;
  const resource = `${config.apiPath}/support/realtime/${encodeURIComponent(ticket)}`;
  const url = new URL(resource, config.apiUrl);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  else throw new Error("Support realtime requires an HTTP or HTTPS API URL");
  return url.toString();
}

export function parseInboxRealtimeEvent(
  value: unknown
): InboxRealtimeEvent | null {
  if (typeof value !== "string" || value.length > 65_536) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      ![
        "connected",
        "message.created",
        "message.updated",
        "message.deleted",
        "conversation.updated",
        "typing.started",
        "typing.stopped",
        "conversation.read",
        "delivery.updated",
        "presence.updated",
        "assignment.updated",
        "error",
      ].includes(String(parsed.type))
    ) {
      return null;
    }
    if (
      parsed.schema_version !== 1 ||
      typeof parsed.event_id !== "string" ||
      typeof parsed.conversation_id !== "string" ||
      typeof parsed.occurred_at !== "string"
    )
      return null;
    if (
      parsed.message != null &&
      (typeof parsed.message !== "object" || Array.isArray(parsed.message))
    )
      return null;
    return parsed as unknown as InboxRealtimeEvent;
  } catch {
    return null;
  }
}
