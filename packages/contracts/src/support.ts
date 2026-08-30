export const SUPPORT_SCHEMA_VERSION = 1 as const;

export const SUPPORT_ROUTE_PREFIXES = Object.freeze({
  client: "/api/v1/support-client",
  widget: "/api/v1/support-widget",
  dashboard: "/api/v1/support/projects",
  providers: "/api/v1/support/providers",
  realtime: "/api/v1/support/realtime",
  helpCenter: "/api/v1/support/help-center",
});

export const SUPPORT_LIMITS = Object.freeze({
  pageSizeDefault: 50,
  pageSizeMaximum: 100,
  cursorLengthMaximum: 512,
  identifierLengthMaximum: 255,
  idempotencyKeyLengthMinimum: 1,
  idempotencyKeyLengthMaximum: 200,
  messageBodyBytesMaximum: 64 * 1024,
  attachmentBytesMaximum: 10 * 1024 * 1024,
  metadataBytesMaximum: 32 * 1024,
  queuePayloadBytesMaximum: 128 * 1024,
});

export const SUPPORT_CONVERSATION_STATUSES = [
  "open",
  "pending",
  "closed",
] as const;
export type SupportConversationStatus =
  (typeof SUPPORT_CONVERSATION_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_MESSAGE_VISIBILITIES = ["public", "private"] as const;
export type SupportMessageVisibility =
  (typeof SUPPORT_MESSAGE_VISIBILITIES)[number];

export const SUPPORT_MESSAGE_CONTENT_TYPES = [
  "text",
  "html",
  "input_select",
  "form",
  "location",
  "file",
  "system",
] as const;
export type SupportMessageContentType =
  (typeof SUPPORT_MESSAGE_CONTENT_TYPES)[number];

export const SUPPORT_PROVIDER_STATUSES = [
  "configured",
  "validated",
  "configuration_required",
  "degraded",
  "live_validated",
] as const;
export type SupportProviderStatus = (typeof SUPPORT_PROVIDER_STATUSES)[number];

export type SupportApiMeta = {
  request_id?: string;
  next_cursor?: string | null;
};

export type SupportApiSuccess<T> = {
  data: T;
  meta?: SupportApiMeta;
};

export type SupportApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
  request_id?: string;
  details?: Record<string, unknown>;
};

export type SupportApiError = {
  error: SupportApiErrorBody;
};

export type SupportCursorPage<T> = SupportApiSuccess<ReadonlyArray<T>> & {
  meta: SupportApiMeta & { next_cursor: string | null };
};

