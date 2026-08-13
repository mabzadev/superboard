import type { EmailProviderEventType } from "@superboard/contracts/email";

const SNS_CERTIFICATE_MAX_BYTES = 32_768;
const SNS_TOPIC_PATTERN =
  /^arn:aws(?:-us-gov|-cn)?:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]{1,256}$/u;
const SNS_CERTIFICATE_PATH =
  /^\/SimpleNotificationService-[A-Za-z0-9_-]{16,128}\.pem$/u;

export type AwsSnsEnvelope = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  SubscribeURL?: string;
  Token?: string;
};

export type NormalizedAwsSesEvent = {
  providerMessageId: string;
  eventType: EmailProviderEventType;
  occurredAt: string;
  metadata: Record<string, unknown>;
};

export function parseAwsSnsEnvelope(value: unknown): AwsSnsEnvelope {
  if (!record(value)) throw new Error("aws_sns_envelope_invalid");
  const type = requiredString(value.Type, "Type");
  if (
    type !== "Notification" &&
    type !== "SubscriptionConfirmation" &&
    type !== "UnsubscribeConfirmation"
  ) {
    throw new Error("aws_sns_type_invalid");
  }
  const signatureVersion = requiredString(
    value.SignatureVersion,
    "SignatureVersion",
  );
  if (signatureVersion !== "1" && signatureVersion !== "2") {
    throw new Error("aws_sns_signature_version_invalid");
  }
  const envelope: AwsSnsEnvelope = {
    Type: type,
    MessageId: boundedString(value.MessageId, "MessageId", 256),
    TopicArn: boundedString(value.TopicArn, "TopicArn", 1_024),
    Message: boundedString(value.Message, "Message", 1_000_000),
    Timestamp: boundedString(value.Timestamp, "Timestamp", 64),
    SignatureVersion: signatureVersion,
    Signature: boundedString(value.Signature, "Signature", 8_192),
    SigningCertURL: boundedString(
      value.SigningCertURL,
      "SigningCertURL",
      2_048,
    ),
  };
  if (typeof value.Subject === "string") {
    envelope.Subject = boundedString(value.Subject, "Subject", 1_024);
  }
  if (typeof value.SubscribeURL === "string") {
    envelope.SubscribeURL = boundedString(
      value.SubscribeURL,
      "SubscribeURL",
      4_096,
    );
  }
  if (typeof value.Token === "string") {
    envelope.Token = boundedString(value.Token, "Token", 4_096);
  }
  if (!Number.isFinite(Date.parse(envelope.Timestamp))) {
    throw new Error("aws_sns_timestamp_invalid");
  }
  return envelope;
}

export async function verifyAwsSnsEnvelope(
  envelope: AwsSnsEnvelope,
  expectedTopicArn: string,
  fetchCertificate: typeof fetch = fetch,
): Promise<void> {
  if (!expectedTopicArn || envelope.TopicArn !== expectedTopicArn) {
    throw new Error("aws_sns_topic_invalid");
  }
  const topicRegion = SNS_TOPIC_PATTERN.exec(envelope.TopicArn)?.[1];
  if (!topicRegion) throw new Error("aws_sns_topic_invalid");
  const certificateUrl = trustedSnsUrl(
    envelope.SigningCertURL,
    topicRegion,
    SNS_CERTIFICATE_PATH,
  );
  const response = await fetchCertificate(certificateUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("aws_sns_certificate_unavailable");
  const certificate = await readTextBounded(
    response,
    SNS_CERTIFICATE_MAX_BYTES,
  );
  const hash = envelope.SignatureVersion === "2" ? "SHA-256" : "SHA-1";
  const publicKey = await crypto.subtle.importKey(
    "spki",
    subjectPublicKeyInfo(certificate),
    { name: "RSASSA-PKCS1-v1_5", hash },
    false,
    ["verify"],
  );
  const signature = decodeBase64(envelope.Signature);
  const verified = await crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    signature,
    new TextEncoder().encode(snsStringToSign(envelope)),
  );
  if (!verified) throw new Error("aws_sns_signature_invalid");
}

