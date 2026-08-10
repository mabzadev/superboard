export const EMAIL_SERVICE_SEND_PATH = "/internal/v1/messages";

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
