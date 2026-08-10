import type { EmailServiceMessage } from "@opengrow/contracts/email";
import { constantTimeEqual } from "@opengrow/contracts/secret";

const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const KINDS = new Set(["transactional", "marketing", "test"]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;
const RESERVED_HEADERS = new Set([
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "from",
  "message-id",
  "mime-version",
  "reply-to",
  "subject",
  "to",
]);

export function parseEmailMessage(
  value: unknown,
): EmailServiceMessage & { to: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("message_invalid");
  const input = value as Record<string, unknown>;
  const recipients = Array.isArray(input.to) ? input.to : [input.to];
  const to = [
    ...new Set(recipients.map((recipient) => normalizeEmail(recipient))),
  ];
  if (to.length === 0 || to.length > 50) fail("recipients_invalid");
  const subject = boundedString(input.subject, "subject", 998);
  const text = nullableBody(input.text, "text");
  const html = nullableBody(input.html, "html");
  if (!text && !html) fail("body_required");
  const kind = String(input.kind || "transactional");
  if (!KINDS.has(kind)) fail("kind_invalid");
  const replyTo = input.replyTo == null ? null : normalizeEmail(input.replyTo);
  const headers = stringRecord(input.headers, "headers", 30);
  const metadata = objectValue(input.metadata, "metadata");
  const templateKey =
    input.templateKey == null
      ? null
      : boundedString(input.templateKey, "templateKey", 128);
  const idempotencyKey =
    input.idempotencyKey == null
      ? null
      : boundedString(input.idempotencyKey, "idempotencyKey", 200);
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY.test(idempotencyKey))
    fail("idempotency_key_invalid");
  const projectId = input.projectId == null ? null : Number(input.projectId);
  if (projectId !== null && (!Number.isSafeInteger(projectId) || projectId < 1))
    fail("project_id_invalid");
  return {
    kind: kind as EmailServiceMessage["kind"],
    to,
    idempotencyKey,
    subject,
    text,
    html,
    replyTo,
    headers,
    metadata,
    templateKey,
    projectId,
  };
}

export function normalizeEmail(value: unknown): string {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) fail("recipient_invalid");
  return email;
}

export async function secretsEqual(
  left: string,
  right: string,
): Promise<boolean> {
  return constantTimeEqual(left, right);
}

function boundedString(value: unknown, field: string, maximum: number): string {
  const result = String(value || "").trim();
  if (
    !result ||
    result.length > maximum ||
    /[\r\n]/.test(field === "subject" ? result : "")
  )
    fail(`${field}_invalid`);
  return result;
}

function nullableBody(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 512_000)
    fail(`${field}_invalid`);
  return value;
}

function stringRecord(
  value: unknown,
  field: string,
  maximumKeys: number,
): Record<string, string> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${field}_invalid`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > maximumKeys) fail(`${field}_invalid`);
  return Object.fromEntries(
    entries.map(([key, item]) => {
      if (
        !/^[A-Za-z0-9-]{1,64}$/.test(key) ||
        RESERVED_HEADERS.has(key.toLowerCase()) ||
        typeof item !== "string" ||
        item.length > 2_000
      )
        fail(`${field}_invalid`);
      return [key, item.replace(/[\r\n]+/g, " ")];
    }),
  );
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${field}_invalid`);
  const serialized = JSON.stringify(value);
  if (serialized.length > 32_000) fail(`${field}_invalid`);
  return value as Record<string, unknown>;
}

function fail(code: string): never {
  throw new EmailValidationError(code);
}

export class EmailValidationError extends Error {
  constructor(readonly code: string) {
    super(code.replaceAll("_", " "));
    this.name = "EmailValidationError";
  }
}
