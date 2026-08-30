import type { Context } from "hono";
import {
  EMAIL_INBOUND_ENDPOINT_HEADER,
  EMAIL_INBOUND_LIMITS,
  EMAIL_INBOUND_PROVIDER_HEADER,
  EMAIL_SERVICE_INBOUND_NORMALIZE_PATH,
  parseEmailInboundEnvelope,
} from "@superboard/contracts/email";
import {
  RequestBodyError,
  readBytesLimited,
} from "@superboard/contracts/request-body";
import type { Env } from "../types";
import { domainError } from "./domain-modules";

type GatewayContext = Context<{ Bindings: Env }>;
type SupportSurface =
  | "client"
  | "widget"
  | "help-center"
  | "oauth"
  | "realtime";

const PUBLIC_BODY_LIMITS: Record<
  Exclude<SupportSurface, "client" | "realtime">,
  number
> = {
  widget: 1024 * 1024,
  "help-center": 64 * 1024,
  oauth: 64 * 1024,
};
const SUPPORT_PROVIDER_EVENT_BYTES_MAXIMUM = 512 * 1024;

const PROVIDER_SIGNATURE_HEADERS = Object.freeze([
  "x-hub-signature",
  "x-hub-signature-256",
  "x-twilio-signature",
  "x-line-signature",
  "x-shopify-hmac-sha256",
  "x-telegram-bot-api-secret-token",
  "x-slack-signature",
  "x-slack-request-timestamp",
  "tiktok-signature",
  "x-tiktok-signature",
  "x-superboard-signature",
  "stripe-signature",
  "webhook-signature",
  "webhook-timestamp",
  "webhook-id",
  "x-signature",
  "x-signature-ed25519",
  "x-signature-timestamp",
  "x-linear-signature",
  "x-notion-signature",
  "x-dyte-signature",
  "x-twitter-webhooks-signature",
]);

export function isSupportWidgetPath(pathname: string): boolean {
  return (
    pathname === "/api/v1/support-widget" ||
    pathname.startsWith("/api/v1/support-widget/")
  );
}

