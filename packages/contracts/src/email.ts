export const EMAIL_SERVICE_SEND_PATH = "/internal/v1/messages";
export const EMAIL_SERVICE_OPERATIONS_PATH = "/internal/v1/operations";
export const EMAIL_SERVICE_DEAD_LETTERS_PATH =
  "/internal/v1/operations/dead-letters";
export const EMAIL_SERVICE_SMTP_TRANSPORT_PATH = "/internal/v1/transport/smtp";
export const EMAIL_SERVICE_PROVIDER_EVENTS_PATH =
  "/internal/v1/transport/provider-events";
export const EMAIL_SERVICE_INBOUND_NORMALIZE_PATH =
  "/internal/v1/inbound-email/normalize";
export const EMAIL_SERVICE_AWS_SES_EVENTS_PATH = "/public/v1/aws-ses/events";

export const EMAIL_INBOUND_SCHEMA_VERSION = 1 as const;
export const EMAIL_INBOUND_PROVIDER_HEADER =
  "X-SuperBoard-Email-Provider" as const;
export const EMAIL_INBOUND_ENDPOINT_HEADER =
  "X-SuperBoard-Email-Endpoint-Id" as const;
export const EMAIL_INBOUND_PROVIDER_VERIFIED_HEADER =
  "X-SuperBoard-Email-Provider-Verified" as const;
export const EMAIL_INBOUND_LIMITS = Object.freeze({
  networkBodyBytesMaximum: 2 * 1024 * 1024,
  canonicalEnvelopeBytesMaximum: 512 * 1024,
  bodyBytesMaximum: 512 * 1024,
  metadataBytesMaximum: 32 * 1024,
  identifierLengthMaximum: 512,
  subjectLengthMaximum: 998,
  recipientsMaximum: 100,
  referencesMaximum: 100,
  attachmentsMaximum: 50,
  attachmentBytesMaximum: 10 * 1024 * 1024,
});

export const EMAIL_INBOUND_PROVIDERS = ["google", "microsoft", "smtp"] as const;
export type EmailInboundProvider = (typeof EMAIL_INBOUND_PROVIDERS)[number];

export type EmailInboundAddress = {
  email: string;
  name: string | null;
};

export type EmailInboundAttachment = {
  provider_attachment_id: string;
  file_name: string;
  content_type: string;
  byte_size: number;
  content_id: string | null;
  download_url: string | null;
};

export type EmailAuthenticityResult =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "unknown";

/**
 * Provider-neutral inbound message used only between SuperBoard services.
 * Provider payloads and authentication headers never become part of the
 * public Support contract.
 */
export type EmailInboundEnvelope = {
  schema_version: typeof EMAIL_INBOUND_SCHEMA_VERSION;
  provider: EmailInboundProvider;
  endpoint_id: string;
  provider_message_id: string;
  received_at: string;
  sent_at: string | null;
  from: EmailInboundAddress;
  to: EmailInboundAddress[];
  cc: EmailInboundAddress[];
  bcc: EmailInboundAddress[];
  subject: string;
  body: {
    text: string | null;
    html: string | null;
  };
  thread: {
    message_id: string | null;
    in_reply_to: string | null;
    references: string[];
  };
  attachments: EmailInboundAttachment[];
  authenticity: {
    provider_verified: boolean;
    spf: EmailAuthenticityResult;
    dkim: EmailAuthenticityResult;
    dmarc: EmailAuthenticityResult;
  };
  metadata: Record<string, unknown>;
};

export type EmailInboundNormalizationResponse = {
  data: EmailInboundEnvelope;
};

export type EmailKind = "transactional" | "marketing" | "test";

export interface EmailServiceMessage {
  kind: EmailKind;
  to: string | string[];
  /**
   * Stable identifier for the business event that produced the message.
   * Reusing it with the same normalized payload returns the original receipt;
   * reusing it with a different payload is rejected.
   */
  idempotencyKey?: string | null;
  subject: string;
  text?: string | null;
  html?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string>;
  projectId?: number | null;
  templateKey?: string | null;
  metadata?: Record<string, unknown>;
}

export interface EmailServiceReceipt {
  id: string;
  status: "captured" | "queued" | "sent";
  transport: "capture" | "smtp";
  providerMessageId?: string;
  replayed?: boolean;
}

