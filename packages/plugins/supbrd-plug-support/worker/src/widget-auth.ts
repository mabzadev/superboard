import { configuredSecrets, matchesAnySecret } from "@superboard/contracts/secret";
import { verifyApplicationIdentity, requireProject } from "./auth";
import { decryptCredentialPayload } from "./secrets";
import { readBytesLimited } from "./validation";
import type { Env } from "./types";

const WIDGET_CLOCK_SKEW_SECONDS = 300;
const WIDGET_BODY_BYTES_MAXIMUM = 1024 * 1024;

export type WidgetIdentity = {
  subject: string;
  projectId: number;
  expiresAt: number;
  authentication: "identity_token" | "widget_signature";
};

export async function verifyWidgetIdentity(
  env: Env,
  request: Request,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<WidgetIdentity> {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.trim()) {
    const identity = await verifyApplicationIdentity(env, authorization);
    return {
      subject: identity.subject,
      projectId: requireProject(
        env,
        request.headers.get("x-superboard-project-id") || undefined,
      ),
      expiresAt: identity.expiresAt,
      authentication: "identity_token",
    };
  }

  const projectReference = boundedHeader(
    request.headers.get("x-superboard-project-id"),
    "widget_project_invalid",
  );
  const widgetKey = boundedHeader(
    request.headers.get("x-superboard-widget-key"),
    "widget_identity_invalid",
  );
  const visitorId = boundedHeader(
    request.headers.get("x-superboard-widget-visitor"),
    "widget_identity_invalid",
  );
  const signature = String(
    request.headers.get("x-superboard-widget-signature") || "",
  ).trim();
  const timestampText = String(
    request.headers.get("x-superboard-widget-timestamp") || "",
  ).trim();
  const timestamp = Number(timestampText);
  if (
    !/^\d{10}$/u.test(timestampText) ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > WIDGET_CLOCK_SKEW_SECONDS ||
    !/^[a-f0-9]{64}$/u.test(signature)
  ) {
    throw failure(
      "widget_identity_invalid",
      "Widget request authentication failed",
      401,
    );
  }

  const widgetKeyHash = await sha256Hex(new TextEncoder().encode(widgetKey));
  const endpoint = await env.DB.prepare(
    `SELECT endpoint.id, endpoint.project_id, endpoint.settings_json,
       credential.encrypted_payload
     FROM support_provider_endpoints endpoint
     INNER JOIN support_provider_credentials credential
       ON credential.endpoint_id = endpoint.id
       AND credential.project_id = endpoint.project_id
     WHERE endpoint.provider = 'widget'
       AND endpoint.status IN ('configured', 'validated', 'live_validated')
       AND json_extract(endpoint.settings_json, '$.widget_key_hash') = ?
     LIMIT 1`,
  )
    .bind(widgetKeyHash)
    .first<{
      id: string;
      project_id: number;
      settings_json: string;
      encrypted_payload: string;
    }>();
  if (!endpoint) {
    throw failure(
      "widget_identity_invalid",
      "Widget request authentication failed",
      401,
    );
  }
  const decrypted = await decryptCredentialPayload(
    [
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
    ],
    endpoint.encrypted_payload,
  );
  const storedKey = String(decrypted.payload.widget_key || "");
  const signingSecret = String(decrypted.payload.signing_secret || "");
  if (
    !signingSecret ||
    !(await matchesAnySecret(widgetKey, configuredSecrets(storedKey)))
  ) {
    throw failure(
      "widget_identity_invalid",
      "Widget request authentication failed",
      401,
    );
  }
  requireAllowedWidgetOrigin(request, decrypted.payload, endpoint.settings_json);

  const body = await readBytesLimited(
    request.clone() as unknown as Parameters<typeof readBytesLimited>[0],
    WIDGET_BODY_BYTES_MAXIMUM,
    "widget_body_too_large",
    "Widget request body is limited to 1 MB",
  );
  const publicPath = publicWidgetPath(new URL(request.url).pathname);
  const canonicalInput = [
    timestampText,
    request.method.toUpperCase(),
    publicPath,
    projectReference,
    visitorId,
    request.headers.get("idempotency-key") || "",
    await sha256Hex(body),
  ].join("\n");
  const expected = await hmacHex(signingSecret, canonicalInput);
  if (!(await matchesAnySecret(signature, configuredSecrets(expected)))) {
    throw failure(
      "widget_identity_invalid",
      "Widget request authentication failed",
      401,
    );
  }
  const subject = `widget:${await sha256Hex(
    new TextEncoder().encode(`${endpoint.id}:${visitorId}`),
  )}`;
  return {
    subject,
    projectId: endpoint.project_id,
    expiresAt: Date.now() + 15 * 60 * 1000,
    authentication: "widget_signature",
  };
}

function requireAllowedWidgetOrigin(
  request: Request,
  credentials: Record<string, unknown>,
  settingsJson: string,
) {
  const settings = parseObject(settingsJson);
  const allowed = normalizeDomains(
    credentials.allowed_domains ?? settings.allowed_domains,
  );
  if (allowed.length === 0) {
    throw failure(
      "configuration_required",
      "Widget domains are not configured",
      422,
    );
  }
  const source = request.headers.get("origin") || request.headers.get("referer");
  let hostname = "";
  try {
    const url = new URL(source || "");
    if (url.protocol !== "https:" && !isLocalDevelopmentHost(url.hostname)) {
      throw new Error("insecure origin");
    }
    hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    throw failure(
      "widget_domain_invalid",
      "Widget request origin is not allowed",
      403,
    );
  }
  if (!allowed.some((domain) => domainMatches(hostname, domain))) {
    throw failure(
      "widget_domain_invalid",
      "Widget request origin is not allowed",
      403,
    );
  }
}

function normalizeDomains(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(values.map((item) => String(item).trim().toLowerCase())
    .filter((item) => /^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/u.test(item)))]
    .slice(0, 100);
}

function domainMatches(hostname: string, allowed: string): boolean {
  if (allowed.startsWith("*.")) {
    const suffix = allowed.slice(2);
    return hostname.endsWith(`.${suffix}`) && hostname !== suffix;
  }
  return hostname === allowed;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function publicWidgetPath(pathname: string): string {
  const prefix = "/public/v1/widget";
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    throw failure("widget_path_invalid", "Widget request path is invalid", 422);
  }
  return `/api/v1/support-widget${pathname.slice(prefix.length)}`;
}

function boundedHeader(value: string | null, code: string): string {
  const result = String(value || "").trim();
  if (!result || result.length > 255 || /[\r\n]/u.test(result)) {
    throw failure(code, "Widget request authentication failed", 401);
  }
  return result;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const decoded: unknown = JSON.parse(value);
    return decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? decoded as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy(value))));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    copy(new TextEncoder().encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    copy(new TextEncoder().encode(value)),
  )));
}

function copy(value: Uint8Array): ArrayBuffer {
  const result = new Uint8Array(value.byteLength);
  result.set(value);
  return result.buffer;
}

function hex(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