export async function proxySupportSurface(
  c: GatewayContext,
  internalPath: string,
  surface: SupportSurface,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  if (!c.env.SUPPORT_MODULE) {
    return domainError(
      requestId,
      503,
      "module_unavailable",
      "Support service is unavailable",
      { retryable: true },
    );
  }
  const method = c.req.method.toUpperCase();
  try {
    const source = new URL(c.req.url);
    const target = new URL(`https://support.internal${internalPath}`);
    target.search = source.search;
    const headers = supportSurfaceHeaders(
      c.req.raw.headers,
      requestId,
      surface,
    );
    let body: BodyInit | null = null;
    if (method !== "GET" && method !== "HEAD") {
      if (surface === "client") {
        body = c.req.raw.body;
      } else if (surface !== "realtime") {
        const bytes = await readBytesLimited(
          c.req.raw,
          PUBLIC_BODY_LIMITS[surface],
        );
        body = bytes.byteLength ? copiedArrayBuffer(bytes) : null;
      }
    }
    const response = await c.env.SUPPORT_MODULE.fetch(
      new Request(target, { method, headers, body }),
    );
    return publicSupportResponse(response, requestId);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return domainError(requestId, error.status, error.code, error.message, {
        retryable: false,
      });
    }
    console.error(
      JSON.stringify({
        event: "support_public_surface_failed",
        surface,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      502,
      "module_request_failed",
      "Support service request failed",
      { retryable: true },
    );
  }
}

export async function proxySupportProviderEvent(
  c: GatewayContext,
  providerInput: string,
  endpointIdInput: string,
): Promise<Response> {
  const requestId = requestIdFrom(c.req.raw);
  const provider = providerInput.trim().toLowerCase();
  const endpointId = endpointIdInput.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(provider)) {
    return domainError(
      requestId,
      422,
      "provider_invalid",
      "Provider is invalid",
      { retryable: false },
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u.test(endpointId)) {
    return domainError(
      requestId,
      422,
      "provider_endpoint_invalid",
      "Provider endpoint is invalid",
      { retryable: false },
    );
  }
  if (!c.env.SUPPORT_MODULE) {
    return domainError(
      requestId,
      503,
      "module_unavailable",
      "Support service is unavailable",
      { retryable: true },
    );
  }
  try {
    const method = c.req.method.toUpperCase();
    const emailProvider = canonicalEmailProvider(provider);
    const sourceBytes =
      method === "GET" || method === "HEAD"
        ? new Uint8Array()
        : await readBytesLimited(
            c.req.raw,
            emailProvider
              ? EMAIL_INBOUND_LIMITS.networkBodyBytesMaximum
              : SUPPORT_PROVIDER_EVENT_BYTES_MAXIMUM,
          );
    const providerUrl = canonicalProviderUrl(c.env, c.req.raw);
    const headers = providerHeaders(c.req.raw.headers, requestId);
    headers.set("X-SuperBoard-Provider-Url", providerUrl);
    let body = copiedArrayBuffer(sourceBytes);
    if (emailProvider && method === "POST") {
      const envelope = await normalizeInboundEmail(
        c.env,
        sourceBytes,
        c.req.raw.headers.get("content-type"),
        emailProvider,
        endpointId,
        requestId,
      );
      body = copiedArrayBuffer(
        new TextEncoder().encode(JSON.stringify(envelope)),
      );
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("X-SuperBoard-Inbound-Normalized", "email-v1");
    }
    const target = new URL(
      `https://support.internal/public/v1/providers/${encodeURIComponent(provider)}/${encodeURIComponent(endpointId)}/events`,
    );
    target.search = new URL(c.req.url).search;
    const response = await c.env.SUPPORT_MODULE.fetch(
      new Request(target, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? null : body,
      }),
    );
    return publicSupportResponse(response, requestId);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return domainError(requestId, error.status, error.code, error.message, {
        retryable: false,
      });
    }
    if (error instanceof SupportEmailNormalizationError) {
      return domainError(requestId, error.status, error.code, error.message, {
        retryable: error.retryable,
      });
    }
    console.error(
      JSON.stringify({
        event: "support_provider_gateway_failed",
        provider,
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return domainError(
      requestId,
      502,
      "provider_request_failed",
      "Support provider request failed",
      { retryable: true },
    );
  }
}

async function normalizeInboundEmail(
  env: Env,
  source: Uint8Array,
  contentType: string | null,
  provider: "google" | "microsoft" | "smtp",
  endpointId: string,
  requestId: string,
) {
  if (!env.EMAIL_SERVICE || !env.EMAIL_INTERNAL_TOKEN?.trim()) {
    throw new SupportEmailNormalizationError(
      503,
      "email_processing_unavailable",
      "Support email processing is unavailable",
      true,
    );
  }
  const response = await env.EMAIL_SERVICE.fetch(
    `https://email.internal${EMAIL_SERVICE_INBOUND_NORMALIZE_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": contentType || "application/octet-stream",
        "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
        "x-request-id": requestId,
        [EMAIL_INBOUND_PROVIDER_HEADER]: provider,
        [EMAIL_INBOUND_ENDPOINT_HEADER]: endpointId,
      },
      body: copiedArrayBuffer(source),
      signal: AbortSignal.timeout(10_000),
    },
  );
  let value: unknown;
  try {
    const bytes = await readBytesLimited(
      response,
      EMAIL_INBOUND_LIMITS.networkBodyBytesMaximum,
    );
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof RequestBodyError) {
      throw new SupportEmailNormalizationError(
        502,
        "email_processing_invalid_response",
        "Support email processing returned an invalid response",
        true,
      );
    }
    throw new SupportEmailNormalizationError(
      502,
      "email_processing_invalid_response",
      "Support email processing returned an invalid response",
      true,
    );
  }
  if (!response.ok) {
    if (![400, 413, 422].includes(response.status)) {
      throw new SupportEmailNormalizationError(
        503,
        "email_processing_unavailable",
        "Support email processing is unavailable",
        true,
      );
    }
    const code = safeUpstreamCode(value);
    throw new SupportEmailNormalizationError(
      response.status === 413 ? 413 : 422,
      code === "body_too_large" ? code : "provider_event_invalid",
      response.status === 413
        ? "Provider event body is too large"
        : "Provider event is invalid",
      false,
    );
  }
  const payload = isRecord(value) && isRecord(value.data) ? value.data : value;
  try {
    return parseEmailInboundEnvelope(payload);
  } catch {
    throw new SupportEmailNormalizationError(
      502,
      "email_processing_invalid_response",
      "Support email processing returned an invalid response",
      true,
    );
  }
}

function supportSurfaceHeaders(
  source: Headers,
  requestId: string,
  surface: SupportSurface,
): Headers {
  const allowed = new Set([
    "accept",
    "content-type",
    "content-length",
    "idempotency-key",
    "origin",
    "referer",
    "user-agent",
    "cf-connecting-ip",
    "x-filename",
    "x-request-id",
  ]);
  if (surface === "client") {
    allowed.add("authorization");
    allowed.add("x-superboard-project-id");
    allowed.add("x-opengrow-project-id");
  }
  if (surface === "widget") {
    for (const name of [
      "authorization",
      "x-superboard-project-id",
      "x-superboard-widget-key",
      "x-superboard-widget-visitor",
      "x-superboard-widget-signature",
      "x-superboard-widget-timestamp",
    ]) {
      allowed.add(name);
    }
  }
  if (surface === "realtime") {
    for (const name of [
      "upgrade",
      "connection",
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-extensions",
      "sec-websocket-protocol",
    ]) {
      allowed.add(name);
    }
  }
  const headers = selectedHeaders(source, allowed);
  if (surface === "client") {
    const project = headers.get("x-superboard-project-id");
    if (project && !headers.has("x-opengrow-project-id")) {
      headers.set("x-opengrow-project-id", project);
    }
  }
  headers.set("x-request-id", requestId);
  return headers;
}

function providerHeaders(source: Headers, requestId: string): Headers {
  const allowed = new Set([
    "content-type",
    "x-request-id",
    ...PROVIDER_SIGNATURE_HEADERS,
  ]);
  const headers = selectedHeaders(source, allowed);
  headers.delete("x-superboard-provider-url");
  headers.delete("x-superboard-inbound-normalized");
  headers.set("x-request-id", requestId);
  return headers;
}

function selectedHeaders(source: Headers, allowed: Set<string>): Headers {
  const result = new Headers();
  for (const [name, value] of source) {
    if (allowed.has(name.toLowerCase())) result.set(name, value);
  }
  return result;
}

function publicSupportResponse(
  response: Response,
  requestId: string,
): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    const normalized = name.toLowerCase();
    if (
      normalized === "server" ||
      normalized === "x-powered-by" ||
      normalized === "x-superboard-provider-url" ||
      normalized === "x-superboard-inbound-normalized" ||
      normalized.startsWith("x-internal-") ||
      normalized.startsWith("x-context-") ||
      new Set([
        "x-project-id",
        "x-project-ref",
        "x-instance-id",
        "x-environment",
        "x-actor-id",
        "x-role",
      ]).has(normalized)
    ) {
      headers.delete(name);
    }
  }
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
    webSocket: response.webSocket,
  });
}

function canonicalProviderUrl(env: Env, request: Request): string {
  const domain = String(env.API_DOMAIN || "").trim();
  if (!domain) {
    throw new SupportEmailNormalizationError(
      503,
      "provider_url_unavailable",
      "Support provider URL is unavailable",
      true,
    );
  }
  const configured = new URL(
    domain.includes("://") ? domain : `https://${domain}`,
  );
  if (
    configured.protocol !== "https:" ||
    configured.username ||
    configured.password ||
    configured.pathname !== "/"
  ) {
    throw new SupportEmailNormalizationError(
      503,
      "provider_url_unavailable",
      "Support provider URL is unavailable",
      true,
    );
  }
  const canonical = new URL(request.url);
  canonical.protocol = "https:";
  canonical.host = configured.host;
  canonical.username = "";
  canonical.password = "";
  canonical.hash = "";
  return canonical.toString();
}

function canonicalEmailProvider(
  provider: string,
): "google" | "microsoft" | "smtp" | null {
  const normalized = provider.replaceAll("_", "-");
  if (new Set(["google", "gmail", "email-google"]).has(normalized)) {
    return "google";
  }
  if (new Set(["microsoft", "outlook", "email-microsoft"]).has(normalized)) {
    return "microsoft";
  }
  if (new Set(["smtp", "email", "email-smtp"]).has(normalized)) {
    return "smtp";
  }
  return null;
}

function requestIdFrom(request: Request): string {
  const provided = String(request.headers.get("x-request-id") || "").trim();
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(provided)
    ? provided
    : crypto.randomUUID();
}

function copiedArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function safeUpstreamCode(value: unknown): string {
  const input = isRecord(value) ? value : {};
  const nested = isRecord(input.error) ? input.error : input;
  const code = String(nested.code || "").trim();
  return /^[a-z][a-z0-9_]{0,127}$/u.test(code)
    ? code
    : "provider_event_invalid";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

class SupportEmailNormalizationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SupportEmailNormalizationError";
  }
}
