import {
  EMAIL_INBOUND_LIMITS,
  EMAIL_INBOUND_PROVIDER_VERIFIED_HEADER,
  EMAIL_INBOUND_SCHEMA_VERSION,
  EmailInboundContractError,
  parseEmailInboundEnvelope,
  type EmailAuthenticityResult,
  type EmailInboundAddress,
  type EmailInboundAttachment,
  type EmailInboundEnvelope,
  type EmailInboundProvider,
} from "@superboard/contracts/email";
import { readBytesLimited } from "@superboard/contracts/request-body";
import { EmailValidationError } from "./validation";

type InputRecord = Record<string, unknown>;

export async function normalizeInboundEmailRequest(
  request: Request,
  providerInput: string,
  endpointId: string,
): Promise<EmailInboundEnvelope> {
  const provider = canonicalProvider(providerInput);
  const raw = await parseProviderBody(request);
  const message = messageRecord(raw);
  const headers = messageHeaders(message, raw);
  const attachments = attachmentValues(message, raw).map((attachment, index) =>
    normalizeAttachment(attachment, index),
  );
  const body = normalizedBody(message);
  const envelope = {
    schema_version: EMAIL_INBOUND_SCHEMA_VERSION,
    provider,
    endpoint_id: endpointId,
    provider_message_id: requiredProviderMessageId(message, raw, headers),
    received_at:
      timestampValue(
        firstValue(message, [
          "received_at",
          "receivedAt",
          "receivedDateTime",
          "received",
        ]),
      ) ?? new Date().toISOString(),
    sent_at: timestampValue(
      firstValue(message, ["sent_at", "sentAt", "sentDateTime", "date"]) ??
        headers.get("date"),
    ),
    from: requiredAddress(
      firstValue(message, ["from", "sender", "From"]) ?? headers.get("from"),
      "from",
    ),
    to: addresses(
      firstValue(message, ["to", "recipients", "To"]) ?? headers.get("to"),
    ),
    cc: addresses(firstValue(message, ["cc", "Cc"]) ?? headers.get("cc")),
    bcc: addresses(firstValue(message, ["bcc", "Bcc"]) ?? headers.get("bcc")),
    subject: cleanHeaderValue(
      String(
        firstValue(message, ["subject", "Subject"]) ??
          headers.get("subject") ??
          "",
      ),
      EMAIL_INBOUND_LIMITS.subjectLengthMaximum,
    ),
    body,
    thread: {
      message_id: nullableHeaderIdentifier(
        firstValue(message, ["message_id", "messageId", "internetMessageId"]) ??
          headers.get("message-id"),
      ),
      in_reply_to: nullableHeaderIdentifier(
        firstValue(message, ["in_reply_to", "inReplyTo"]) ??
          headers.get("in-reply-to"),
      ),
      references: references(
        firstValue(message, ["references", "thread_references"]) ??
          headers.get("references"),
      ),
    },
    attachments,
    authenticity: authenticity(
      message,
      raw,
      headers,
      request.headers.get(EMAIL_INBOUND_PROVIDER_VERIFIED_HEADER) === "1",
    ),
    metadata: safeMetadata(message, raw),
  } satisfies EmailInboundEnvelope;
  return parseEmailInboundEnvelope(envelope);
}

function canonicalProvider(value: string): EmailInboundProvider {
  const normalized = value.trim().toLowerCase().replaceAll("_", "-");
  if (new Set(["google", "gmail", "email-google"]).has(normalized)) {
    return "google";
  }
  if (new Set(["microsoft", "outlook", "email-microsoft"]).has(normalized)) {
    return "microsoft";
  }
  if (new Set(["smtp", "email", "email-smtp"]).has(normalized)) {
    return "smtp";
  }
  throw new EmailValidationError("inbound_email_provider_invalid");
}