export function trustedAwsSnsConfirmationUrl(envelope: AwsSnsEnvelope): URL {
  if (envelope.Type !== "SubscriptionConfirmation" || !envelope.SubscribeURL) {
    throw new Error("aws_sns_confirmation_invalid");
  }
  const region = SNS_TOPIC_PATTERN.exec(envelope.TopicArn)?.[1];
  if (!region) throw new Error("aws_sns_topic_invalid");
  const url = trustedSnsUrl(envelope.SubscribeURL, region);
  if (
    url.searchParams.get("Action") !== "ConfirmSubscription" ||
    url.searchParams.get("TopicArn") !== envelope.TopicArn
  ) {
    throw new Error("aws_sns_confirmation_invalid");
  }
  return url;
}

export function normalizeAwsSesEvent(message: string): NormalizedAwsSesEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    throw new Error("aws_ses_event_invalid");
  }
  if (!record(parsed) || !record(parsed.mail)) {
    throw new Error("aws_ses_event_invalid");
  }
  const providerMessageId = boundedString(
    parsed.mail.messageId,
    "mail.messageId",
    512,
  );
  const rawType = requiredString(
    parsed.eventType ?? parsed.notificationType,
    "eventType",
  ).toLowerCase();
  const occurredAt = normalizeTimestamp(eventTimestamp(parsed));

  if (rawType === "delivery") {
    const delivery = record(parsed.delivery) ? parsed.delivery : {};
    return {
      providerMessageId,
      eventType: "delivered",
      occurredAt,
      metadata: compactMetadata({
        processing_time_ms: finiteNumber(delivery.processingTimeMillis),
        smtp_response: optionalBoundedString(delivery.smtpResponse, 1_000),
        remote_mta_ip: optionalBoundedString(delivery.remoteMtaIp, 128),
      }),
    };
  }
  if (rawType === "bounce") {
    const bounce = record(parsed.bounce) ? parsed.bounce : {};
    const bounceType = optionalBoundedString(bounce.bounceType, 64);
    const recipients = Array.isArray(bounce.bouncedRecipients)
      ? bounce.bouncedRecipients.filter(record)
      : [];
    return {
      providerMessageId,
      eventType:
        bounceType?.toLowerCase() === "permanent"
          ? "hard_bounce"
          : "soft_bounce",
      occurredAt,
      metadata: compactMetadata({
        bounce_type: bounceType,
        bounce_subtype: optionalBoundedString(bounce.bounceSubType, 128),
        feedback_id: optionalBoundedString(bounce.feedbackId, 256),
        diagnostic_codes: recipients
          .map((entry) => optionalBoundedString(entry.diagnosticCode, 512))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, 20),
      }),
    };
  }
  if (rawType === "complaint") {
    const complaint = record(parsed.complaint) ? parsed.complaint : {};
    return {
      providerMessageId,
      eventType: "complaint",
      occurredAt,
      metadata: compactMetadata({
        feedback_id: optionalBoundedString(complaint.feedbackId, 256),
        feedback_type: optionalBoundedString(
          complaint.complaintFeedbackType,
          128,
        ),
        user_agent: optionalBoundedString(complaint.userAgent, 512),
      }),
    };
  }
  if (rawType === "deliverydelay") {
    const delay = record(parsed.deliveryDelay) ? parsed.deliveryDelay : {};
    return {
      providerMessageId,
      eventType: "delivery_delayed",
      occurredAt,
      metadata: compactMetadata({
        delay_type: optionalBoundedString(delay.delayType, 128),
        expiration_time: optionalBoundedString(delay.expirationTime, 64),
      }),
    };
  }
  if (rawType === "reject" || rawType === "rendering failure") {
    const reject = record(parsed.reject) ? parsed.reject : {};
    const failure = record(parsed.failure) ? parsed.failure : {};
    return {
      providerMessageId,
      eventType: "rejected",
      occurredAt,
      metadata: compactMetadata({
        reason: optionalBoundedString(
          reject.reason ?? failure.errorMessage,
          1_000,
        ),
      }),
    };
  }
  throw new Error("aws_ses_event_unsupported");
}