export type EmailSmtpPublicConfig = {
  host: string;
  port: number;
  security: "tls" | "starttls" | "plain";
  username: string | null;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
};

export type EmailSmtpSecretConfig = { password: string | null };

export type EmailSmtpTransportMessage = {
  to: string;
  subject: string;
  html: string | null;
  text: string | null;
  headers?: Record<string, string>;
};

/**
 * Private Worker-to-Worker command used by domain modules that retain their
 * own sender profiles. The Email Worker is the only component allowed to open
 * the SMTP socket; the caller remains responsible for consent, quotas and
 * profile selection.
 */
export interface EmailSmtpTransportRequest {
  idempotencyKey: string;
  source: string;
  projectId: number;
  referenceId: string;
  profileId: string;
  publicConfig: EmailSmtpPublicConfig;
  secret: EmailSmtpSecretConfig;
  message: EmailSmtpTransportMessage;
}

export interface EmailSmtpTransportReceipt {
  id: string;
  status: "sent";
  messageId: string;
  response: string;
  replayed?: boolean;
}

export type EmailProviderEventType =
  | "delivered"
  | "soft_bounce"
  | "hard_bounce"
  | "complaint"
  | "delivery_delayed"
  | "rejected";

/**
 * Normalized, recipient-free provider result exported to a domain module.
 * The Email Worker remains the signature-verification and SMTP authority.
 */
