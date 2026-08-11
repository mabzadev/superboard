import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

export type MessagingContact = {
  id: string;
  external_user_id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  blocked: boolean;
  custom_attributes: Record<string, unknown>;
  conversation_count?: number;
  updated_at: string;
};

export type MessagingContactNote = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
};
export type MessagingCompany = {
  id: string;
  name: string;
  domain?: string | null;
  description?: string | null;
  custom_attributes?: Record<string, unknown>;
  contact_count?: number;
  created_at?: string;
  updated_at?: string;
};
export type MessagingContactDetail = MessagingContact & {
  conversations: Array<{
    id: string;
    subject?: string | null;
    status: string;
    priority: string;
    updated_at: string;
  }>;
};
export type MessagingCsat = {
  id: string;
  conversation_id: string;
  rating: number;
  feedback?: string | null;
  subject?: string | null;
  created_at: string;
};
export type MessagingNotification = {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  conversation_id?: string | null;
  read_at?: string | null;
  created_at: string;
};
export type SupportQuality = {
  csat: { responses?: number; average_rating?: number; satisfied?: number };
  conversations: { total?: number; open?: number; closed?: number };
  response_times: {
    average_first_reply_minutes?: number | null;
    average_resolution_minutes?: number | null;
  };
};
export type SupportAuditEvent = {
  id: string;
  action: string;
  actor_kind: string;
  actor_id: string;
  source: string;
  payload_json: string;
  created_at: string;
};

const path = (projectId: string, resource: string) => {
  return `${config.apiPath}/support/projects/${projectId}${resource}`;
};

export const getMessagingContacts = async (
  projectId: string,
  query = ""
): Promise<{ data: MessagingContact[] }> =>
  (
    await GET(
      path(
        projectId,
        `/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`
      )
    )
  ).data;
export const getMessagingContact = async (
  projectId: string,
  contactId: string
): Promise<{ data: MessagingContactDetail }> =>
  (await GET(path(projectId, `/contacts/${encodeURIComponent(contactId)}`)))
    .data;
export const createMessagingContact = async (
  projectId: string,
  contact: Record<string, unknown>
) => (await POST(path(projectId, "/contacts"), contact, { retry: false })).data;
export const updateMessagingContact = async (
  projectId: string,
  contactId: string,
  contact: Record<string, unknown>
) =>
  (
    await PATCH(
      path(projectId, `/contacts/${encodeURIComponent(contactId)}`),
      contact,
      { retry: false }
    )
  ).data;
export const getMessagingContactNotes = async (
  projectId: string,
  contactId: string
): Promise<{ data: MessagingContactNote[] }> =>
  (
    await GET(
      path(projectId, `/contacts/${encodeURIComponent(contactId)}/notes`)
    )
  ).data;
export const createMessagingContactNote = async (
  projectId: string,
  contactId: string,
  content: string
) =>
  (
    await POST(
      path(projectId, `/contacts/${encodeURIComponent(contactId)}/notes`),
      { content },
      { retry: false }
    )
  ).data;
export const deleteMessagingContactNote = async (
  projectId: string,
  contactId: string,
  noteId: string
) =>
  (
    await DELETE(
      path(
        projectId,
        `/contacts/${encodeURIComponent(contactId)}/notes/${encodeURIComponent(noteId)}`
      ),
      { retry: false }
    )
  ).data;
export const getMessagingCompanies = async (
  projectId: string
): Promise<{ data: MessagingCompany[] }> =>
  (await GET(path(projectId, "/companies"))).data;
export const createMessagingCompany = async (
  projectId: string,
  company: Record<string, unknown>
) =>
  (await POST(path(projectId, "/companies"), company, { retry: false })).data;
export const getMessagingCsat = async (
  projectId: string
): Promise<{ data: MessagingCsat[] }> =>
  (await GET(path(projectId, "/csat"))).data;
export const getSupportQuality = async (
  projectId: string
): Promise<{ data: SupportQuality }> =>
  (await GET(path(projectId, "/quality"))).data;
export const getSupportAudit = async (
  projectId: string
): Promise<{ data: SupportAuditEvent[] }> =>
  (await GET(path(projectId, "/audit"))).data;
export const getMessagingNotifications = async (
  projectId: string,
  unread = false
): Promise<{ data: MessagingNotification[] }> =>
  (await GET(path(projectId, `/notifications${unread ? "?unread=true" : ""}`)))
    .data;
export const markMessagingNotificationRead = async (
  projectId: string,
  notificationId: string
) =>
  (
    await PATCH(
      path(
        projectId,
        `/notifications/${encodeURIComponent(notificationId)}/read`
      ),
      {}
    )
  ).data;
export const saveMessagingDraft = async (
  projectId: string,
  conversationId: string,
  content: string,
  attachments: unknown[] = []
) =>
  (
    await PUT(
      path(
        projectId,
        `/conversations/${encodeURIComponent(conversationId)}/draft`
      ),
      { content, attachments }
    )
  ).data;
export const getMessagingDraft = async (
  projectId: string,
  conversationId: string
): Promise<{ data: { content: string } | null }> =>
  (
    await GET(
      path(
        projectId,
        `/conversations/${encodeURIComponent(conversationId)}/draft`
      )
    )
  ).data;
export const executeMessagingMacro = async (
  projectId: string,
  conversationId: string,
  macroId: string
) =>
  (
    await POST(
      path(
        projectId,
        `/conversations/${encodeURIComponent(conversationId)}/macros/${encodeURIComponent(macroId)}/execute`
      ),
      {},
      { retry: false }
    )
  ).data;
