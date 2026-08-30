import { Hono } from "hono";
import {
  EmailInboundContractError,
  parseEmailInboundEnvelope,
  type EmailInboundEnvelope,
} from "@superboard/contracts/email";
import { decryptCredentialPayload } from "./secrets";
import { readBytesLimited } from "./validation";
import type { Env } from "./types";

const MAX_PROVIDER_EVENT_BYTES = 512 * 1024;
const providers = new Hono<{ Bindings: Env }>();

const supportedProviders = new Set([
  "email_google",
  "email_microsoft",
  "smtp",
  "whatsapp_cloud",
  "facebook_messenger",
  "instagram",
  "twilio_sms",
  "twilio_voice",
  "whatsapp_calls",
  "telegram",
  "line",
  "tiktok",
  "twitter",
  "slack",
  "linear",
  "notion",
  "shopify",
  "dyte",
  "webhook",
]);

providers.get("/:provider/:endpointId/events", async (c) => {
  const provider = providerName(c.req.param("provider"));
  if (!["whatsapp_cloud", "facebook_messenger", "instagram"].includes(provider)) {
    throw failure("support_provider_method_not_allowed", "Provider verification is not available for this connector", 405);
  }
  const endpoint = await endpointWithCredentials(c.env, provider, c.req.param("endpointId"));
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token") || "";
  const challenge = c.req.query("hub.challenge") || "";
  if (mode !== "subscribe" || !challenge || !await constantTimeEqual(token, String(endpoint.credentials.verify_token || ""))) {
    throw failure("support_provider_verification_failed", "Provider verification failed", 403);
  }
  return c.text(challenge);
});

providers.onError((error, c) => {
  const status = Number((error as { status?: number }).status || 500);
  return c.json({
    error: {
      code: (error as { code?: string }).code || "internal_error",
      message: status >= 500 ? "Support is temporarily unavailable" : error.message,
      retryable: status >= 500,
      request_id: c.req.header("x-request-id") || crypto.randomUUID(),
    },
  }, status as 400);
});

providers.post("/:provider/:endpointId/events", async (c) => {
  const provider = providerName(c.req.param("provider"));
  const endpointId = c.req.param("endpointId");
  const endpoint = await endpointWithCredentials(c.env, provider, endpointId);
  const bytes = await readBytesLimited(
    c.req.raw,
    MAX_PROVIDER_EVENT_BYTES,
    "support_provider_event_too_large",
    "Provider event is limited to 512 KB",
  );
  const headers = providerHeaders(c.req.raw.headers);
  const normalizedEmail = c.req.header("x-superboard-inbound-normalized") === "email-v1";
  const payload = normalizedEmail
    ? parseCanonicalInboundEmail(provider, endpointId, bytes)
    : parseProviderPayload(provider, bytes, headers);
  if (isEmailProvider(provider) && !normalizedEmail) {
    throw failure(
      "support_provider_payload_not_normalized",
      "Support email event must use the canonical inbound contract",
      422,
    );
  }
  if (!isEmailProvider(provider) && normalizedEmail) {
    throw failure(
      "support_provider_payload_invalid",
      "Provider event payload is invalid",
      400,
    );
  }
  if (!normalizedEmail) {
    await verifyProviderEvent(provider, endpoint.credentials, bytes, headers);
  }
  const normalized = normalizeProviderEvent(provider, payload, headers);
  const eventId = normalized.eventId || await sha256Bytes(bytes);
  const storedId = crypto.randomUUID();
  const inserted = await c.env.DB.prepare(
    `INSERT INTO support_provider_events
      (id, project_id, endpoint_id, provider, provider_event_id, event_type,
       headers_json, payload_json, status, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
     ON CONFLICT(endpoint_id, provider_event_id) DO NOTHING RETURNING id`,
  ).bind(
    storedId,
    endpoint.projectId,
    endpoint.id,
    provider,
    eventId.slice(0, 255),
    normalized.type.slice(0, 128),
    JSON.stringify(headers),
    JSON.stringify(payload),
    new Date().toISOString(),
  ).first<{ id: string }>();
  if (inserted) {
    await c.env.SUPPORT_QUEUE.send({
      type: "support.provider.event.received.v1",
      projectId: endpoint.projectId,
      endpointId: endpoint.id,
      provider,
      eventRecordId: storedId,
    }, { contentType: "json" });
  }
  await c.env.DB.prepare(
    `UPDATE support_provider_endpoints SET
     status = CASE WHEN status = 'disabled' THEN status ELSE 'live_validated' END,
     last_validated_at = CASE WHEN status = 'disabled' THEN last_validated_at
       ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END,
     last_event_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     last_error_code = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND project_id = ?`,
  ).bind(endpoint.id, endpoint.projectId).run();
  return c.json({ data: { accepted: true, duplicate: !inserted, event_id: eventId.slice(0, 255) } }, inserted ? 202 : 200);
});