async function parseProviderBody(request: Request): Promise<InputRecord> {
  const bytes = await readBytesLimited(
    request,
    EMAIL_INBOUND_LIMITS.networkBodyBytesMaximum,
  );
  if (bytes.byteLength === 0) {
    throw new EmailValidationError("inbound_email_body_required");
  }
  const contentType = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  const text = new TextDecoder().decode(bytes);
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    return parsedJsonObject(text);
  }
  if (contentType === "application/x-www-form-urlencoded") {
    return Object.fromEntries(new URLSearchParams(text).entries());
  }
  if (contentType === "multipart/form-data") {
    const body = copiedArrayBuffer(bytes);
    const form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
    const output: InputRecord = {};
    const attachments: InputRecord[] = [];
    for (const [name, value] of form.entries()) {
      if (typeof value === "string") {
        const existing = output[name];
        output[name] = existing ? `${String(existing)},${value}` : value;
      } else {
        attachments.push({
          provider_attachment_id: `${name}:${value.name}`,
          file_name: value.name,
          content_type: value.type || "application/octet-stream",
          byte_size: value.size,
        });
      }
    }
    if (attachments.length) output.attachments = attachments;
    return output;
  }
  try {
    return parsedJsonObject(text);
  } catch {
    throw new EmailValidationError("inbound_email_media_type_invalid");
  }
}

function parsedJsonObject(text: string): InputRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EmailValidationError("inbound_email_json_invalid");
  }
  if (!isRecord(parsed)) {
    throw new EmailValidationError("inbound_email_object_required");
  }
  return parsed;
}

function messageRecord(raw: InputRecord): InputRecord {
  for (const path of [
    "message",
    "email",
    "data.message",
    "data.email",
    "data",
  ]) {
    const candidate = pathValue(raw, path);
    if (isRecord(candidate)) return candidate;
  }
  return raw;
}

function messageHeaders(
  message: InputRecord,
  raw: InputRecord,
): Map<string, string> {
  const result = new Map<string, string>();
  const candidates = [
    message.headers,
    pathValue(message, "payload.headers"),
    raw.headers,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        if (!isRecord(item)) continue;
        const name = String(item.name ?? "")
          .trim()
          .toLowerCase();
        const value = String(item.value ?? "");
        if (name && value && name.length <= 128 && value.length <= 8_192) {
          result.set(name, cleanHeaderValue(value, 8_192));
        }
      }
    } else if (isRecord(candidate)) {
      for (const [name, value] of Object.entries(candidate)) {
        if (
          typeof value !== "string" ||
          name.length > 128 ||
          value.length > 8_192
        )
          continue;
        result.set(name.trim().toLowerCase(), cleanHeaderValue(value, 8_192));
      }
    }
  }
  return result;
}

function requiredProviderMessageId(
  message: InputRecord,
  raw: InputRecord,
  headers: Map<string, string>,
): string {
  const value =
    firstValue(message, [
      "provider_message_id",
      "providerMessageId",
      "message_id",
      "messageId",
      "internetMessageId",
      "id",
    ]) ??
    firstValue(raw, [
      "provider_message_id",
      "providerMessageId",
      "event_id",
      "eventId",
    ]) ??
    headers.get("message-id");
  const result = nullableHeaderIdentifier(value);
  if (!result)
    throw new EmailValidationError("inbound_email_message_id_required");
  return result;
}

function normalizedBody(message: InputRecord): EmailInboundEnvelope["body"] {
  const directBody = message.body;
  let text = firstValue(message, [
    "text",
    "text_body",
    "textBody",
    "body_text",
    "stripped-text",
  ]);
  let html = firstValue(message, [
    "html",
    "html_body",
    "htmlBody",
    "body_html",
    "stripped-html",
  ]);
  if (typeof directBody === "string" && text == null) text = directBody;
  if (isRecord(directBody) && typeof directBody.content === "string") {
    if (String(directBody.contentType || "").toLowerCase() === "html") {
      html ??= directBody.content;
    } else {
      text ??= directBody.content;
    }
  }
  const parts = pathValue(message, "payload.parts");
  if (Array.isArray(parts)) {
    for (const part of flattenParts(parts)) {
      const mime = String(
        part.mimeType || part.content_type || "",
      ).toLowerCase();
      const encoded = pathValue(part, "body.data");
      if (typeof encoded !== "string") continue;
      const decoded = decodeBase64Url(encoded);
      if (mime === "text/plain" && text == null) text = decoded;
      if (mime === "text/html" && html == null) html = decoded;
    }
  }
  return {
    text: typeof text === "string" ? cleanText(text) : null,
    html: typeof html === "string" ? cleanHtml(html) : null,
  };
}

function flattenParts(parts: unknown[]): InputRecord[] {
  const output: InputRecord[] = [];
  const pending = [...parts];
  while (pending.length && output.length < 100) {
    const value = pending.shift();
    if (!isRecord(value)) continue;
    output.push(value);
    if (Array.isArray(value.parts)) pending.push(...value.parts);
  }
  return output;
}

