import { DELETE, GET, PATCH, POST, PUT } from "@/lib/api";
import { config } from "@/lib/config";

// Canonical Grow client for Support contacts and conversation operations.

export type SupportContact = {
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

export type SupportContactNote = {
  id: string;
  content: string;
  created_by: string;
  created_at: string;
};
export type SupportCompany = {
  id: string;
  name: string;
  domain?: string | null;
  description?: string | null;
  custom_attributes?: Record<string, unknown>;
  contact_count?: number;
  created_at?: string;
  updated_at?: string;
};
export type SupportContactDetail = SupportContact & {
  conversations: Array<{
    id: string;
    subject?: string | null;
    status: string;
    priority: string;
    updated_at: string;
  }>;
};
export type SupportCsat = {
  id: string;
  conversation_id: string;
  rating: number;
  feedback?: string | null;
  subject?: string | null;
  created_at: string;
};
export type SupportNotification = {
  id: string;
  notification_type: string;
  title: string;
  body: string;
  conversation_id?: string | null;
  read_at?: string | null;
  snoozed_until?: string | null;
  created_at: string;
};
export type SupportNotificationPreferences = {
  project_id?: number;
  membership_id?: string;
  email_enabled: boolean;
  push_enabled: boolean;
  browser_enabled: boolean;
  in_app_enabled: boolean;
  audio_enabled: boolean;
  muted_event_types: string[];
  updated_at?: string | null;
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
  return `${config.apiPath}/support/projects/${encodeURIComponent(projectId)}${resource}`;
};

export const getSupportContacts = async (
  projectId: string,
  query = ""
): Promise<{ data: SupportContact[] }> =>
  (
    await GET(
      path(
        projectId,
        `/contacts${query ? `?q=${encodeURIComponent(query)}` : ""}`
      )
    )
  ).data;
export const getSupportContact = async (
  projectId: string,
  contactId: string
): Promise<{ data: SupportContactDetail }> =>
  (await GET(path(projectId, `/contacts/${encodeURIComponent(contactId)}`)))
    .data;
export const createSupportContact = async (
  projectId: string,
  contact: Record<string, unknown>
) => (await POST(path(projectId, "/contacts"), contact, { retry: false })).data;
export const updateSupportContact = async (
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
export const getSupportContactNotes = async (
  projectId: string,
  contactId: string
): Promise<{ data: SupportContactNote[] }> =>
  (
    await GET(
      path(projectId, `/contacts/${encodeURIComponent(contactId)}/notes`)
    )
  ).data;
export const createSupportContactNote = async (
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
export const deleteSupportContactNote = async (
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
export const getSupportCompanies = async (
  projectId: string
): Promise<{ data: SupportCompany[] }> =>
  (await GET(path(projectId, "/companies"))).data;
export const createSupportCompany = async (
  projectId: string,
  company: Record<string, unknown>
) =>
  (await POST(path(projectId, "/companies"), company, { retry: false })).data;
export const getSupportCsat = async (
  projectId: string
): Promise<{ data: SupportCsat[] }> =>
  (await GET(path(projectId, "/csat"))).data;
export const getSupportQuality = async (
  projectId: string
): Promise<{ data: SupportQuality }> =>
  (await GET(path(projectId, "/quality"))).data;
export const getSupportAudit = async (
  projectId: string
): Promise<{ data: SupportAuditEvent[] }> =>
  (await GET(path(projectId, "/audit"))).data;
export const getSupportNotifications = async (
  projectId: string,
  unread = false
): Promise<{ data: SupportNotification[] }> =>
  (await GET(path(projectId, `/notifications${unread ? "?unread=true" : ""}`)))
    .data;
export const markSupportNotificationRead = async (
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
export const getSupportNotificationPreferences = async (
  projectId: string
): Promise<{ data: SupportNotificationPreferences }> =>
  (await GET(path(projectId, "/notifications/preferences"))).data;
export const updateSupportNotificationPreferences = async (
  projectId: string,
  preferences: Omit<
    SupportNotificationPreferences,
    "project_id" | "membership_id" | "updated_at"
  >
) =>
  (
    await PUT(path(projectId, "/notifications/preferences"), preferences, {
      retry: false,
    })
  ).data;
export const markAllSupportNotificationsRead = async (projectId: string) =>
  (
    await POST(path(projectId, "/notifications/read-all"), {}, {
      retry: false,
    })
  ).data;
export const snoozeSupportNotification = async (
  projectId: string,
  notificationId: string,
  snoozedUntil: string | null
) =>
  (
    await PATCH(
      path(
        projectId,
        `/notifications/${encodeURIComponent(notificationId)}/snooze`
      ),
      { snoozed_until: snoozedUntil },
      { retry: false }
    )
  ).data;
export const deleteSupportNotification = async (
  projectId: string,
  notificationId: string
) =>
  (
    await DELETE(
      path(projectId, `/notifications/${encodeURIComponent(notificationId)}`),
      { retry: false }
    )
  ).data;
export const saveSupportDraft = async (
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
export const getSupportDraft = async (
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
export const executeSupportMacro = async (
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

// Source-compatibility aliases for internal adapters.
export type MessagingContact = SupportContact;
export type MessagingContactNote = SupportContactNote;
export type MessagingCompany = SupportCompany;
export type MessagingContactDetail = SupportContactDetail;
export type MessagingCsat = SupportCsat;
export type MessagingNotification = SupportNotification;
export const getMessagingContacts = getSupportContacts;
export const getMessagingContact = getSupportContact;
export const createMessagingContact = createSupportContact;
export const updateMessagingContact = updateSupportContact;
export const getMessagingContactNotes = getSupportContactNotes;
export const createMessagingContactNote = createSupportContactNote;
export const deleteMessagingContactNote = deleteSupportContactNote;
export const getMessagingCompanies = getSupportCompanies;
export const createMessagingCompany = createSupportCompany;
export const getMessagingCsat = getSupportCsat;
export const getMessagingNotifications = getSupportNotifications;
export const markMessagingNotificationRead = markSupportNotificationRead;
export const saveMessagingDraft = saveSupportDraft;
export const getMessagingDraft = getSupportDraft;
export const executeMessagingMacro = executeSupportMacro;
