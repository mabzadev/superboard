export const EMAIL_SERVICE_SEND_PATH = "/internal/v1/messages";
export const EMAIL_SERVICE_OPERATIONS_PATH = "/internal/v1/operations";
export const EMAIL_SERVICE_DEAD_LETTERS_PATH =
  "/internal/v1/operations/dead-letters";
export const EMAIL_SERVICE_SMTP_TRANSPORT_PATH = "/internal/v1/transport/smtp";

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