export interface EmailProviderEvent {
  id: string;
  provider: "aws-ses";
  source: string;
  projectId: number;
  referenceId: string;
  providerMessageId: string;
  eventType: EmailProviderEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface EmailProviderEventPage {
  events: EmailProviderEvent[];
}

export interface EmailProviderEventAcknowledgement {
  source: string;
  ids: string[];
}

export type EmailTransportOperationStatus =
  | "sending"
  | "sent"
  | "failed"
  | "outcome_unknown";

/** Body- and credential-free projection of a delegated SMTP side effect. */
export interface EmailTransportOperation {
  id: string;
  source: string;
  projectId: number;
  referenceId: string;
  profileId: string;
  status: EmailTransportOperationStatus;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export type EmailOperationStatus =
  | "captured"
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "outcome_unknown";

/**
 * Body-free operational projection safe for an authenticated back office.
 * Recipient addresses and message bodies deliberately remain inside Email D1.
 */
export interface EmailOperation {
  id: string;
  kind: EmailKind;
  projectId: number | null;
  templateKey: string | null;
  subject: string;
  status: EmailOperationStatus;
  transport: "capture" | "smtp";
  recipientCount: number;
  failedRecipients: number;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface EmailDeadLetterOperation {
  id: string;
  queueMessageId: string;
  emailMessageId: string | null;
  sourceQueue: string;
  jobType: string | null;
  replayable: boolean;
  attempts: number;
  status: "quarantined" | "discarded";
  resolution: "replayed" | "discarded" | null;
  receivedAt: string;
  resolvedAt: string | null;
}

export interface EmailOperationsPage {
  generatedAt: string;
  queue: {
    backlogCount: number;
    backlogBytes: number;
    oldestMessageAt: string | null;
  } | null;
  messages: EmailOperation[];
  transportDeliveries: EmailTransportOperation[];
  deadLetters: EmailDeadLetterOperation[];
}

export class EmailInboundContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EmailInboundContractError";
  }
}

export function parseEmailInboundEnvelope(
  value: unknown,
): EmailInboundEnvelope {
  const input = inboundRecord(value, "inbound_email_invalid");
  if (input.schema_version !== EMAIL_INBOUND_SCHEMA_VERSION) {
    throw new EmailInboundContractError(
      "inbound_email_schema_unsupported",
      "Inbound email schema version is not supported",
    );
  }
  if (
    typeof input.provider !== "string" ||
    !EMAIL_INBOUND_PROVIDERS.includes(input.provider as EmailInboundProvider)
  ) {
    throw new EmailInboundContractError(
      "inbound_email_provider_invalid",
      "Inbound email provider is invalid",
    );
  }
  const attachments = inboundArray(
    input.attachments ?? [],
    "inbound_email_attachments_invalid",
    EMAIL_INBOUND_LIMITS.attachmentsMaximum,
  ).map(parseEmailInboundAttachment);
  const text = inboundNullableBody(input.body, "text");
  const html = inboundNullableBody(input.body, "html");
  if (text === null && html === null && attachments.length === 0) {
    throw new EmailInboundContractError(
      "inbound_email_content_required",
      "Inbound email must contain a body or an attachment",
    );
  }
  const authenticity = inboundRecord(
    input.authenticity,
    "inbound_email_authenticity_invalid",
  );
  const thread = inboundRecord(input.thread, "inbound_email_thread_invalid");
  const references = inboundArray(
    thread.references ?? [],
    "inbound_email_references_invalid",
    EMAIL_INBOUND_LIMITS.referencesMaximum,
  ).map((reference) =>
    inboundSafeString(
      reference,
      "reference",
      1,
      EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
    ),
  );
  const metadata = input.metadata ?? {};
  const metadataRecord = inboundRecord(
    metadata,
    "inbound_email_metadata_invalid",
  );
  if (
    inboundJsonBytes(metadataRecord) > EMAIL_INBOUND_LIMITS.metadataBytesMaximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_metadata_too_large",
      "Inbound email metadata is too large",
    );
  }
  const to = parseInboundAddresses(input.to, "to", true);
  const cc = parseInboundAddresses(input.cc ?? [], "cc", false);
  const bcc = parseInboundAddresses(input.bcc ?? [], "bcc", false);
  if (
    to.length + cc.length + bcc.length >
    EMAIL_INBOUND_LIMITS.recipientsMaximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_recipients_invalid",
      `Inbound email has more than ${EMAIL_INBOUND_LIMITS.recipientsMaximum} recipients`,
    );
  }
  const result: EmailInboundEnvelope = {
    schema_version: EMAIL_INBOUND_SCHEMA_VERSION,
    provider: input.provider as EmailInboundProvider,
    endpoint_id: inboundPortableIdentifier(
      input.endpoint_id,
      "endpoint_id",
      255,
    ),
    provider_message_id: inboundSafeString(
      input.provider_message_id,
      "provider_message_id",
      1,
      EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
    ),
    received_at: inboundTimestamp(input.received_at, "received_at"),
    sent_at:
      input.sent_at === undefined ||
      input.sent_at === null ||
      input.sent_at === ""
        ? null
        : inboundTimestamp(input.sent_at, "sent_at"),
    from: parseInboundAddress(input.from, "from"),
    to,
    cc,
    bcc,
    subject: inboundSafeString(
      input.subject ?? "",
      "subject",
      0,
      EMAIL_INBOUND_LIMITS.subjectLengthMaximum,
    ),
    body: { text, html },
    thread: {
      message_id: inboundNullableIdentifier(thread.message_id, "message_id"),
      in_reply_to: inboundNullableIdentifier(thread.in_reply_to, "in_reply_to"),
      references: [...new Set(references)],
    },
    attachments,
    authenticity: {
      provider_verified: authenticity.provider_verified === true,
      spf: inboundAuthenticity(authenticity.spf),
      dkim: inboundAuthenticity(authenticity.dkim),
      dmarc: inboundAuthenticity(authenticity.dmarc),
    },
    metadata: metadataRecord,
  };
  if (
    inboundJsonBytes(result) >
    EMAIL_INBOUND_LIMITS.canonicalEnvelopeBytesMaximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_envelope_too_large",
      "Inbound email envelope is too large",
    );
  }
  return result;
}

function parseInboundAddresses(
  value: unknown,
  field: string,
  required: boolean,
): EmailInboundAddress[] {
  const values = inboundArray(
    value,
    "inbound_email_recipients_invalid",
    EMAIL_INBOUND_LIMITS.recipientsMaximum,
  );
  if (required && values.length === 0) {
    throw new EmailInboundContractError(
      "inbound_email_recipients_invalid",
      `${field} must contain at least one recipient`,
    );
  }
  const addresses = values.map((entry) => parseInboundAddress(entry, field));
  const unique = new Map<string, EmailInboundAddress>();
  for (const address of addresses) unique.set(address.email, address);
  return [...unique.values()];
}

function parseInboundAddress(
  value: unknown,
  field: string,
): EmailInboundAddress {
  const input = inboundRecord(value, "inbound_email_address_invalid");
  const email = inboundSafeString(input.email, `${field}.email`, 3, 254)
    .trim()
    .toLowerCase();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/u.test(email)) {
    throw new EmailInboundContractError(
      "inbound_email_address_invalid",
      `${field} contains an invalid email address`,
    );
  }
  const name =
    input.name === undefined || input.name === null || input.name === ""
      ? null
      : inboundSafeString(input.name, `${field}.name`, 1, 320).trim();
  return { email, name };
}