export type SupportConversationDto = {
  id: string;
  display_id?: number | null;
  external_id?: string | null;
  status: SupportConversationStatus;
  priority: SupportPriority;
  unread_count: number;
  subject?: string | null;
  inbox_id?: string | null;
  assigned_agent_id?: string | null;
  assigned_team_id?: string | null;
  custom_attributes: Record<string, unknown>;
  snoozed_until?: string | null;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SupportMessageAttachmentDto = {
  id: string;
  file_name: string;
  content_type: string;
  byte_size?: number | null;
  position: number;
  download_url?: string | null;
};

export type SupportMessageDto = {
  id: string;
  conversation_id: string;
  source_id?: string | null;
  provider_message_id?: string | null;
  sender_kind: "user" | "agent" | "system" | "bot";
  sequence: number;
  body?: string | null;
  attachments: ReadonlyArray<SupportMessageAttachmentDto>;
  visibility: SupportMessageVisibility;
  content_type: SupportMessageContentType;
  reply_to_message_id?: string | null;
  metadata: Record<string, unknown>;
  delivery_status?: "pending" | "sent" | "delivered" | "read" | "failed";
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
};

export type SupportContactDto = {
  id: string;
  external_id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar_url?: string | null;
  company_id?: string | null;
  custom_attributes: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type SupportCompanyDto = {
  id: string;
  external_id?: string | null;
  name: string;
  domain?: string | null;
  custom_attributes: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type SupportInboxDto = {
  id: string;
  name: string;
  channel_type: string;
  provider_id?: string | null;
  enabled: boolean;
  availability: "online" | "offline" | "auto";
  allowed_domains?: ReadonlyArray<string>;
  created_at?: string;
  updated_at?: string;
};

export type SupportProviderDto = {
  id: string;
  kind: string;
  name: string;
  status: SupportProviderStatus;
  capabilities: ReadonlyArray<string>;
  last_validated_at?: string | null;
  last_error_code?: string | null;
  created_at?: string;
  updated_at?: string;
};

export const SUPPORT_REALTIME_EVENT_TYPES = [
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
] as const;
export type SupportRealtimeEventType =
  (typeof SUPPORT_REALTIME_EVENT_TYPES)[number];

type SupportRealtimeBase<T extends SupportRealtimeEventType> = {
  schema_version: typeof SUPPORT_SCHEMA_VERSION;
  type: T;
  event_id: string;
  conversation_id: string;
  occurred_at: string;
};

export type SupportRealtimeEvent =
  | (SupportRealtimeBase<"connected"> & {
      cursor?: string | null;
    })
  | (SupportRealtimeBase<"message.created" | "message.updated"> & {
      message: SupportMessageDto;
    })
  | (SupportRealtimeBase<"message.deleted"> & {
      message_id: string;
    })
  | (SupportRealtimeBase<"conversation.updated"> & {
      conversation: SupportConversationDto;
    })
  | (SupportRealtimeBase<"typing.started" | "typing.stopped"> & {
      actor_id?: string | null;
      actor_kind: "user" | "agent" | "bot";
    })
  | (SupportRealtimeBase<"conversation.read"> & {
      actor_id?: string | null;
      read_at: string;
      sequence?: number | null;
    })
  | (SupportRealtimeBase<"delivery.updated"> & {
      message_id: string;
      status: "pending" | "sent" | "delivered" | "read" | "failed";
      reason_code?: string | null;
    })
  | (SupportRealtimeBase<"presence.updated"> & {
      actor_id: string;
      presence: "online" | "away" | "offline";
    })
  | (SupportRealtimeBase<"assignment.updated"> & {
      agent_id?: string | null;
      team_id?: string | null;
      inbox_id?: string | null;
    })
  | (SupportRealtimeBase<"error"> & {
      error: SupportApiErrorBody;
    });

export const SUPPORT_QUEUE_EVENT_TYPES = [
  "support.conversation.created.v1",
  "support.conversation.updated.v1",
  "support.message.created.v1",
  "support.message.delivery_requested.v1",
  "support.message.delivery_updated.v1",
  "support.provider.event_received.v1",
  "support.notification.requested.v1",
  "support.campaign.dispatch_requested.v1",
  "support.contact.import_requested.v1",
  "support.contact.export_requested.v1",
  "support.help_center.index_requested.v1",
  "support.captain.task_requested.v1",
  "support.reporting.rollup_requested.v1",
] as const;
export type SupportQueueEventType = (typeof SUPPORT_QUEUE_EVENT_TYPES)[number];

export type SupportQueueEvent<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = {
  schema_version: typeof SUPPORT_SCHEMA_VERSION;
  type: SupportQueueEventType;
  event_id: string;
  project_id: number;
  occurred_at: string;
  attempt: number;
  idempotency_key: string;
  payload: TPayload;
};

export type SupportCursorPagination = {
  cursor?: string;
  limit: number;
};

export class SupportContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SupportContractError";
    this.code = code;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9._~+=/-]+$/u;

export function parseSupportIdentifier(
  value: unknown,
  field = "identifier",
): string {
  const result = boundedString(
    value,
    field,
    1,
    SUPPORT_LIMITS.identifierLengthMaximum,
  );
  if (!IDENTIFIER_PATTERN.test(result)) {
    throw new SupportContractError(
      "support_identifier_invalid",
      `${field} contains unsupported characters`,
    );
  }
  return result;
}

export function parseSupportIdempotencyKey(value: unknown): string {
  const result = boundedString(
    value,
    "idempotency_key",
    SUPPORT_LIMITS.idempotencyKeyLengthMinimum,
    SUPPORT_LIMITS.idempotencyKeyLengthMaximum,
  );
  if (!IDEMPOTENCY_PATTERN.test(result)) {
    throw new SupportContractError(
      "support_idempotency_key_invalid",
      "idempotency_key contains unsupported characters",
    );
  }
  return result;
}

export function parseSupportCursorPagination(
  value: unknown,
): SupportCursorPagination {
  const input =
    value === undefined ? {} : record(value, "support_page_invalid");
  const rawLimit = input.limit ?? SUPPORT_LIMITS.pageSizeDefault;
  const limit =
    typeof rawLimit === "string" && /^\d+$/u.test(rawLimit)
      ? Number(rawLimit)
      : rawLimit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SUPPORT_LIMITS.pageSizeMaximum
  ) {
    throw new SupportContractError(
      "support_page_limit_invalid",
      `limit must be an integer between 1 and ${SUPPORT_LIMITS.pageSizeMaximum}`,
    );
  }
  if (
    input.cursor === undefined ||
    input.cursor === null ||
    input.cursor === ""
  ) {
    return { limit };
  }
  const cursor = boundedString(
    input.cursor,
    "cursor",
    1,
    SUPPORT_LIMITS.cursorLengthMaximum,
  );
  if (!CURSOR_PATTERN.test(cursor)) {
    throw new SupportContractError(
      "support_cursor_invalid",
      "cursor contains unsupported characters",
    );
  }
  return { cursor, limit };
}

export function parseSupportApiError(value: unknown): SupportApiErrorBody {
  const input = record(value, "support_error_invalid");
  const nested = isRecord(input.error) ? input.error : input;
  const details =
    nested.details === undefined
      ? undefined
      : boundedJsonObject(
          nested.details,
          "details",
          SUPPORT_LIMITS.metadataBytesMaximum,
        );
  return {
    code: boundedString(nested.code, "code", 1, 128),
    message: boundedString(nested.message, "message", 1, 2_048),
    retryable: nested.retryable === true,
    ...(nested.request_id === undefined || nested.request_id === null
      ? {}
      : { request_id: boundedString(nested.request_id, "request_id", 1, 255) }),
    ...(details ? { details } : {}),
  };
}

export function parseSupportConversationDto(
  value: unknown,
): SupportConversationDto {
  const input = record(value, "support_conversation_invalid");
  const status = input.status;
  if (
    typeof status !== "string" ||
    !SUPPORT_CONVERSATION_STATUSES.includes(status as SupportConversationStatus)
  ) {
    throw new SupportContractError(
      "support_conversation_status_invalid",
      "Conversation status is invalid",
    );
  }
  const priority = input.priority;
  if (
    typeof priority !== "string" ||
    !SUPPORT_PRIORITIES.includes(priority as SupportPriority)
  ) {
    throw new SupportContractError(
      "support_conversation_priority_invalid",
      "Conversation priority is invalid",
    );
  }
  const unreadCount = integerInRange(
    input.unread_count ?? 0,
    "unread_count",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const displayId = optionalIntegerInRange(
    input.display_id,
    "display_id",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  return {
    id: parseSupportIdentifier(input.id, "id"),
    ...(displayId === undefined ? {} : { display_id: displayId }),
    ...optionalBoundedString("external_id", input.external_id, 255),
    status: status as SupportConversationStatus,
    priority: priority as SupportPriority,
    unread_count: unreadCount,
    ...optionalBoundedString("subject", input.subject, 255),
    ...optionalIdentifierField("inbox_id", input.inbox_id),
    ...optionalIdentifierField("assigned_agent_id", input.assigned_agent_id),
    ...optionalIdentifierField("assigned_team_id", input.assigned_team_id),
    custom_attributes: boundedJsonObject(
      input.custom_attributes ?? {},
      "custom_attributes",
      SUPPORT_LIMITS.metadataBytesMaximum,
    ),
    ...optionalTimestampField("snoozed_until", input.snoozed_until),
    ...optionalBoundedString(
      "last_message_preview",
      input.last_message_preview,
      2_048,
    ),
    ...optionalTimestampField("last_message_at", input.last_message_at),
    ...optionalNonNullTimestampField("created_at", input.created_at),
    ...optionalNonNullTimestampField("updated_at", input.updated_at),
  };
}

export function parseSupportMessageDto(value: unknown): SupportMessageDto {
  const input = record(value, "support_message_invalid");
  const senderKind = input.sender_kind;
  if (
    typeof senderKind !== "string" ||
    !["user", "agent", "system", "bot"].includes(senderKind)
  ) {
    throw new SupportContractError(
      "support_message_sender_invalid",
      "Message sender kind is invalid",
    );
  }
  const visibility = input.visibility ?? "public";
  if (
    typeof visibility !== "string" ||
    !SUPPORT_MESSAGE_VISIBILITIES.includes(
      visibility as SupportMessageVisibility,
    )
  ) {
    throw new SupportContractError(
      "support_message_visibility_invalid",
      "Message visibility is invalid",
    );
  }
  const contentType = input.content_type ?? "text";
  if (
    typeof contentType !== "string" ||
    !SUPPORT_MESSAGE_CONTENT_TYPES.includes(
      contentType as SupportMessageContentType,
    )
  ) {
    throw new SupportContractError(
      "support_message_content_type_invalid",
      "Message content type is invalid",
    );
  }
  const attachments = input.attachments ?? [];
  if (!Array.isArray(attachments) || attachments.length > 50) {
    throw new SupportContractError(
      "support_attachments_invalid",
      "Message attachments must contain at most 50 items",
    );
  }
  const body =
    input.body === undefined || input.body === null
      ? undefined
      : boundedUtf8String(
          input.body,
          "body",
          SUPPORT_LIMITS.messageBodyBytesMaximum,
        );
  const deliveryStatus = input.delivery_status;
  if (
    deliveryStatus !== undefined &&
    deliveryStatus !== null &&
    (typeof deliveryStatus !== "string" ||
      !["pending", "sent", "delivered", "read", "failed"].includes(
        deliveryStatus,
      ))
  ) {
    throw new SupportContractError(
      "support_delivery_status_invalid",
      "Message delivery status is invalid",
    );
  }
  return {
    id: parseSupportIdentifier(input.id, "id"),
    conversation_id: parseSupportIdentifier(
      input.conversation_id,
      "conversation_id",
    ),
    ...optionalIdentifierField("source_id", input.source_id),
    ...optionalIdentifierField(
      "provider_message_id",
      input.provider_message_id,
    ),
    sender_kind: senderKind as SupportMessageDto["sender_kind"],
    sequence: integerInRange(
      input.sequence,
      "sequence",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    ...(body === undefined ? {} : { body }),
    attachments: attachments.map(parseSupportAttachmentDto),
    visibility: visibility as SupportMessageVisibility,
    content_type: contentType as SupportMessageContentType,
    ...optionalIdentifierField(
      "reply_to_message_id",
      input.reply_to_message_id,
    ),
    metadata: boundedJsonObject(
      input.metadata ?? {},
      "metadata",
      SUPPORT_LIMITS.metadataBytesMaximum,
    ),
    ...(deliveryStatus === undefined || deliveryStatus === null
      ? {}
      : {
          delivery_status:
            deliveryStatus as SupportMessageDto["delivery_status"],
        }),
    created_at: parseTimestamp(input.created_at, "created_at"),
    ...optionalNonNullTimestampField("updated_at", input.updated_at),
    ...optionalTimestampField("deleted_at", input.deleted_at),
  };
}

export function parseSupportAttachmentDto(
  value: unknown,
): SupportMessageAttachmentDto {
  const input = record(value, "support_attachment_invalid");
  const byteSize = optionalIntegerInRange(
    input.byte_size,
    "byte_size",
    0,
    SUPPORT_LIMITS.attachmentBytesMaximum,
  );
  return {
    id: parseSupportIdentifier(input.id, "id"),
    file_name: boundedString(input.file_name, "file_name", 1, 255),
    content_type: boundedString(input.content_type, "content_type", 1, 255),
    ...(byteSize === undefined ? {} : { byte_size: byteSize }),
    position: integerInRange(input.position, "position", 0, 49),
    ...optionalBoundedString("download_url", input.download_url, 2_048),
  };
}

export function parseSupportRealtimeEvent(
  value: unknown,
): SupportRealtimeEvent {
  const input = record(value, "support_realtime_event_invalid");
  if (input.schema_version !== SUPPORT_SCHEMA_VERSION) {
    throw new SupportContractError(
      "support_schema_unsupported",
      "Support realtime schema version is not supported",
    );
  }
  if (
    typeof input.type !== "string" ||
    !SUPPORT_REALTIME_EVENT_TYPES.includes(
      input.type as SupportRealtimeEventType,
    )
  ) {
    throw new SupportContractError(
      "support_realtime_type_invalid",
      "Support realtime event type is invalid",
    );
  }
  parseSupportIdentifier(input.event_id, "event_id");
  parseSupportIdentifier(input.conversation_id, "conversation_id");
  parseTimestamp(input.occurred_at, "occurred_at");
  boundedJsonObject(input, "event", SUPPORT_LIMITS.queuePayloadBytesMaximum);
  if (input.type === "message.created" || input.type === "message.updated") {
    parseSupportMessageDto(input.message);
  }
  if (input.type === "conversation.updated") {
    parseSupportConversationDto(input.conversation);
  }
  return input as SupportRealtimeEvent;
}

export function parseSupportQueueEvent(value: unknown): SupportQueueEvent {
  const input = record(value, "support_queue_event_invalid");
  if (input.schema_version !== SUPPORT_SCHEMA_VERSION) {
    throw new SupportContractError(
      "support_schema_unsupported",
      "Support queue schema version is not supported",
    );
  }
  if (
    typeof input.type !== "string" ||
    !SUPPORT_QUEUE_EVENT_TYPES.includes(input.type as SupportQueueEventType)
  ) {
    throw new SupportContractError(
      "support_queue_type_invalid",
      "Support queue event type is invalid",
    );
  }
  const projectId = input.project_id;
  if (
    typeof projectId !== "number" ||
    !Number.isSafeInteger(projectId) ||
    projectId <= 0
  ) {
    throw new SupportContractError(
      "support_project_id_invalid",
      "project_id must be a positive safe integer",
    );
  }
  const attempt = input.attempt;
  if (
    typeof attempt !== "number" ||
    !Number.isSafeInteger(attempt) ||
    attempt < 0 ||
    attempt > 100
  ) {
    throw new SupportContractError(
      "support_attempt_invalid",
      "attempt must be an integer between 0 and 100",
    );
  }
  const payload = boundedJsonObject(
    input.payload,
    "payload",
    SUPPORT_LIMITS.queuePayloadBytesMaximum,
  );
  return {
    schema_version: SUPPORT_SCHEMA_VERSION,
    type: input.type as SupportQueueEventType,
    event_id: parseSupportIdentifier(input.event_id, "event_id"),
    project_id: projectId,
    occurred_at: parseTimestamp(input.occurred_at, "occurred_at"),
    attempt,
    idempotency_key: parseSupportIdempotencyKey(input.idempotency_key),
    payload,
  };
}

function parseTimestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, 1, 64);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) {
    throw new SupportContractError(
      "support_timestamp_invalid",
      `${field} must be an ISO-8601 timestamp`,
    );
  }
  return parsed.toISOString();
}

function optionalTimestampField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string | null>> {
  if (value === undefined) return {};
  if (value === null || value === "")
    return { [key]: null } as Partial<Record<K, null>>;
  return { [key]: parseTimestamp(value, key) } as Partial<Record<K, string>>;
}

function optionalNonNullTimestampField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (value === undefined || value === null || value === "") return {};
  return { [key]: parseTimestamp(value, key) } as Partial<Record<K, string>>;
}

