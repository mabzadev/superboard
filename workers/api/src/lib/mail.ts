import { Env } from "../types";
import {
  EMAIL_SERVICE_AWS_SES_EVENTS_PATH,
  EMAIL_SERVICE_SEND_PATH,
} from "@superboard/contracts/email";
import { readJsonObjectLimited, readTextLimited } from "./http-limits";

type MailMessage = {
  to: string;
  idempotencyKey?: string;
  subject: string;
  html: string;
  text: string;
};

type MailResult = {
  provider: string;
  id?: string;
};

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function providerFor(env: Env): string | null {
  const configured = env.MAIL_PROVIDER?.trim().toLowerCase();
  if (configured) return configured;
  if (env.EMAIL_SERVICE) return "email-service";
  if (env.EMAIL) return "cloudflare";
  if (env.RESEND_API_KEY) return "resend";
  if (env.POSTMARK_SERVER_TOKEN) return "postmark";
  if (env.SENDGRID_API_KEY) return "sendgrid";
  if (env.MAIL_WEBHOOK_URL) return "webhook";
  return null;
}

function mailFrom(env: Env): string {
  const configured = env.MAIL_FROM?.trim();
  if (!configured) throw new Error("MAIL_FROM is not configured");
  return configured;
}

async function readError(response: Response): Promise<string> {
  const text = await readTextLimited(
    response,
    65_536,
    "Mail provider error response is too large",
  ).catch(() => "");
  if (!text) return response.statusText || `HTTP ${response.status}`;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return text;
    const payload = parsed as Record<string, unknown>;
    const error =
      payload.error && typeof payload.error === "object"
        ? (payload.error as Record<string, unknown>)
        : null;
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const first =
      errors[0] && typeof errors[0] === "object"
        ? (errors[0] as Record<string, unknown>)
        : null;
    return (
      optionalString(payload.message) ||
      optionalString(error?.message) ||
      optionalString(payload.error) ||
      optionalString(first?.message) ||
      text
    );
  } catch {
    return text;
  }
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return readJsonObjectLimited(
    response,
    262_144,
    "Mail provider response is too large",
  ).catch((): Record<string, unknown> => ({}));
}