function eventTimestamp(event: Record<string, unknown>): unknown {
  for (const key of [
    "delivery",
    "bounce",
    "complaint",
    "deliveryDelay",
    "reject",
    "failure",
  ]) {
    const section = event[key];
    if (record(section) && section.timestamp) return section.timestamp;
  }
  return record(event.mail) ? event.mail.timestamp : undefined;
}

function normalizeTimestamp(value: unknown): string {
  const date = new Date(requiredString(value, "timestamp"));
  if (Number.isNaN(date.getTime()))
    throw new Error("aws_ses_timestamp_invalid");
  return date.toISOString();
}

function snsStringToSign(envelope: AwsSnsEnvelope): string {
  const fields =
    envelope.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  let value = "";
  const source = envelope as unknown as Record<string, unknown>;
  for (const field of fields) {
    if (source[field] !== undefined)
      value += `${field}\n${String(source[field])}\n`;
  }
  return value;
}

function trustedSnsUrl(
  value: string,
  region: string,
  pathPattern?: RegExp,
): URL {
  const url = new URL(value);
  const expectedHosts = new Set([
    `sns.${region}.amazonaws.com`,
    `sns.${region}.amazonaws.com.cn`,
  ]);
  if (
    url.protocol !== "https:" ||
    !expectedHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash ||
    (pathPattern && (!pathPattern.test(url.pathname) || Boolean(url.search)))
  ) {
    throw new Error("aws_sns_url_untrusted");
  }
  return url;
}

function subjectPublicKeyInfo(pem: string): ArrayBuffer {
  const match =
    /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----/u.exec(
      pem,
    );
  if (!match) throw new Error("aws_sns_certificate_invalid");
  const certificate = decodeBase64(match[1].replace(/\s+/gu, ""));
  const root = readDerElement(certificate, 0);
  if (root.tag !== 0x30 || root.end !== certificate.length) {
    throw new Error("aws_sns_certificate_invalid");
  }
  const tbs = readDerElement(certificate, root.contentStart);
  if (tbs.tag !== 0x30) throw new Error("aws_sns_certificate_invalid");
  let offset = tbs.contentStart;
  let element = readDerElement(certificate, offset);
  if (element.tag === 0xa0) {
    offset = element.end;
    element = readDerElement(certificate, offset);
  }
  // serialNumber, signature, issuer, validity and subject precede SPKI.
  for (let index = 0; index < 5; index += 1) {
    offset = element.end;
    element = readDerElement(certificate, offset);
  }
  if (element.tag !== 0x30 || element.end > tbs.end) {
    throw new Error("aws_sns_certificate_invalid");
  }
  return certificate.slice(element.start, element.end).buffer;
}

function readDerElement(
  bytes: Uint8Array,
  start: number,
): {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
} {
  if (start < 0 || start + 2 > bytes.length) {
    throw new Error("aws_sns_certificate_invalid");
  }
  const tag = bytes[start];
  const firstLength = bytes[start + 1];
  let length = firstLength;
  let contentStart = start + 2;
  if ((firstLength & 0x80) !== 0) {
    const count = firstLength & 0x7f;
    if (count < 1 || count > 4 || contentStart + count > bytes.length) {
      throw new Error("aws_sns_certificate_invalid");
    }
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = length * 256 + bytes[contentStart + index];
    }
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > bytes.length) throw new Error("aws_sns_certificate_invalid");
  return { tag, start, contentStart, end };
}

async function readTextBounded(response: Response, maximum: number) {
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > maximum) throw new Error("aws_sns_certificate_invalid");
  if (!response.body) throw new Error("aws_sns_certificate_invalid");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel("certificate too large");
        throw new Error("aws_sns_certificate_invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(bytes);
}

function decodeBase64(value: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("aws_sns_base64_invalid");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function requiredString(value: unknown, field: string): string {
  return boundedString(value, field, 8_192);
}

function boundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum) {
    throw new Error(`aws_${field.toLowerCase().replaceAll(".", "_")}_invalid`);
  }
  return value;
}

function optionalBoundedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximum)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compactMetadata(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) => entry !== null && entry !== undefined,
    ),
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