function parseEmailInboundAttachment(value: unknown): EmailInboundAttachment {
  const input = inboundRecord(value, "inbound_email_attachment_invalid");
  const byteSize = Number(input.byte_size);
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0 ||
    byteSize > EMAIL_INBOUND_LIMITS.attachmentBytesMaximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_attachment_invalid",
      "Inbound email attachment size is invalid",
    );
  }
  const downloadUrl = inboundNullableUrl(input.download_url);
  return {
    provider_attachment_id: inboundSafeString(
      input.provider_attachment_id,
      "provider_attachment_id",
      1,
      EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
    ),
    file_name: inboundSafeString(input.file_name, "file_name", 1, 255),
    content_type: inboundSafeString(input.content_type, "content_type", 1, 255)
      .trim()
      .toLowerCase(),
    byte_size: byteSize,
    content_id: inboundNullableIdentifier(input.content_id, "content_id"),
    download_url: downloadUrl,
  };
}

function inboundNullableBody(
  value: unknown,
  field: "text" | "html",
): string | null {
  const body = inboundRecord(value, "inbound_email_body_invalid");
  const item = body[field];
  if (item === undefined || item === null || item === "") return null;
  if (typeof item !== "string") {
    throw new EmailInboundContractError(
      "inbound_email_body_invalid",
      `Inbound email ${field} body is invalid`,
    );
  }
  if (
    new TextEncoder().encode(item).byteLength >
    EMAIL_INBOUND_LIMITS.bodyBytesMaximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_body_too_large",
      `Inbound email ${field} body is too large`,
    );
  }
  return item;
}

function inboundNullableIdentifier(
  value: unknown,
  field: string,
): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : inboundSafeString(
        value,
        field,
        1,
        EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
      );
}

function inboundPortableIdentifier(
  value: unknown,
  field: string,
  maximum: number,
): string {
  const result = inboundSafeString(value, field, 1, maximum).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(result)) {
    throw new EmailInboundContractError(
      "inbound_email_identifier_invalid",
      `${field} contains unsupported characters`,
    );
  }
  return result;
}

function inboundSafeString(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new EmailInboundContractError(
      "inbound_email_field_invalid",
      `${field} is invalid`,
    );
  }
  if (/\p{Cc}/u.test(value.replace(/[\t\n\r]/gu, ""))) {
    throw new EmailInboundContractError(
      "inbound_email_field_invalid",
      `${field} contains unsupported control characters`,
    );
  }
  if (field === "subject" && /[\r\n]/u.test(value)) {
    throw new EmailInboundContractError(
      "inbound_email_field_invalid",
      "subject contains a line break",
    );
  }
  return value;
}

function inboundTimestamp(value: unknown, field: string): string {
  const input = inboundSafeString(value, field, 1, 64);
  const timestamp = new Date(input);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new EmailInboundContractError(
      "inbound_email_timestamp_invalid",
      `${field} is invalid`,
    );
  }
  return timestamp.toISOString();
}

function inboundAuthenticity(value: unknown): EmailAuthenticityResult {
  const normalized = String(value ?? "unknown")
    .trim()
    .toLowerCase();
  return new Set<EmailAuthenticityResult>([
    "pass",
    "fail",
    "softfail",
    "neutral",
    "none",
    "temperror",
    "permerror",
    "unknown",
  ]).has(normalized as EmailAuthenticityResult)
    ? (normalized as EmailAuthenticityResult)
    : "unknown";
}

function inboundNullableUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const input = inboundSafeString(value, "download_url", 1, 2_048);
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
    return url.toString();
  } catch {
    throw new EmailInboundContractError(
      "inbound_email_attachment_invalid",
      "Inbound email attachment URL is invalid",
    );
  }
}

function inboundArray(
  value: unknown,
  code: string,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new EmailInboundContractError(code, "Inbound email list is invalid");
  }
  return value;
}

function inboundRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EmailInboundContractError(
      code,
      "Inbound email object is invalid",
    );
  }
  return value as Record<string, unknown>;
}

function inboundJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new EmailInboundContractError(
      "inbound_email_metadata_invalid",
      "Inbound email metadata is not serializable",
    );
  }
}
