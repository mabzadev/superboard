export const SUPERBOARD_SUPPORT_WIDGET_PATH: "/api/v1/support-widget";
export const SUPERBOARD_SUPPORT_REALTIME_PATH: "/api/v1/support/realtime";

export type SuperBoardSupportIdentityTokenProvider = () =>
  | Promise<string | { token: string }>
  | string
  | { token: string };

export type SuperBoardSupportWidgetSignatureProvider = (request: {
  method: string;
  path: string;
  bodySha256: string;
  canonicalInput: string;
  projectId: string;
  visitorId: string;
  timestamp: string;
  idempotencyKey: string | null;
}) =>
  | Promise<string | { signature: string; timestamp?: string }>
  | string
  | { signature: string; timestamp?: string };

export interface SuperBoardSupportClientOptions {
  baseUrl?: string | URL;
  projectId: string | number;
  identityToken?: string | null;
  identityTokenProvider?: SuperBoardSupportIdentityTokenProvider | null;
  widgetKey?: string | null;
  widgetSignatureProvider?: SuperBoardSupportWidgetSignatureProvider | null;
  visitorId?: string | null;
  allowedDomains?: string[];
  fetch?: typeof globalThis.fetch;
  webSocketFactory?: (url: string) => WebSocket | Promise<WebSocket>;
  requestTimeoutMs?: number;
  retryDelaysMs?: number[];
}

export interface SuperBoardSupportErrorOptions {
  retryable?: boolean;
  statusCode?: number | null;
  requestId?: string | null;
  details?: Record<string, unknown> | null;
  cause?: unknown;
}

export class SuperBoardSupportException extends Error {
  constructor(code: string, message: string, options?: SuperBoardSupportErrorOptions);
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number | null;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;
  toJSON(): {
    code: string;
    message: string;
    retryable: boolean;
    status_code: number | null;
    request_id: string | null;
    details: Record<string, unknown> | null;
  };
}

export interface SuperBoardSupportConversation {
  id: string;
  display_id?: number | null;
  status: "open" | "pending" | "closed";
  priority?: "low" | "normal" | "high" | "urgent";
  subject?: string | null;
  unread_count?: number;
  inbox_id?: string | null;
  custom_attributes?: Record<string, unknown>;
  snoozed_until?: string | null;
  [key: string]: unknown;
}

export interface SuperBoardSupportMessage {
  id: string;
  conversation_id: string;
  sender_kind: "user" | "agent" | "system" | "bot";
  sequence?: number;
  body?: string | null;
  attachments?: Array<Record<string, unknown>>;
  visibility?: "public" | "private";
  content_type?: string;
  delivery_status?: "pending" | "sent" | "delivered" | "read" | "failed";
  created_at?: string;
  [key: string]: unknown;
}

export interface SuperBoardSupportRealtimeEvent {
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
  message?: SuperBoardSupportMessage;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export class SuperBoardSupportRealtime {
  constructor(client: SuperBoardSupportClient, options?: { retryDelaysMs?: number[] });
  readonly connected: boolean;
  readonly conversationId: string | null;
  subscribe(listener: (event: SuperBoardSupportRealtimeEvent) => void): () => boolean;
  connect(conversationId: string): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): Promise<void>;
}