function attachmentValues(message: InputRecord, raw: InputRecord): unknown[] {
  for (const candidate of [
    message.attachments,
    pathValue(message, "payload.attachments"),
    raw.attachments,
  ]) {
    if (Array.isArray(candidate)) return candidate.slice(0, 51);
    if (typeof candidate === "string" && candidate.trim().startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (Array.isArray(parsed)) return parsed.slice(0, 51);
      } catch {
        throw new EmailValidationError("inbound_email_attachments_invalid");
      }
    }
  }
  return [];
}

function normalizeAttachment(
  value: unknown,
  index: number,
): EmailInboundAttachment {
  if (!isRecord(value)) {
    throw new EmailValidationError("inbound_email_attachment_invalid");
  }
  const id = cleanHeaderValue(
    String(
      firstValue(value, [
        "provider_attachment_id",
        "providerAttachmentId",
        "attachment_id",
        "attachmentId",
        "id",
      ]) ?? `attachment-${index + 1}`,
    ),
    EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
  );
  const fileName = safeFilename(
    String(
      firstValue(value, ["file_name", "fileName", "filename", "name"]) ?? id,
    ),
  );
  const contentType = cleanHeaderValue(
    String(
      firstValue(value, [
        "content_type",
        "contentType",
        "mime_type",
        "mimeType",
      ]) ?? "application/octet-stream",
    ),
    255,
  ).toLowerCase();
  const rawSize = Number(
    firstValue(value, [
      "byte_size",
      "byteSize",
      "size_bytes",
      "sizeBytes",
      "size",
    ]) ?? 0,
  );
  if (!Number.isSafeInteger(rawSize) || rawSize < 0) {
    throw new EmailValidationError("inbound_email_attachment_invalid");
  }
  const rawUrl = firstValue(value, [
    "download_url",
    "downloadUrl",
    "content_url",
    "contentUrl",
  ]);
  return {
    provider_attachment_id: id,
    file_name: fileName,
    content_type: contentType,
    byte_size: rawSize,
    content_id: nullableHeaderIdentifier(
      firstValue(value, ["content_id", "contentId"]),
    ),
    download_url: trustedDownloadUrl(rawUrl),
  };
}

function requiredAddress(value: unknown, field: string): EmailInboundAddress {
  const result = addresses(value)[0];
  if (!result)
    throw new EmailValidationError(`inbound_email_${field}_required`);
  return result;
}

function addresses(value: unknown): EmailInboundAddress[] {
  if (value == null || value === "") return [];
  const values = Array.isArray(value) ? value : [value];
  const output: EmailInboundAddress[] = [];
  for (const item of values) {
    if (typeof item === "string") {
      const matches = item.matchAll(
        /(?:(?:"([^"]{1,320})"|([^,<]{1,320}))\s*)?<([^\s<>@]+@[^\s<>@]+)>|([^\s,;<>@]+@[^\s,;<>@]+)/gu,
      );
      for (const match of matches) {
        const email = String(match[3] || match[4] || "")
          .trim()
          .toLowerCase();
        if (!email) continue;
        const name = String(match[1] || match[2] || "").trim();
        output.push({ email, name: name || null });
      }
    } else if (isRecord(item)) {
      const nested = isRecord(item.emailAddress) ? item.emailAddress : item;
      const email = String(
        firstValue(nested, ["email", "address", "email_address"]) ?? "",
      )
        .trim()
        .toLowerCase();
      if (!email) continue;
      const name = String(
        firstValue(nested, ["name", "display_name", "displayName"]) ?? "",
      ).trim();
      output.push({ email, name: name || null });
    }
  }
  const unique = new Map<string, EmailInboundAddress>();
  for (const address of output) unique.set(address.email, address);
  return [...unique.values()].slice(0, EMAIL_INBOUND_LIMITS.recipientsMaximum);
}