providers.get("/:provider/oauth/callback", async (c) => {
  const provider = providerName(c.req.param("provider"));
  const state = c.req.query("state") || "";
  const code = c.req.query("code") || "";
  const error = c.req.query("error") || "";
  if (!state || state.length > 512) throw failure("support_oauth_state_invalid", "OAuth state is invalid", 422);
  const stateHash = await sha256(state);
  const record = await c.env.DB.prepare(
    `UPDATE support_oauth_states SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL
       AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     RETURNING id, project_id, endpoint_id, redirect_uri`,
  ).bind(stateHash, provider).first<{
    id: string;
    project_id: number;
    endpoint_id: string;
    redirect_uri: string;
  }>();
  if (!record) throw failure("support_oauth_state_invalid", "OAuth state is invalid or expired", 422);
  if (error || !code) {
    await c.env.DB.prepare(
      `UPDATE support_provider_endpoints SET status = 'configuration_required',
       last_error_code = 'oauth_authorization_failed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND project_id = ?`,
    ).bind(record.endpoint_id, record.project_id).run();
    return redirectResult(record.redirect_uri, "error", "authorization_failed");
  }
  await c.env.SUPPORT_QUEUE.send({
    type: "support.provider.oauth.exchange.v1",
    projectId: record.project_id,
    endpointId: record.endpoint_id,
    provider,
    oauthStateId: record.id,
    authorizationCode: code.slice(0, 4_096),
  }, { contentType: "json" });
  return redirectResult(record.redirect_uri, "success", "configuration_pending");
});

async function endpointWithCredentials(env: Env, provider: string, endpointId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/.test(endpointId)) {
    throw failure("support_provider_endpoint_not_found", "Support provider endpoint not found", 404);
  }
  const row = await env.DB.prepare(
    `SELECT endpoint.id, endpoint.project_id, endpoint.status, credential.encrypted_payload
     FROM support_provider_endpoints endpoint
     LEFT JOIN support_provider_credentials credential ON credential.endpoint_id = endpoint.id
     WHERE endpoint.id = ? AND endpoint.provider = ? AND endpoint.status != 'disabled' LIMIT 1`,
  ).bind(endpointId, provider).first<{
    id: string;
    project_id: number;
    status: string;
    encrypted_payload: string | null;
  }>();
  if (!row) throw failure("support_provider_endpoint_not_found", "Support provider endpoint not found", 404);
  if (!row.encrypted_payload) throw failure("configuration_required", "Support provider is not configured", 422);
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], row.encrypted_payload);
  return { id: row.id, projectId: row.project_id, credentials: decrypted.payload };
}

