import { Hono } from "hono";
import { billingServiceEnabled, ingestProviderEventWithBillingAuthority } from "../lib/billing-service";
import { ingestBillingProviderEvent } from "../lib/billing-provider-ingress";
import { readTextLimited } from "../lib/http-limits";
import {
  providerHttpError,
  providerTaggedHttpError,
  providerUnhandledHttpError,
} from "../lib/provider-http-errors";
import type { Env } from "../types";

const webhooks = new Hono<{ Bindings: Env }>();
webhooks.onError((error, c) => providerUnhandledHttpError(c, error));

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function appleEnvironment(value: string): "sandbox" | "production" | null {
  return value === "sandbox" || value === "production" ? value : null;
}

webhooks.post("/apple/:environment/:projectId", async (c) => {
  const environment = appleEnvironment(c.req.param("environment"));
  if (!environment) {
    return providerHttpError(
      c,
      "apple_environment_invalid",
      "Apple environment must be sandbox or production",
      404,
      false,
    );
  }
  const projectId = c.req.param("projectId");
  if (!/^[1-9][0-9]{0,18}$/.test(projectId)) {
    return providerHttpError(
      c,
      "apple_project_invalid",
      "Apple project identifier is invalid",
      404,
      false,
    );
  }
  const project = await c.env.DB.prepare(`
    SELECT id, COALESCE(is_test, test, 0) AS is_test
    FROM projects WHERE id = ? LIMIT 1
  `)
    .bind(projectId)
    .first<{ id: string | number; is_test: number }>();
  const expectedTestState = environment === "sandbox" ? 1 : 0;
  if (!project || Number(project.is_test) !== expectedTestState) {
    return providerHttpError(
      c,
      "apple_project_not_found",
      "Apple notification target was not found",
      404,
      false,
    );
  }
  let payload: string;
  try {
    payload = await readTextLimited(
      c.req.raw,
      1_048_576,
      "Webhook payload too large",
    );
  } catch {
    return providerHttpError(
      c,
      "webhook_payload_too_large",
      "Webhook payload is limited to 1 MB",
      413,
      false,
    );
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return providerHttpError(
      c,
      "invalid_webhook_payload",
      "Webhook payload must be valid JSON",
      400,
      false,
    );
  }
  const signedPayload =
    typeof body.signedPayload === "string" ? body.signedPayload.trim() : "";
  if (!signedPayload || signedPayload.length > 1_000_000) {
    return providerHttpError(
      c,
      "apple_signed_payload_required",
      "Apple signedPayload is required",
      422,
      false,
    );
  }
  const request = {
    projectId: String(project.id),
    store: "apple" as const,
    environment,
    externalEventId: await sha256Hex(signedPayload),
    payload,
    job: {
      type: "billing.apple.notification" as const,
      projectId: String(project.id),
      signedPayload,
      environment,
    },
  };
  try {
    const result = billingServiceEnabled(c.env)
      ? await ingestProviderEventWithBillingAuthority(c.env, request)
      : await ingestBillingProviderEvent(c.env, request);
    return c.json(
      {
        received: true,
        queued: result.queued,
        duplicate: result.duplicate,
        processed: result.processed,
      },
      result.processed ? 200 : 202,
    );
  } catch (error) {
    return providerTaggedHttpError(
      c,
      error,
      "Apple notification could not be accepted",
    );
  }
});

export default webhooks;
