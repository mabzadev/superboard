export const SUPPORT_NOTIFICATION_SCHEMA_VERSION = 1 as const;
export const SUPPORT_NOTIFICATION_INGRESS_PATH =
  "/internal/v1/push/support-notifications" as const;

export const SUPPORT_NOTIFICATION_LIMITS = Object.freeze({
  networkBodyBytesMaximum: 16 * 1024,
  eventIdLengthMaximum: 200,
  recipientIdLengthMaximum: 255,
  notificationTypeLengthMaximum: 128,
  titleLengthMaximum: 255,
  bodyLengthMaximum: 2_000,
  conversationIdLengthMaximum: 255,
});

export type SupportNotificationChannels = {
  push: boolean;
  browser: boolean;
};

/**
 * Private, provider-neutral event sent from Support to the API Worker.
 *
 * The contract deliberately has no arbitrary metadata bag: credentials,
 * provider payloads and integration secrets cannot be forwarded accidentally.
 */
export type SupportNotificationEvent = {
  schema_version: typeof SUPPORT_NOTIFICATION_SCHEMA_VERSION;
  event_id: string;
  project_id: number;
  recipient_user_id: string;
  notification_type: string;
  title: string;
  body: string;
  conversation_id: string | null;
  occurred_at: string;
  channels: SupportNotificationChannels;
};

export type SupportNotificationReceipt = {
  data: {
    event_id: string;
    duplicate: boolean;
    browser_messages: number;
    push_queued: number;
  };
};

export class SupportNotificationContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupportNotificationContractError";
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/|+=-]*$/u;
const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9._:-]*$/u;
const ROOT_KEYS = new Set([
  "schema_version",
  "event_id",
  "project_id",
  "recipient_user_id",
  "notification_type",
  "title",
  "body",
  "conversation_id",
  "occurred_at",
  "channels",
]);
const CHANNEL_KEYS = new Set(["push", "browser"]);

function object(
  value: unknown,
  code: string,
  field: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SupportNotificationContractError(code, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new SupportNotificationContractError(
      "support_notification_field_unknown",
      `${field}.${unknown} is not allowed`,
    );
  }
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    throw new SupportNotificationContractError(
      "support_notification_field_invalid",
      `${field} must be a string between ${allowEmpty ? 0 : 1} and ${maximum} characters`,
    );
  }
  return value;
}

function identifier(value: unknown, field: string, maximum: number): string {
  const result = text(value, field, maximum);
  if (!IDENTIFIER_PATTERN.test(result)) {
    throw new SupportNotificationContractError(
      "support_notification_identifier_invalid",
      `${field} contains unsupported characters`,
    );
  }
  return result;
}

export function parseSupportNotificationEvent(
  value: unknown,
): SupportNotificationEvent {
  const input = object(
    value,
    "support_notification_invalid",
    "notification",
  );
  exactKeys(input, ROOT_KEYS, "notification");
  if (input.schema_version !== SUPPORT_NOTIFICATION_SCHEMA_VERSION) {
    throw new SupportNotificationContractError(
      "support_notification_schema_unsupported",
      `schema_version must be ${SUPPORT_NOTIFICATION_SCHEMA_VERSION}`,
    );
  }
  if (
    typeof input.project_id !== "number" ||
    !Number.isSafeInteger(input.project_id) ||
    input.project_id < 1
  ) {
    throw new SupportNotificationContractError(
      "support_notification_project_invalid",
      "project_id must be a positive safe integer",
    );
  }
  const notificationType = text(
    input.notification_type,
    "notification_type",
    SUPPORT_NOTIFICATION_LIMITS.notificationTypeLengthMaximum,
  );
  if (!EVENT_TYPE_PATTERN.test(notificationType)) {
    throw new SupportNotificationContractError(
      "support_notification_type_invalid",
      "notification_type contains unsupported characters",
    );
  }
  const occurredAt = text(input.occurred_at, "occurred_at", 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u.test(occurredAt)) {
    throw new SupportNotificationContractError(
      "support_notification_time_invalid",
      "occurred_at must be an RFC 3339 UTC timestamp",
    );
  }
  const channels = object(
    input.channels,
    "support_notification_channels_invalid",
    "channels",
  );
  exactKeys(channels, CHANNEL_KEYS, "channels");
  if (typeof channels.push !== "boolean" || typeof channels.browser !== "boolean") {
    throw new SupportNotificationContractError(
      "support_notification_channels_invalid",
      "channels.push and channels.browser must be booleans",
    );
  }
  const conversationId = input.conversation_id === null
    ? null
    : identifier(
        input.conversation_id,
        "conversation_id",
        SUPPORT_NOTIFICATION_LIMITS.conversationIdLengthMaximum,
      );
  return {
    schema_version: SUPPORT_NOTIFICATION_SCHEMA_VERSION,
    event_id: identifier(
      input.event_id,
      "event_id",
      SUPPORT_NOTIFICATION_LIMITS.eventIdLengthMaximum,
    ),
    project_id: input.project_id,
    recipient_user_id: identifier(
      input.recipient_user_id,
      "recipient_user_id",
      SUPPORT_NOTIFICATION_LIMITS.recipientIdLengthMaximum,
    ),
    notification_type: notificationType,
    title: text(
      input.title,
      "title",
      SUPPORT_NOTIFICATION_LIMITS.titleLengthMaximum,
      { allowEmpty: true },
    ),
    body: text(
      input.body,
      "body",
      SUPPORT_NOTIFICATION_LIMITS.bodyLengthMaximum,
      { allowEmpty: true },
    ),
    conversation_id: conversationId,
    occurred_at: occurredAt,
    channels: { push: channels.push, browser: channels.browser },
  };
}

export function parseSupportNotificationReceipt(
  value: unknown,
): SupportNotificationReceipt {
  const root = object(value, "support_notification_receipt_invalid", "receipt");
  const data = object(root.data, "support_notification_receipt_invalid", "receipt.data");
  const nonNegativeInteger = (field: "browser_messages" | "push_queued") => {
    const raw = data[field];
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) {
      throw new SupportNotificationContractError(
        "support_notification_receipt_invalid",
        `receipt.data.${field} must be a non-negative integer`,
      );
    }
    return raw;
  };
  if (typeof data.duplicate !== "boolean") {
    throw new SupportNotificationContractError(
      "support_notification_receipt_invalid",
      "receipt.data.duplicate must be a boolean",
    );
  }
  return {
    data: {
      event_id: identifier(
        data.event_id,
        "receipt.data.event_id",
        SUPPORT_NOTIFICATION_LIMITS.eventIdLengthMaximum,
      ),
      duplicate: data.duplicate,
      browser_messages: nonNegativeInteger("browser_messages"),
      push_queued: nonNegativeInteger("push_queued"),
    },
  };
}