async function verifyProviderEvent(
  provider: string,
  credentials: Record<string, unknown>,
  body: Uint8Array,
  headers: Record<string, string>,
) {
  const raw = new TextDecoder().decode(body);
  if (["whatsapp_cloud", "whatsapp_calls", "facebook_messenger", "instagram"].includes(provider)) {
    const supplied = headers["x-hub-signature-256"] || "";
    const expected = `sha256=${await hmacHex(String(credentials.app_secret || ""), raw)}`;
    if (!await constantTimeEqual(supplied, expected)) rejectSignature();
    return;
  }
  if (provider === "line") {
    const expected = await hmacBase64(String(credentials.channel_secret || ""), raw);
    if (!await constantTimeEqual(headers["x-line-signature"] || "", expected)) rejectSignature();
    return;
  }
  if (provider === "shopify") {
    const expected = await hmacBase64(String(credentials.client_secret || ""), raw);
    if (!await constantTimeEqual(headers["x-shopify-hmac-sha256"] || "", expected)) rejectSignature();
    return;
  }
  if (provider === "slack") {
    const timestamp = headers["x-slack-request-timestamp"] || "";
    const seconds = Number(timestamp);
    if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1_000 - seconds) > 300) rejectSignature();
    const expected = `v0=${await hmacHex(String(credentials.signing_secret || ""), `v0:${timestamp}:${raw}`)}`;
    if (!await constantTimeEqual(headers["x-slack-signature"] || "", expected)) rejectSignature();
    return;
  }
  if (provider === "telegram") {
    if (!await constantTimeEqual(headers["x-telegram-bot-api-secret-token"] || "", String(credentials.webhook_secret || ""))) rejectSignature();
    return;
  }
  if (provider.startsWith("twilio_")) {
    const canonicalUrl = headers["x-superboard-provider-url"] || "";
    const contentType = headers["content-type"] || "";
    const value = contentType.includes("application/x-www-form-urlencoded")
      ? canonicalUrl + [...new URLSearchParams(raw).entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${key}${item}`).join("")
      : canonicalUrl + raw;
    const expected = await hmacSha1Base64(String(credentials.auth_token || ""), value);
    if (!await constantTimeEqual(headers["x-twilio-signature"] || "", expected)) rejectSignature();
    return;
  }
  if (provider === "tiktok") {
    const value = headers["tiktok-signature"] || headers["x-tiktok-signature"] || "";
    const pairs = Object.fromEntries(value.split(",").map((item) => item.trim().split("=", 2)));
    const timestamp = pairs.t || "";
    const expected = await hmacHex(String(credentials.client_secret || ""), `${timestamp}.${raw}`);
    if (!timestamp || !await constantTimeEqual(pairs.s || "", expected)) rejectSignature();
    return;
  }
  if (provider === "twitter") {
    const supplied = headers["x-twitter-webhooks-signature"] || "";
    const expected = `sha256=${await hmacBase64(String(credentials.client_secret || ""), raw)}`;
    if (!await constantTimeEqual(supplied, expected)) rejectSignature();
    return;
  }
  const genericSecret = String(credentials.signing_secret || credentials.client_secret || "");
  const signature = headers["x-superboard-signature"] || headers["x-signature"] || "";
  if (!genericSecret || !signature) rejectSignature();
  const expected = `sha256=${await hmacHex(genericSecret, raw)}`;
  if (!await constantTimeEqual(signature, expected)) rejectSignature();
}

function providerHeaders(source: Headers) {
  const allowed = [
    "content-type",
    "x-hub-signature-256",
    "x-line-signature",
    "x-shopify-hmac-sha256",
    "x-shopify-webhook-id",
    "x-shopify-topic",
    "x-slack-request-timestamp",
    "x-slack-signature",
    "x-telegram-bot-api-secret-token",
    "x-twilio-signature",
    "x-superboard-provider-url",
    "tiktok-signature",
    "x-tiktok-signature",
    "x-twitter-webhooks-signature",
    "x-superboard-signature",
    "x-signature",
    "x-request-id",
  ];
  return Object.fromEntries(allowed.flatMap((name) => {
    const value = source.get(name);
    return value == null ? [] : [[name, value.slice(0, 4_096)]];
  }));
}

function parseProviderPayload(provider: string, bytes: Uint8Array, headers: Record<string, string>) {
  const text = new TextDecoder().decode(bytes);
  if ((headers["content-type"] || "").includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : { value };
  } catch {
    if (provider.startsWith("email_") || provider === "smtp") return { raw: text.slice(0, 64_000) };
    throw failure("support_provider_payload_invalid", "Provider event payload is invalid", 400);
  }
}

export function normalizeProviderEvent(provider: string, payload: unknown, headers: Record<string, string>) {
  const record = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const entry = Array.isArray(record.entry) ? record.entry[0] as Record<string, unknown> | undefined : undefined;
  const change = entry && Array.isArray(entry.changes)
    ? objectValue(entry.changes[0])
    : {};
  const value = objectValue(change.value);
  const messages = arrayObjects(value.messages);
  const statuses = arrayObjects(value.statuses);
  const messaging = entry && Array.isArray(entry.messaging)
    ? objectValue(entry.messaging[0])
    : {};
  const messengerMessage = objectValue(messaging.message);
  const delivery = objectValue(messaging.delivery);
  const read = objectValue(messaging.read);
  const directMessage = arrayObjects(record.direct_message_events)[0];
  const metaEventId = statuses.length
    ? `status:${statuses.map((status) => `${stringValue(status.id)}:${stringValue(status.status)}`).join(",")}`
    : messages.length
      ? `message:${messages.map((message) => stringValue(message.id)).join(",")}`
      : messengerMessage.mid
        ? `message:${stringValue(messengerMessage.mid)}`
        : Array.isArray(delivery.mids) && delivery.mids.length
          ? `delivery:${delivery.mids.map(stringValue).join(",")}`
          : read.watermark
            ? `read:${stringValue(objectValue(messaging.sender).id)}:${stringValue(read.watermark)}`
            : "";
  const metaType = statuses.length || delivery.mids || read.watermark
    ? "delivery.updated"
    : messages.length || messengerMessage.mid
      ? "message.created"
      : "";
  return {
    eventId: stringValue(metaEventId || directMessage?.id || record.provider_message_id || record.event_id || record.id
      || record.update_id || record.webhook_id || headers["x-shopify-webhook-id"] || entry?.id),
    type: stringValue(metaType || (directMessage?.type === "message_create" ? "message.created" : "")
      || (record.provider_message_id ? "email.received" : record.type
      || record.event || record.event_type || headers["x-shopify-topic"] || "event.received")) || "event.received",
    provider,
  };
}

function parseCanonicalInboundEmail(
  provider: string,
  endpointId: string,
  bytes: Uint8Array,
): EmailInboundEnvelope {
  if (!isEmailProvider(provider)) {
    throw failure("support_provider_payload_invalid", "Provider event payload is invalid", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw failure("support_provider_payload_invalid", "Provider event payload is invalid", 400);
  }
  let envelope: EmailInboundEnvelope;
  try {
    envelope = parseEmailInboundEnvelope(value);
  } catch (error) {
    const code = error instanceof EmailInboundContractError
      ? error.code
      : "support_provider_payload_invalid";
    throw failure(code, "Provider event payload is invalid", 422);
  }
  const expectedProvider = provider === "email_google"
    ? "google"
    : provider === "email_microsoft"
      ? "microsoft"
      : "smtp";
  if (envelope.provider !== expectedProvider || envelope.endpoint_id !== endpointId) {
    throw failure("support_provider_payload_mismatch", "Provider event payload does not match its endpoint", 422);
  }
  return envelope;
}

function isEmailProvider(provider: string) {
  return provider === "email_google" || provider === "email_microsoft" || provider === "smtp";
}

function redirectResult(redirect: string, result: string, code: string) {
  let target: URL;
  try { target = new URL(redirect); } catch { throw failure("support_oauth_redirect_invalid", "OAuth redirect is invalid", 500); }
  if (target.protocol !== "https:") throw failure("support_oauth_redirect_invalid", "OAuth redirect is invalid", 500);
  target.searchParams.set("support_result", result);
  target.searchParams.set("support_code", code);
  return Response.redirect(target.toString(), 302);
}

function providerName(value: string) {
  const provider = value.toLowerCase();
  if (!supportedProviders.has(provider)) throw failure("support_provider_unsupported", "Support provider is not supported", 404);
  return provider;
}
function stringValue(value: unknown) { return value == null ? "" : String(value).slice(0, 255); }
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
function arrayObjects(value: unknown) {
  return Array.isArray(value) ? value.map(objectValue) : [];
}
function rejectSignature(): never { throw failure("support_provider_signature_invalid", "Provider signature is invalid", 401); }
async function hmacKey(secret: string, hash: "SHA-1" | "SHA-256") {
  if (!secret) rejectSignature();
  return crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash }, false, ["sign"]);
}
async function hmacHex(secret: string, value: string) {
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-256"), arrayBuffer(bytes(value))));
  return [...digest].map((item) => item.toString(16).padStart(2, "0")).join("");
}
async function hmacBase64(secret: string, value: string) {
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-256"), arrayBuffer(bytes(value))));
  return base64(digest);
}
async function hmacSha1Base64(secret: string, value: string) {
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "SHA-1"), arrayBuffer(bytes(value))));
  return base64(digest);
}
async function sha256(value: string) { return sha256Bytes(bytes(value)); }
async function sha256Bytes(value: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer(value)));
  return [...digest].map((item) => item.toString(16).padStart(2, "0")).join("");
}
async function constantTimeEqual(left: string, right: string) {
  const leftDigest = await crypto.subtle.digest("SHA-256", bytes(left));
  const rightDigest = await crypto.subtle.digest("SHA-256", bytes(right));
  const first = new Uint8Array(leftDigest); const second = new Uint8Array(rightDigest);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < first.length; index += 1) diff |= first[index] ^ second[index];
  return diff === 0;
}
function bytes(value: string) { return new TextEncoder().encode(value); }
function arrayBuffer(value: Uint8Array): ArrayBuffer { const copy = new Uint8Array(value.length); copy.set(value); return copy.buffer; }
function base64(value: Uint8Array) { let binary = ""; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary); }
function failure(code: string, message: string, status: number) { return Object.assign(new Error(message), { code, status }); }

export default providers;
