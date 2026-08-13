import {
  EMAIL_SERVICE_PROVIDER_EVENTS_PATH,
  EMAIL_SERVICE_SMTP_TRANSPORT_PATH,
  type EmailProviderEvent,
  type EmailProviderEventPage,
  type EmailSmtpPublicConfig,
  type EmailSmtpSecretConfig,
  type EmailSmtpTransportMessage,
  type EmailSmtpTransportReceipt,
} from "@superboard/contracts/email";
import { readTextLimited } from "@superboard/contracts/request-body";
import { failure } from "./auth";
import type { Env } from "./types";

const MAX_RECEIPT_BYTES = 64_000;

export type MarketingEmailCommand = {
  idempotencyKey: string;
  projectId: number;
  referenceId: string;
  profileId: string;
  publicConfig: EmailSmtpPublicConfig;
  secret: EmailSmtpSecretConfig;
  message: EmailSmtpTransportMessage;
};

export async function sendSmtpMessage(
  env: Env,
  command: MarketingEmailCommand,
): Promise<EmailSmtpTransportReceipt> {
  if (!env.EMAIL_SERVICE || !env.EMAIL_INTERNAL_TOKEN?.trim()) {
    throw failure(
      "email_service_unavailable",
      "Email delivery service is not configured",
      503,
    );
  }
  let response: Response;
  try {
    response = await env.EMAIL_SERVICE.fetch(
      `https://email.internal${EMAIL_SERVICE_SMTP_TRANSPORT_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          idempotencyKey: command.idempotencyKey,
          source: "marketing",
          projectId: command.projectId,
          referenceId: command.referenceId,
          profileId: command.profileId,
          publicConfig: command.publicConfig,
          // AWS SES credentials are owned exclusively by the Email Worker.
          // Existing project profiles may still contain legacy SMTP material,
          // but it never crosses the binding in managed SES mode.
          secret:
            env.EMAIL_PROVIDER === "aws-ses"
              ? { password: null }
              : command.secret,
          message: command.message,
        }),
      },
    );
  } catch {
    throw failure(
      "email_transport_outcome_unknown",
      "Email delivery outcome could not be confirmed",
      503,
    );
  }
  let raw: string;
  try {
    raw = await readTextLimited(response, MAX_RECEIPT_BYTES);
  } catch {
    throw failure(
      "email_service_response_invalid",
      "Email delivery service returned an oversized response",
      502,
    );
  }
  const body = safeJson(raw);
  if (!response.ok) {
    const code =
      typeof body?.error === "string" ? body.error : "email_service_failed";
    throw failure(
      code,
      code === "email_transport_in_progress"
        ? "Email delivery is already in progress"
        : "Email delivery service rejected the message",
      response.status >= 400 && response.status <= 599 ? response.status : 502,
      objectValue(body?.details),
    );
  }
  if (
    body?.status !== "sent" ||
    typeof body.id !== "string" ||
    typeof body.messageId !== "string" ||
    typeof body.response !== "string"
  ) {
    throw failure(
      "email_service_response_invalid",
      "Email delivery service returned an invalid receipt",
      502,
    );
  }
  return body as unknown as EmailSmtpTransportReceipt;
}

export function isEmailTransportInProgress(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return new Set([
    "email_transport_in_progress",
    "email_transport_outcome_unknown",
    "smtp_outcome_unknown",
    "email_service_failed",
    "email_service_response_invalid",
  ]).has(String((error as { code?: unknown }).code || ""));
}

export async function pendingEmailProviderEvents(
  env: Env,
  source = "marketing",
): Promise<EmailProviderEvent[]> {
  const response = await emailServiceFetch(
    env,
    `${EMAIL_SERVICE_PROVIDER_EVENTS_PATH}?source=${encodeURIComponent(source)}&limit=100`,
    { method: "GET" },
  );
  const raw = await readTextLimited(response, MAX_RECEIPT_BYTES);
  const body = safeJson(raw) as unknown as EmailProviderEventPage | null;
  if (!response.ok || !body || !Array.isArray(body.events)) {
    throw failure(
      "email_provider_events_unavailable",
      "Email provider events are temporarily unavailable",
      response.status >= 400 ? response.status : 502,
    );
  }
  return body.events.filter(validProviderEvent);
}

export async function acknowledgeEmailProviderEvents(
  env: Env,
  ids: string[],
  source = "marketing",
): Promise<void> {
  if (!ids.length) return;
  const response = await emailServiceFetch(
    env,
    `${EMAIL_SERVICE_PROVIDER_EVENTS_PATH}/ack`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source, ids }),
    },
  );
  if (!response.ok) {
    throw failure(
      "email_provider_event_ack_failed",
      "Email provider event acknowledgement failed",
      response.status,
    );
  }
}

async function emailServiceFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!env.EMAIL_SERVICE || !env.EMAIL_INTERNAL_TOKEN?.trim()) {
    throw failure(
      "email_service_unavailable",
      "Email delivery service is not configured",
      503,
    );
  }
  try {
    return await env.EMAIL_SERVICE.fetch(`https://email.internal${path}`, {
      ...init,
      headers: {
        "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    throw failure(
      "email_service_unavailable",
      "Email delivery service is temporarily unavailable",
      503,
    );
  }
}

function validProviderEvent(value: unknown): value is EmailProviderEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Partial<EmailProviderEvent>;
  return (
    typeof event.id === "string" &&
    event.provider === "aws-ses" &&
    event.source === "marketing" &&
    Number.isSafeInteger(event.projectId) &&
    typeof event.referenceId === "string" &&
    typeof event.providerMessageId === "string" &&
    new Set([
      "delivered",
      "soft_bounce",
      "hard_bounce",
      "complaint",
      "delivery_delayed",
      "rejected",
    ]).has(String(event.eventType)) &&
    typeof event.occurredAt === "string" &&
    Boolean(event.metadata && typeof event.metadata === "object")
  );
}

function safeJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