export async function sendMail(
  env: Env,
  message: MailMessage,
): Promise<MailResult> {
  const provider = providerFor(env);
  if (!provider) {
    throw new Error("Mail provider is not configured");
  }

  if (provider === "email-service") {
    if (!env.EMAIL_SERVICE)
      throw new Error("EMAIL_SERVICE binding is not configured");
    if (!env.EMAIL_INTERNAL_TOKEN)
      throw new Error("EMAIL_INTERNAL_TOKEN is not configured");
    const response = await env.EMAIL_SERVICE.fetch(
      `https://email.internal${EMAIL_SERVICE_SEND_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": env.EMAIL_INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          kind: "transactional",
          idempotencyKey: message.idempotencyKey,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(await readError(response));
    const payload = await readJsonObjectLimited(
      response,
      262_144,
      "Email service response is too large",
    ).catch((): Record<string, unknown> => ({}));
    return { provider, id: optionalString(payload.id) };
  }

  const from = mailFrom(env);

  if (provider === "cloudflare") {
    if (!env.EMAIL) throw new Error("EMAIL binding is not configured");
    const result = await env.EMAIL.send({
      from: parseEmailAddress(from),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { provider, id: result.messageId };
  }

  if (provider === "resend") {
    if (!env.RESEND_API_KEY)
      throw new Error("RESEND_API_KEY is not configured");
    const payload = await postJson(
      "https://api.resend.com/emails",
      {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      {
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      },
    );
    return { provider, id: optionalString(payload.id) };
  }

  if (provider === "postmark") {
    if (!env.POSTMARK_SERVER_TOKEN)
      throw new Error("POSTMARK_SERVER_TOKEN is not configured");
    const payload = await postJson(
      "https://api.postmarkapp.com/email",
      {
        "X-Postmark-Server-Token": env.POSTMARK_SERVER_TOKEN,
      },
      {
        From: from,
        To: message.to,
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        MessageStream: env.POSTMARK_MESSAGE_STREAM || "outbound",
      },
    );
    return { provider, id: optionalString(payload.MessageID) };
  }

  if (provider === "sendgrid") {
    if (!env.SENDGRID_API_KEY)
      throw new Error("SENDGRID_API_KEY is not configured");
    const payload = await postJson(
      "https://api.sendgrid.com/v3/mail/send",
      {
        Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      },
      {
        personalizations: [{ to: [{ email: message.to }] }],
        from: { email: from.match(/<([^>]+)>/)?.[1] || from },
        subject: message.subject,
        content: [
          { type: "text/plain", value: message.text },
          { type: "text/html", value: message.html },
        ],
      },
    );
    return { provider, id: optionalString(payload.id) };
  }

  if (provider === "webhook") {
    if (!env.MAIL_WEBHOOK_URL)
      throw new Error("MAIL_WEBHOOK_URL is not configured");
    const headers: Record<string, string> = {};
    if (env.MAIL_WEBHOOK_TOKEN)
      headers.Authorization = `Bearer ${env.MAIL_WEBHOOK_TOKEN}`;
    const payload = await postJson(env.MAIL_WEBHOOK_URL, headers, {
      from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return { provider, id: optionalString(payload.id) };
  }

  throw new Error(`Unsupported mail provider: ${provider}`);
}

export async function proxyAwsSesEvent(
  env: Env,
  request: Request,
): Promise<Response> {
  if (!env.EMAIL_SERVICE) {
    return Response.json({ error: "email_service_disabled" }, { status: 404 });
  }
  try {
    const body = await readTextLimited(
      request,
      1_100_000,
      "AWS SNS message is too large",
    );
    const response = await env.EMAIL_SERVICE.fetch(
      `https://email.internal${EMAIL_SERVICE_AWS_SES_EVENTS_PATH}`,
      {
        method: "POST",
        headers: {
          "content-type":
            request.headers.get("content-type") || "text/plain; charset=utf-8",
          ...(request.headers.get("x-amz-sns-message-type")
            ? {
                "x-amz-sns-message-type": String(
                  request.headers.get("x-amz-sns-message-type"),
                ),
              }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      },
    );
    const responseBody = await readTextLimited(
      response,
      65_536,
      "Email service response is too large",
    );
    return new Response(responseBody, {
      status: response.status,
      headers: {
        "content-type":
          response.headers.get("content-type") ||
          "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const status = Number((error as { status?: number }).status || 503);
    return Response.json(
      {
        error:
          status === 413
            ? "aws_sns_message_too_large"
            : "email_service_unavailable",
      },
      { status: status === 413 ? 413 : 503 },
    );
  }
}

function parseEmailAddress(value: string): string | EmailAddress {
  const match = value.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (!match) return value.trim();
  return { name: match[1].trim(), email: match[2].trim() };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function dashboardBaseUrl(env: Env): string {
  if (env.APP_URL) return env.APP_URL.replace(/\/$/, "");
  if (env.REACT_HOST) {
    const protocol = env.REACT_HOST_PROTOCOL || "https://";
    return `${protocol}${env.REACT_HOST}`.replace(/\/$/, "");
  }
  throw new Error("APP_URL is not configured");
}

function publicUrl(env: Env, path: string, token: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, dashboardBaseUrl(env));
  url.searchParams.set("token", token);
  return url.toString();
}

export function passwordResetUrl(env: Env, token: string): string {
  return publicUrl(
    env,
    env.REACT_HOST_CHANGE_PASSWORD_PATH || "/new_password",
    token,
  );
}

export function invitationUrl(env: Env, token: string): string {
  return publicUrl(
    env,
    env.REACT_HOST_ACCEPT_INVITE_PATH || "/accept-invite",
    token,
  );
}

export function passwordResetMessage(
  env: Env,
  to: string,
  token: string,
): MailMessage {
  const url = passwordResetUrl(env, token);
  const safeUrl = htmlEscape(url);
  return {
    to,
    idempotencyKey: `password-reset:${token}`,
    subject: "Reset your SuperBoard password",
    text: `Reset your SuperBoard password using this link: ${url}\n\nThis link expires in 6 hours.`,
    html: [
      "<p>Use the link below to reset your SuperBoard password.</p>",
      `<p><a href="${safeUrl}">Reset your password</a></p>`,
      "<p>This link expires in 6 hours.</p>",
    ].join(""),
  };
}

export function invitationMessage(
  env: Env,
  to: string,
  token: string,
): MailMessage {
  const url = invitationUrl(env, token);
  const safeUrl = htmlEscape(url);
  return {
    to,
    idempotencyKey: `invitation:${token}`,
    subject: "You have been invited to SuperBoard",
    text: `Accept your SuperBoard invitation using this link: ${url}`,
    html: [
      "<p>You have been invited to join a SuperBoard workspace.</p>",
      `<p><a href="${safeUrl}">Accept invitation</a></p>`,
    ].join(""),
  };
}

export function downloadFileMessage(
  _env: Env,
  to: string,
  fileName: string,
  url: string,
): MailMessage {
  const safeUrl = htmlEscape(url);
  const safeName = htmlEscape(fileName);
  return {
    to,
    idempotencyKey: `export:${fileName.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 180)}`,
    subject: "Data export - SuperBoard",
    text: `Your requested SuperBoard export is ready to download: ${url}\n\nThis link expires in 24 hours.`,
    html: [
      "<p>Your requested file is now available for download.</p>",
      `<p><strong>${safeName}</strong></p>`,
      `<p><a href="${safeUrl}">Download File</a></p>`,
      "<p>This link expires in 24 hours.</p>",
    ].join(""),
  };
}
