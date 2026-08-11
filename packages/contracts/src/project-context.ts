export const DOMAIN_MODULE_NAMES = [
  "app",
  "products",
  "paywalls",
  "dynamic-links",
  "support",
  "marketing",
  "onboardings",
] as const;

export type DomainModuleName = (typeof DOMAIN_MODULE_NAMES)[number];
export type ProjectContextAudience = DomainModuleName | "identity";
export type ProjectEnvironment = "production" | "test";

export interface ProjectContext {
  projectId: number;
  projectRef: string;
  instanceId: number;
  environment: ProjectEnvironment;
  /** Authenticated dashboard user id, or 0 for an Access Key SDK principal. */
  actorId: number;
  role: string;
  requestId: string;
  issuedAt: number;
}

export interface InternalProjectContext extends ProjectContext {
  module: ProjectContextAudience;
  method: string;
  pathname: string;
}

export type ProjectContextVerification =
  | { ok: true; context: InternalProjectContext }
  | {
      ok: false;
      code:
        | "internal_auth_invalid"
        | "project_context_invalid"
        | "project_context_expired"
        | "project_context_signature_invalid";
      message: string;
    };

export const PROJECT_CONTEXT_HEADERS = Object.freeze({
  token: "x-internal-token",
  projectId: "x-project-id",
  projectRef: "x-project-ref",
  instanceId: "x-instance-id",
  environment: "x-environment",
  actorId: "x-actor-id",
  role: "x-role",
  requestId: "x-request-id",
  issuedAt: "x-context-issued-at",
  version: "x-context-version",
  signature: "x-context-signature",
});

const CONTEXT_VERSION = "1";
const CONTEXT_PREFIX = "opengrow-project-context-v1";
const PROJECT_REF_PATTERN = /^(\d+)-(prod|test)$/;
const ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function canonicalProjectContext(
  context: InternalProjectContext,
): string {
  return [
    CONTEXT_PREFIX,
    context.module,
    context.method.toUpperCase(),
    context.pathname,
    String(context.projectId),
    context.projectRef,
    String(context.instanceId),
    context.environment,
    String(context.actorId),
    context.role,
    context.requestId,
    String(context.issuedAt),
  ].join("\n");
}

export async function signProjectContext(
  context: InternalProjectContext,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("Project context signing secret is missing");
  const key = await importHmacKey(secret, ["sign"]);
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encode(canonicalProjectContext(context)),
  );
  return base64UrlEncode(new Uint8Array(bytes));
}

export async function verifyProjectContextSignature(
  context: InternalProjectContext,
  secret: string,
  signature: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
  toleranceSeconds = 60,
): Promise<boolean> {
  if (
    !secret ||
    !Number.isSafeInteger(context.issuedAt) ||
    Math.abs(nowSeconds - context.issuedAt) > toleranceSeconds
  ) {
    return false;
  }
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(signature);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    encode(canonicalProjectContext(context)),
  );
}

export async function verifyInternalProjectContextRequest(
  request: Request,
  secret: SecretCandidates,
  expectedModule: ProjectContextAudience,
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): Promise<ProjectContextVerification> {
  const providedToken =
    request.headers.get(PROJECT_CONTEXT_HEADERS.token) || "";
  const candidates =
    typeof secret === "string"
      ? configuredSecrets(secret)
      : configuredSecrets(...secret);
  const matchingSecrets = (
    await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        matches: await constantTimeEqual(providedToken, candidate),
      })),
    )
  )
    .filter(({ matches }) => matches)
    .map(({ candidate }) => candidate);
  if (!providedToken || matchingSecrets.length !== 1) {
    return {
      ok: false,
      code: "internal_auth_invalid",
      message: "Internal authentication failed",
    };
  }
  if (
    request.headers.get(PROJECT_CONTEXT_HEADERS.version) !== CONTEXT_VERSION
  ) {
    return invalidContext("Unsupported project context version");
  }

  const projectId = positiveInteger(
    request.headers.get(PROJECT_CONTEXT_HEADERS.projectId),
  );
  const instanceId = positiveInteger(
    request.headers.get(PROJECT_CONTEXT_HEADERS.instanceId),
  );
  const actorId = nonNegativeInteger(
    request.headers.get(PROJECT_CONTEXT_HEADERS.actorId),
  );
  const issuedAt = positiveInteger(
    request.headers.get(PROJECT_CONTEXT_HEADERS.issuedAt),
  );
  const projectRef =
    request.headers.get(PROJECT_CONTEXT_HEADERS.projectRef) || "";
  const environment = request.headers.get(PROJECT_CONTEXT_HEADERS.environment);
  const role = request.headers.get(PROJECT_CONTEXT_HEADERS.role) || "";
  const requestId =
    request.headers.get(PROJECT_CONTEXT_HEADERS.requestId) || "";
  const signature =
    request.headers.get(PROJECT_CONTEXT_HEADERS.signature) || "";
  const parsedRef = PROJECT_REF_PATTERN.exec(projectRef);

  if (
    !projectId ||
    !instanceId ||
    actorId === null ||
    !issuedAt ||
    !parsedRef ||
    Number(parsedRef[1]) !== instanceId ||
    (environment !== "production" && environment !== "test") ||
    (parsedRef[2] === "test" ? "test" : "production") !== environment ||
    !ROLE_PATTERN.test(role) ||
    !REQUEST_ID_PATTERN.test(requestId) ||
    !signature
  ) {
    return invalidContext("Project context headers are invalid or incomplete");
  }

  const context: InternalProjectContext = {
    module: expectedModule,
    method: request.method.toUpperCase(),
    pathname: new URL(request.url).pathname,
    projectId,
    projectRef,
    instanceId,
    environment,
    actorId,
    role,
    requestId,
    issuedAt,
  };
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const toleranceSeconds = options.toleranceSeconds ?? 60;
  if (Math.abs(nowSeconds - issuedAt) > toleranceSeconds) {
    return {
      ok: false,
      code: "project_context_expired",
      message: "Project context is outside the allowed clock window",
    };
  }
  if (
    !(await verifyProjectContextSignature(
      context,
      matchingSecrets[0],
      signature,
      nowSeconds,
      toleranceSeconds,
    ))
  ) {
    return {
      ok: false,
      code: "project_context_signature_invalid",
      message: "Project context signature is invalid",
    };
  }
  return { ok: true, context };
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function invalidContext(message: string): ProjectContextVerification {
  return { ok: false, code: "project_context_invalid", message };
}

function importHmacKey(
  secret: string,
  keyUsages: Array<"sign" | "verify">,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    keyUsages,
  );
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
import {
  configuredSecrets,
  constantTimeEqual,
  type SecretCandidates,
} from "./secret";