function references(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (value.match(/<[^<>\r\n]{1,510}>/gu) ?? value.split(/\s+/u))
      : [];
  return [
    ...new Set(
      values
        .filter((entry): entry is string => typeof entry === "string")
        .map(nullableHeaderIdentifier)
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ].slice(0, EMAIL_INBOUND_LIMITS.referencesMaximum);
}

function authenticity(
  message: InputRecord,
  raw: InputRecord,
  headers: Map<string, string>,
  providerVerified: boolean,
): EmailInboundEnvelope["authenticity"] {
  const source =
    firstRecord(message, ["authenticity", "authentication"]) ??
    firstRecord(raw, ["authenticity", "authentication"]) ??
    {};
  const results = String(
    headers.get("authentication-results") || "",
  ).toLowerCase();
  return {
    provider_verified: providerVerified,
    spf: authResult(source.spf ?? resultFromHeader(results, "spf")),
    dkim: authResult(source.dkim ?? resultFromHeader(results, "dkim")),
    dmarc: authResult(source.dmarc ?? resultFromHeader(results, "dmarc")),
  };
}

function authResult(value: unknown): EmailAuthenticityResult {
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

function resultFromHeader(value: string, mechanism: string): string {
  return (
    new RegExp(`(?:^|[;\\s])${mechanism}=([a-z]+)`, "u").exec(value)?.[1] ??
    "unknown"
  );
}

function safeMetadata(message: InputRecord, raw: InputRecord): InputRecord {
  const output: InputRecord = {};
  const fields = [
    "event_id",
    "eventId",
    "history_id",
    "historyId",
    "mailbox_id",
    "mailboxId",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
    "resource",
    "subscription_id",
    "subscriptionId",
  ];
  for (const field of fields) {
    const value = message[field] ?? raw[field];
    if (typeof value === "string" || typeof value === "number") {
      const normalized = String(value).slice(0, 1_024);
      output[field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] =
        normalized;
    }
  }
  return output;
}

function cleanText(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .slice(0, EMAIL_INBOUND_LIMITS.bodyBytesMaximum);
}

function cleanHtml(value: string): string {
  const allowed = new Set([
    "a",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "div",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "u",
    "ul",
  ]);
  const withoutActiveBlocks = cleanText(value)
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(
      /<(script|style|iframe|object|embed|form|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/giu,
      "",
    )
    .replace(
      /<(script|style|iframe|object|embed|form|meta|link)\b[^>]*\/?\s*>/giu,
      "",
    );
  return withoutActiveBlocks.replace(
    /<(\/?)\s*([A-Za-z][A-Za-z0-9-]*)\b([^>]*)>/gu,
    (_tag, closing: string, rawName: string, attributes: string) => {
      const name = rawName.toLowerCase();
      if (!allowed.has(name)) return "";
      if (closing) return new Set(["br", "hr"]).has(name) ? "" : `</${name}>`;
      if (name !== "a") return `<${name}>`;
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(
        attributes,
      );
      const rawHref = String(href?.[1] || href?.[2] || href?.[3] || "").trim();
      if (!rawHref) return "<a>";
      try {
        const url = new URL(rawHref);
        if (!new Set(["https:", "mailto:"]).has(url.protocol)) return "<a>";
        return `<a href="${htmlAttribute(url.toString())}" rel="noopener noreferrer">`;
      } catch {
        return "<a>";
      }
    },
  );
}

function htmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cleanHeaderValue(value: string, maximum: number): string {
  return value
    .replace(/[\r\n\u0000]+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function nullableHeaderIdentifier(value: unknown): string | null {
  if (value == null || value === "") return null;
  const result = cleanHeaderValue(
    String(value),
    EMAIL_INBOUND_LIMITS.identifierLengthMaximum,
  );
  return result || null;
}

function timestampValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeFilename(value: string): string {
  const normalized = value
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  return (normalized || "attachment").slice(0, 255);
}

function trustedDownloadUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  if (value.length > EMAIL_INBOUND_LIMITS.bodyBytesMaximum * 2) {
    throw new EmailValidationError("inbound_email_body_too_large");
  }
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(`${normalized}${padding}`);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    throw new EmailValidationError("inbound_email_body_invalid");
  }
}

function firstRecord(value: InputRecord, paths: string[]): InputRecord | null {
  const candidate = firstValue(value, paths);
  return isRecord(candidate) ? candidate : null;
}

function firstValue(value: InputRecord, paths: string[]): unknown {
  for (const path of paths) {
    const candidate = pathValue(value, path);
    if (candidate !== undefined && candidate !== null && candidate !== "") {
      return candidate;
    }
  }
  return undefined;
}

function pathValue(value: InputRecord, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is InputRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function copiedArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

export function inboundNormalizationError(
  error: unknown,
): EmailValidationError {
  if (error instanceof EmailValidationError) return error;
  if (error instanceof EmailInboundContractError) {
    return new EmailValidationError(error.code);
  }
  return new EmailValidationError("inbound_email_invalid");
}