export class SuperBoardSupportClient {
  constructor(options: SuperBoardSupportClientOptions);
  readonly baseUrl: string;
  readonly projectId: string;
  readonly visitorId: string | null;
  setIdentityToken(value: string): void;
  assertAllowedDomain(): void;
  configuration(): Promise<Record<string, unknown>>;
  createConversation(input: {
    clientConversationId: string;
    subject?: string;
    inboxId?: string;
    customAttributes?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<SuperBoardSupportConversation>;
  conversations(input?: { cursor?: string; limit?: number }): Promise<SuperBoardSupportConversation[]>;
  updateConversation(
    conversationId: string,
    input?: {
      status?: "open" | "pending" | "closed";
      customAttributes?: Record<string, unknown>;
      snoozedUntil?: string | null;
      idempotencyKey?: string;
    },
  ): Promise<SuperBoardSupportConversation>;
  messages(
    conversationId: string,
    input?: { cursor?: string; beforeSequence?: number; limit?: number },
  ): Promise<SuperBoardSupportMessage[]>;
  sendMessage(
    conversationId: string,
    input: {
      body?: string;
      clientMessageId: string;
      contentType?: string;
      replyToMessageId?: string;
      metadata?: Record<string, unknown>;
      attachments?: Array<Record<string, unknown>>;
      idempotencyKey?: string;
    },
  ): Promise<SuperBoardSupportMessage>;
  editMessage(
    conversationId: string,
    messageId: string,
    input?: { body?: string; metadata?: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<SuperBoardSupportMessage>;
  deleteMessage(
    conversationId: string,
    messageId: string,
    input?: { idempotencyKey?: string },
  ): Promise<Record<string, unknown>>;
  uploadAttachment(
    conversationId: string,
    input: {
      data: Blob | ArrayBuffer | ArrayBufferView;
      filename: string;
      contentType: string;
      idempotencyKey?: string;
    },
  ): Promise<Record<string, unknown>>;
  downloadAttachment(
    conversationId: string,
    messageId: string,
    input?: { attachmentId?: string },
  ): Promise<ArrayBuffer>;
  markRead(conversationId: string, input?: { idempotencyKey?: string }): Promise<string>;
  setTyping(
    conversationId: string,
    active: boolean,
    input?: { idempotencyKey?: string },
  ): Promise<void>;
  contact(): Promise<Record<string, unknown>>;
  updateContact(input?: {
    name?: string;
    email?: string;
    phone?: string;
    customAttributes?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>>;
  trackEvent(input: {
    name: string;
    properties?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>>;
  inboxMembers(inboxId: string): Promise<Record<string, unknown>[]>;
  proactiveSupport(input?: { cursor?: string; limit?: number }): Promise<Record<string, unknown>[]>;
  conversationLabels(conversationId: string): Promise<Record<string, unknown>[]>;
  requestTranscript(
    conversationId: string,
    input?: { idempotencyKey?: string },
  ): Promise<Record<string, unknown>>;
  submitCsat(
    conversationId: string,
    input: { rating: number; feedback?: string; idempotencyKey?: string },
  ): Promise<Record<string, unknown>>;
  helpCenterCategories(input: {
    portalSlug: string;
    locale?: string;
  }): Promise<Record<string, unknown>[]>;
  searchHelpCenter(input: {
    portalSlug: string;
    query: string;
    locale?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]>;
  helpCenterArticle(input: {
    portalSlug: string;
    articleSlug: string;
    locale?: string;
  }): Promise<Record<string, unknown>>;
  recordHelpCenterView(input: {
    portalSlug: string;
    articleSlug: string;
    idempotencyKey?: string;
  }): Promise<Record<string, unknown>>;
  joinMeeting(
    conversationId: string,
    input?: { meetingId?: string; idempotencyKey?: string },
  ): Promise<Record<string, unknown>>;
  requestRealtimeTicket(
    conversationId: string,
    input?: { idempotencyKey?: string },
  ): Promise<{ ticket: string; expires_at?: string }>;
  realtime(options?: { retryDelaysMs?: number[] }): SuperBoardSupportRealtime;
  close(): void;
}

export interface SuperBoardSupportWidgetOptions {
  client: SuperBoardSupportClient;
  title?: string;
  launcherLabel?: string;
  closeLabel?: string;
  emptyMessage?: string;
  inputLabel?: string;
  sendLabel?: string;
  locale?: string;
}

export class SuperBoardSupportWidget {
  constructor(options: SuperBoardSupportWidgetOptions);
  mount(target: string | Element): this;
  open(): Promise<void>;
  close(): void;
  setIdentityToken(value: string): void;
  destroy(): Promise<void>;
}