function optionalIdentifierField<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string | null>> {
  if (value === undefined) return {};
  if (value === null || value === "")
    return { [key]: null } as Partial<Record<K, null>>;
  return { [key]: parseSupportIdentifier(value, key) } as Partial<
    Record<K, string>
  >;
}

function optionalBoundedString<K extends string>(
  key: K,
  value: unknown,
  maximum: number,
): Partial<Record<K, string | null>> {
  if (value === undefined) return {};
  if (value === null || value === "")
    return { [key]: null } as Partial<Record<K, null>>;
  return { [key]: boundedString(value, key, 1, maximum) } as Partial<
    Record<K, string>
  >;
}

function optionalIntegerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return integerInRange(value, field, minimum, maximum);
}

function integerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new SupportContractError(
      "support_integer_invalid",
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function boundedUtf8String(
  value: unknown,
  field: string,
  maximumBytes: number,
): string {
  if (typeof value !== "string") {
    throw new SupportContractError(
      "support_field_invalid",
      `${field} must be a string`,
    );
  }
  if (new TextEncoder().encode(value).byteLength > maximumBytes) {
    throw new SupportContractError(
      "support_field_too_large",
      `${field} exceeds ${maximumBytes} bytes`,
    );
  }
  return value;
}

function boundedString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== "string") {
    throw new SupportContractError(
      "support_field_invalid",
      `${field} must be a string`,
    );
  }
  const result = value.trim();
  if (result.length < minimum || result.length > maximum) {
    throw new SupportContractError(
      "support_field_invalid",
      `${field} must contain between ${minimum} and ${maximum} characters`,
    );
  }
  return result;
}

function boundedJsonObject(
  value: unknown,
  field: string,
  maximumBytes: number,
): Record<string, unknown> {
  const result = record(value, "support_object_invalid");
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new SupportContractError(
      "support_object_invalid",
      `${field} must be JSON serializable`,
    );
  }
  if (new TextEncoder().encode(serialized).byteLength > maximumBytes) {
    throw new SupportContractError(
      "support_object_too_large",
      `${field} exceeds ${maximumBytes} bytes`,
    );
  }
  return result;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new SupportContractError(code, "Expected a JSON object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
