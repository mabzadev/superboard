import { readTextLimited } from "@superboard/contracts/request-body";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "./secrets";
import type { Env } from "./types";

const AUTOMATION_INTEGRATIONS = new Set(["slack", "linear", "notion", "shopify"]);
const ACTIONS_BY_PROVIDER: Record<string, ReadonlySet<string>> = {
  slack: new Set(["post_message"]),
  linear: new Set(["create_issue"]),
  notion: new Set(["update_page_title"]),
  shopify: new Set(["add_tags"]),
};
const NOTION_VERSION = "2026-03-11";
const SHOPIFY_API_VERSION = "2026-07";
const MAX_INTEGRATION_RESPONSE_BYTES = 64_000;
const MAX_TEMPLATE_BYTES = 12_000;

type IntegrationRow = {
  id: string;
  provider: string;
  status: string;
  settings_json: string;
  encrypted_payload: string | null;
  credential_version: number | null;
};

type ConversationContext = {
  id: string;
  display_id: number | null;
  subject: string | null;
  status: string;
  priority: string;
  external_user_id: string;
  last_message_preview: string | null;
  contact_name: string | null;
  contact_email: string | null;
};

type IntegrationExecution = {
  actionType: string;
  response: Response;
  payload: Record<string, unknown>;
  resultReference: string | null;
};

type IntegrationError = Error & {
  code: string;
  status: number;
  responseStatus?: number;
};

export type NativeIntegrationJob = {
  projectId: number;
  integrationId: string;
  conversationId: string;
  idempotencyKey: string;
};

/**
 * Credentials are write-only and may be staged before OAuth completes. Only
 * an actual access token makes one of the native automation adapters runnable.
 */
export function nativeIntegrationCredentialState(
  provider: string,
  credentials: Record<string, unknown>,
) {
  if (!AUTOMATION_INTEGRATIONS.has(provider)) return null;
  const accessToken = boundedSecret(credentials.access_token);
  return {
    configured: accessToken.length > 0,
    credentialFields: Object.keys(credentials).sort(),
  };
}

/**
 * Validates the explicit settings allowlist used by a workflow integration.
 * There is deliberately no generic URL/method escape hatch here.
 */
export function validateNativeIntegrationSettings(
  provider: string,
  settings: Record<string, unknown>,
) {
  if (!AUTOMATION_INTEGRATIONS.has(provider)) {
    throw integrationFailure("configuration_required", "Integration automation is not configured", 422);
  }
  const action = boundedSetting(settings.workflow_action, 64);
  const allowedActions = stringArray(settings.allowed_actions, 20, 64);
  if (!action || !allowedActions.includes(action) || !ACTIONS_BY_PROVIDER[provider]?.has(action)) {
    throw integrationFailure("configuration_required", "Integration automation is not explicitly enabled", 422);
  }

  if (provider === "slack") {
    if (!/^[CDG][A-Z0-9]{2,31}$/u.test(boundedSetting(settings.channel_id, 32))) {
      throw integrationFailure("configuration_required", "Integration destination is not configured", 422);
    }
    optionalTemplate(settings.message_template);
    const thread = boundedSetting(settings.thread_reference, 64);
    if (thread && !/^\d{1,20}\.\d{1,20}$/u.test(thread)) {
      throw integrationFailure("configuration_required", "Integration destination is not configured", 422);
    }
  } else if (provider === "linear") {
    if (!isUuid(boundedSetting(settings.team_id, 64))) {
      throw integrationFailure("configuration_required", "Integration destination is not configured", 422);
    }
    optionalTemplate(settings.title_template);
    optionalTemplate(settings.description_template);
  } else if (provider === "notion") {
    if (!isUuid(boundedSetting(settings.page_id, 64))) {
      throw integrationFailure("configuration_required", "Integration destination is not configured", 422);
    }
    optionalTemplate(settings.title_template);
  } else {
    shopDomain(settings.shop_domain);
    shopifyResourceId(settings.resource_id);
    const tags = stringArray(settings.tags, 20, 255);
    if (tags.length < 1) {
      throw integrationFailure("configuration_required", "Integration tags are not configured", 422);
    }
  }
  return { action };
}

export async function executeNativeIntegration(
  env: Pick<
    Env,
    "DB" | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY" | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS"
  >,
  job: NativeIntegrationJob,
) {
  const integration = await env.DB.prepare(`
    SELECT integration.id, integration.provider, integration.status, integration.settings_json,
      credential.encrypted_payload, credential.credential_version
    FROM support_integrations integration
    LEFT JOIN support_integration_credentials credential
      ON credential.integration_id = integration.id
      AND credential.project_id = integration.project_id
    WHERE integration.id = ? AND integration.project_id = ?
      AND integration.status IN ('configured', 'validated', 'live_validated', 'degraded')
  `).bind(job.integrationId, job.projectId).first<IntegrationRow>();
  if (!integration?.encrypted_payload || integration.credential_version == null) {
    await markIntegrationConfigurationRequired(env.DB, job.projectId, job.integrationId);
    throw integrationFailure("configuration_required", "Integration authorization is incomplete", 422);
  }

  const settings = parseRecord(integration.settings_json);
  let action: string;
  try {
    action = validateNativeIntegrationSettings(integration.provider, settings).action;
  } catch (error) {
    await markIntegrationConfigurationRequired(env.DB, job.projectId, job.integrationId);
    throw error;
  }
  const conversation = await loadConversationContext(env.DB, job.projectId, job.conversationId);
  const delivery = await claimIntegrationDelivery(env.DB, job, action);
  if (delivery === "completed") return { duplicate: true, action };

  let responseStatus: number | null = null;
  try {
    const decrypted = await decryptCredentialPayload([
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
      env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
    ], integration.encrypted_payload);
    let credentials = decrypted.payload;
    if (!nativeIntegrationCredentialState(integration.provider, credentials)?.configured) {
      await markIntegrationConfigurationRequired(env.DB, job.projectId, integration.id);
      throw integrationFailure("configuration_required", "Integration authorization is incomplete", 422);
    }
    credentials = await refreshIntegrationCredentialsIfNeeded(env, {
      projectId: job.projectId,
      integrationId: integration.id,
      provider: integration.provider,
      credentialVersion: integration.credential_version,
      credentials,
    });
    const result = await invokeIntegration({
      provider: integration.provider,
      action,
      settings,
      credentials,
      context: conversation,
      idempotencyKey: job.idempotencyKey,
    });
    responseStatus = result.response.status;
    await env.DB.batch([
      env.DB.prepare(`UPDATE support_integration_deliveries
        SET status = 'completed', response_status = ?, result_reference = ?,
          last_error_code = NULL,
          completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND integration_id = ? AND idempotency_key = ?`)
        .bind(
          result.response.status,
          result.resultReference,
          job.projectId,
          integration.id,
          job.idempotencyKey,
        ),
      env.DB.prepare(`UPDATE support_integrations SET status = 'live_validated',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND status <> 'disabled'`)
        .bind(integration.id, job.projectId),
      env.DB.prepare(`INSERT INTO support_operations_audit_events
        (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
        VALUES (?, ?, 'integration', ?, 'workflow.completed', 'automation', ?)`)
        .bind(
          crypto.randomUUID(),
          job.projectId,
          integration.id,
          JSON.stringify({
            conversation_id: conversation.id,
            action_type: result.actionType,
            idempotency_key: job.idempotencyKey,
          }),
        ),
    ]);
    return { duplicate: false, action: result.actionType };
  } catch (error) {
    const normalized = normalizeIntegrationError(error, responseStatus);
    await env.DB.prepare(`UPDATE support_integration_deliveries
      SET status = 'failed', response_status = COALESCE(?, response_status),
        last_error_code = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND integration_id = ? AND idempotency_key = ?`)
      .bind(
        normalized.responseStatus ?? null,
        normalized.code,
        job.projectId,
        integration.id,
        job.idempotencyKey,
      ).run();
    if (normalized.code === "configuration_required") {
      await markIntegrationConfigurationRequired(env.DB, job.projectId, integration.id);
    } else if (normalized.status === 429 || normalized.status >= 500) {
      await env.DB.prepare(`UPDATE support_integrations SET status = 'degraded',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND project_id = ? AND status <> 'disabled'`)
        .bind(integration.id, job.projectId).run();
    }
    throw normalized;
  }
}

async function claimIntegrationDelivery(
  db: D1Database,
  job: NativeIntegrationJob,
  action: string,
) {
  await db.prepare(`INSERT INTO support_integration_deliveries
    (id, project_id, integration_id, conversation_id, idempotency_key, action_type)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, integration_id, idempotency_key) DO NOTHING`)
    .bind(
      crypto.randomUUID(),
      job.projectId,
      job.integrationId,
      job.conversationId,
      job.idempotencyKey,
      action,
    ).run();
  const claimed = await db.prepare(`UPDATE support_integration_deliveries
    SET status = 'processing', attempt_count = attempt_count + 1,
      started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      last_error_code = NULL,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE project_id = ? AND integration_id = ? AND idempotency_key = ?
      AND (status IN ('queued', 'failed')
        OR (status = 'processing' AND julianday(updated_at) <= julianday('now', '-5 minutes')))
    RETURNING id`)
    .bind(job.projectId, job.integrationId, job.idempotencyKey)
    .first<{ id: string }>();
  if (claimed) return "claimed" as const;
  const existing = await db.prepare(`SELECT status FROM support_integration_deliveries
    WHERE project_id = ? AND integration_id = ? AND idempotency_key = ?`)
    .bind(job.projectId, job.integrationId, job.idempotencyKey)
    .first<{ status: string }>();
  if (existing?.status === "completed") return "completed" as const;
  throw integrationFailure("integration_in_progress", "Integration action is already being processed", 503);
}

async function invokeIntegration(input: {
  provider: string;
  action: string;
  settings: Record<string, unknown>;
  credentials: Record<string, unknown>;
  context: ConversationContext;
  idempotencyKey: string;
}): Promise<IntegrationExecution> {
  const token = requiredAccessToken(input.credentials);
  let request: Request;
  if (input.provider === "slack" && input.action === "post_message") {
    const message = renderTemplate(
      input.settings.message_template,
      "New Support conversation {{conversation.display_id}}: {{conversation.subject}}",
      input.context,
      12_000,
    );
    request = new Request("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: integrationHeaders(token, input.idempotencyKey),
      body: JSON.stringify({
        channel: boundedSetting(input.settings.channel_id, 32),
        text: message,
        client_msg_id: input.idempotencyKey,
        unfurl_links: false,
        unfurl_media: false,
        ...(input.settings.thread_reference
          ? { thread_ts: boundedSetting(input.settings.thread_reference, 64) }
          : {}),
      }),
    });
  } else if (input.provider === "linear" && input.action === "create_issue") {
    const title = renderTemplate(
      input.settings.title_template,
      "Support conversation {{conversation.display_id}}: {{conversation.subject}}",
      input.context,
      255,
    );
    const description = renderTemplate(
      input.settings.description_template,
      "Priority: {{conversation.priority}}\nStatus: {{conversation.status}}\n\n{{conversation.last_message}}",
      input.context,
      8_000,
    );
    request = new Request("https://api.linear.app/graphql", {
      method: "POST",
      headers: integrationHeaders(token, input.idempotencyKey),
      body: JSON.stringify({
        query: `mutation SupportIssueCreate($input: IssueCreateInput!) {
          issueCreate(input: $input) { success issue { id } }
        }`,
        variables: {
          input: {
            id: input.idempotencyKey,
            teamId: boundedSetting(input.settings.team_id, 64),
            title,
            description,
          },
        },
      }),
    });
  } else if (input.provider === "notion" && input.action === "update_page_title") {
    const pageId = boundedSetting(input.settings.page_id, 64);
    const title = renderTemplate(
      input.settings.title_template,
      "Support conversation {{conversation.display_id}}: {{conversation.subject}}",
      input.context,
      2_000,
    );
    const headers = integrationHeaders(token, input.idempotencyKey);
    headers.set("Notion-Version", NOTION_VERSION);
    request = new Request(`https://api.notion.com/v1/pages/${encodeURIComponent(pageId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        properties: {
          title: { title: [{ type: "text", text: { content: title } }] },
        },
      }),
    });
  } else if (input.provider === "shopify" && input.action === "add_tags") {
    const domain = shopDomain(input.settings.shop_domain);
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json",
      "x-shopify-access-token": token,
      "idempotency-key": input.idempotencyKey,
    });
    request = new Request(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `mutation SupportTagsAdd($id: ID!, $tags: [String!]!) {
          tagsAdd(id: $id, tags: $tags) { node { id } userErrors { message } }
        }`,
        variables: {
          id: shopifyResourceId(input.settings.resource_id),
          tags: stringArray(input.settings.tags, 20, 255),
        },
      }),
    });
  } else {
    throw integrationFailure("configuration_required", "Integration automation is not configured", 422);
  }

  let response: Response;
  try {
    response = await fetch(request, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw integrationFailure("integration_unavailable", "Integration is temporarily unavailable", 503);
  }
  const responseText = await readTextLimited(response, MAX_INTEGRATION_RESPONSE_BYTES);
  const payload = parseRecord(responseText);
  if (!response.ok) throw httpIntegrationFailure(response.status);
  const logicalFailure = logicalIntegrationFailure(input.provider, payload);
  if (logicalFailure) throw logicalFailure;
  return {
    actionType: input.action,
    response,
    payload,
    resultReference: integrationResultReference(input.provider, payload),
  };
}

async function refreshIntegrationCredentialsIfNeeded(
  env: Pick<
    Env,
    "DB" | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY" | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS"
  >,
  input: {
    projectId: number;
    integrationId: string;
    provider: string;
    credentialVersion: number;
    credentials: Record<string, unknown>;
  },
) {
  const expiresAt = boundedSetting(input.credentials.expires_at, 64);
  if (!expiresAt) return input.credentials;
  const expiry = Date.parse(expiresAt);
  if (Number.isFinite(expiry) && expiry - Date.now() > 5 * 60_000) return input.credentials;
  const refreshToken = boundedSecret(input.credentials.refresh_token);
  const clientId = boundedSecret(input.credentials.client_id);
  const clientSecret = boundedSecret(input.credentials.client_secret);
  if (!refreshToken || !clientId || !clientSecret) {
    throw integrationFailure("configuration_required", "Integration authorization must be renewed", 422);
  }

  let request: Request;
  if (input.provider === "slack") {
    request = new Request("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } else if (input.provider === "linear") {
    request = new Request("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
  } else if (input.provider === "notion") {
    request = new Request("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
  } else {
    throw integrationFailure("configuration_required", "Integration authorization must be renewed", 422);
  }

  let response: Response;
  try {
    response = await fetch(request, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw integrationFailure("integration_unavailable", "Integration is temporarily unavailable", 503);
  }
  const responseText = await readTextLimited(response, MAX_INTEGRATION_RESPONSE_BYTES);
  const tokenPayload = parseRecord(responseText);
  if (!response.ok || (input.provider === "slack" && tokenPayload.ok === false)) {
    if (response.status === 429 || response.status >= 500) {
      throw integrationFailure("integration_unavailable", "Integration is temporarily unavailable", response.status || 503);
    }
    throw integrationFailure("configuration_required", "Integration authorization must be renewed", 422);
  }
  const accessToken = boundedSecret(tokenPayload.access_token);
  if (!accessToken) {
    throw integrationFailure("configuration_required", "Integration authorization must be renewed", 422);
  }
  const expiresIn = Number(tokenPayload.expires_in || 0);
  const persisted: Record<string, unknown> = {
    ...input.credentials,
    access_token: accessToken,
    refresh_token: boundedSecret(tokenPayload.refresh_token) || refreshToken,
    ...(Number.isFinite(expiresIn) && expiresIn > 0
      ? { expires_at: new Date(Date.now() + expiresIn * 1_000).toISOString() }
      : {}),
  };
  const encrypted = await encryptCredentialPayload(
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    persisted,
  );
  const updated = await env.DB.prepare(`UPDATE support_integration_credentials
    SET encrypted_payload = ?, credential_version = credential_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE integration_id = ? AND project_id = ? AND credential_version = ?`)
    .bind(
      encrypted,
      input.integrationId,
      input.projectId,
      input.credentialVersion,
    ).run();
  if (Number(updated.meta.changes || 0) > 0) return persisted;
  const latest = await env.DB.prepare(`SELECT encrypted_payload
    FROM support_integration_credentials WHERE integration_id = ? AND project_id = ?`)
    .bind(input.integrationId, input.projectId)
    .first<{ encrypted_payload: string }>();
  if (!latest) throw integrationFailure("configuration_required", "Integration authorization is incomplete", 422);
  return (await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], latest.encrypted_payload)).payload;
}

async function loadConversationContext(
  db: D1Database,
  projectId: number,
  conversationId: string,
) {
  const conversation = await db.prepare(`SELECT conversation.id, conversation.display_id,
    conversation.subject, conversation.status, conversation.priority,
    conversation.external_user_id, conversation.last_message_preview,
    contact.name contact_name, contact.email contact_email
    FROM conversations conversation
    LEFT JOIN support_contacts contact
      ON contact.project_id = conversation.project_id
      AND contact.external_user_id = conversation.external_user_id
    WHERE conversation.id = ? AND conversation.project_id = ?`)
    .bind(conversationId, projectId).first<ConversationContext>();
  if (!conversation) {
    throw integrationFailure("conversation_not_found", "Support conversation was not found", 422);
  }
  return conversation;
}

function logicalIntegrationFailure(
  provider: string,
  payload: Record<string, unknown>,
): IntegrationError | null {
  if (provider === "slack" && payload.ok !== true) {
    const transient = new Set([
      "fatal_error", "internal_error", "ratelimited", "request_timeout", "service_unavailable",
    ]).has(String(payload.error || ""));
    return integrationFailure(
      transient ? "integration_unavailable" : "configuration_required",
      transient ? "Integration is temporarily unavailable" : "Integration configuration was rejected",
      transient ? 503 : 422,
    );
  }
  if (provider === "linear") {
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const result = asRecord(asRecord(payload.data).issueCreate);
    if (errors.length || result.success !== true || !asRecord(result.issue).id) {
      const markers = errors.map((entry) => integrationErrorMarker(entry));
      const retryable = markers.some((marker) => [
        "rate", "timeout", "internal", "network", "locktimeout",
      ].some((candidate) => marker.includes(candidate)));
      const authorization = markers.some((marker) => [
        "authentication", "forbidden", "unauthorized",
      ].some((candidate) => marker.includes(candidate)));
      return integrationFailure(
        retryable
          ? "integration_unavailable"
          : authorization ? "configuration_required" : "integration_rejected",
        retryable
          ? "Integration is temporarily unavailable"
          : authorization ? "Integration authorization must be renewed" : "Integration action was rejected",
        retryable ? 503 : 422,
      );
    }
  }
  if (provider === "shopify") {
    const topErrors = Array.isArray(payload.errors) ? payload.errors : [];
    const result = asRecord(asRecord(payload.data).tagsAdd);
    const userErrors = Array.isArray(result.userErrors) ? result.userErrors : [];
    if (topErrors.length || userErrors.length || !asRecord(result.node).id) {
      const markers = topErrors.map((entry) => integrationErrorMarker(entry));
      const retryable = markers.some((marker) => ["throttled", "internal", "timeout"]
        .some((candidate) => marker.includes(candidate)));
      const authorization = markers.some((marker) => ["access_denied", "unauthorized", "forbidden"]
        .some((candidate) => marker.includes(candidate)));
      return integrationFailure(
        retryable
          ? "integration_unavailable"
          : authorization ? "configuration_required" : "integration_rejected",
        retryable
          ? "Integration is temporarily unavailable"
          : authorization ? "Integration authorization must be renewed" : "Integration action was rejected",
        retryable ? 503 : 422,
      );
    }
  }
  if (provider === "notion" && !payload.id) {
    return integrationFailure("integration_rejected", "Integration action was rejected", 422);
  }
  return null;
}

function integrationErrorMarker(value: unknown) {
  const error = asRecord(value);
  const extensions = asRecord(error.extensions);
  return [extensions.code, extensions.type, error.code, error.message]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

function integrationResultReference(provider: string, payload: Record<string, unknown>) {
  let value: unknown;
  if (provider === "slack") value = payload.ts;
  else if (provider === "linear") value = asRecord(asRecord(asRecord(payload.data).issueCreate).issue).id;
  else if (provider === "notion") value = payload.id;
  else value = asRecord(asRecord(asRecord(payload.data).tagsAdd).node).id;
  return value == null ? null : String(value).slice(0, 255);
}

function integrationHeaders(accessToken: string, idempotencyKey: string) {
  return new Headers({
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    accept: "application/json",
    "idempotency-key": idempotencyKey,
  });
}

function renderTemplate(
  value: unknown,
  fallback: string,
  context: ConversationContext,
  maxLength: number,
) {
  const template = boundedSetting(value, MAX_TEMPLATE_BYTES) || fallback;
  const replacements: Record<string, string> = {
    "conversation.id": context.id,
    "conversation.display_id": context.display_id == null ? context.id : String(context.display_id),
    "conversation.subject": context.subject || "Support request",
    "conversation.status": context.status,
    "conversation.priority": context.priority,
    "conversation.external_user_id": context.external_user_id,
    "conversation.last_message": context.last_message_preview || "",
    "contact.name": context.contact_name || "",
    "contact.email": context.contact_email || "",
  };
  const rendered = template.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/gu, (match, name: string) => (
    Object.hasOwn(replacements, name) ? replacements[name] : match
  )).trim();
  if (!rendered) throw integrationFailure("configuration_required", "Integration template is empty", 422);
  return rendered.slice(0, maxLength);
}

function optionalTemplate(value: unknown) {
  if (value == null || value === "") return;
  const template = boundedSetting(value, MAX_TEMPLATE_BYTES);
  if (!template) throw integrationFailure("configuration_required", "Integration template is invalid", 422);
  const unknown = [...template.matchAll(/\{\{\s*([^}]+)\s*\}\}/gu)]
    .map((match) => String(match[1]).trim())
    .find((name) => !new Set([
      "conversation.id", "conversation.display_id", "conversation.subject", "conversation.status",
      "conversation.priority", "conversation.external_user_id", "conversation.last_message",
      "contact.name", "contact.email",
    ]).has(name));
  if (unknown) throw integrationFailure("configuration_required", "Integration template contains an unsupported variable", 422);
}

function normalizeIntegrationError(error: unknown, responseStatus: number | null) {
  if (isIntegrationError(error)) {
    if (responseStatus != null && error.responseStatus == null) error.responseStatus = responseStatus;
    return error;
  }
  return integrationFailure("integration_unavailable", "Integration is temporarily unavailable", 503);
}

function httpIntegrationFailure(status: number) {
  if (status === 401 || status === 403) {
    const error = integrationFailure("configuration_required", "Integration authorization must be renewed", 422);
    error.responseStatus = status;
    return error;
  }
  if (status === 429 || status >= 500) {
    const error = integrationFailure("integration_unavailable", "Integration is temporarily unavailable", status);
    error.responseStatus = status;
    return error;
  }
  const error = integrationFailure("integration_rejected", "Integration action was rejected", 422);
  error.responseStatus = status;
  return error;
}

async function markIntegrationConfigurationRequired(
  db: D1Database,
  projectId: number,
  integrationId: string,
) {
  await db.prepare(`UPDATE support_integrations SET status = 'configuration_required',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ? AND project_id = ? AND status <> 'disabled'`)
    .bind(integrationId, projectId).run();
}

function requiredAccessToken(credentials: Record<string, unknown>) {
  const token = boundedSecret(credentials.access_token);
  if (!token) throw integrationFailure("configuration_required", "Integration authorization is incomplete", 422);
  return token;
}

function boundedSecret(value: unknown) {
  return typeof value === "string" && value.trim().length <= 16_384 ? value.trim() : "";
}

function boundedSetting(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length <= max ? value.trim() : "";
}

function stringArray(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  const resolved = value.map((item) => boundedSetting(item, maxLength));
  return resolved.every(Boolean) ? [...new Set(resolved)] : [];
}

function shopDomain(value: unknown) {
  const domain = boundedSetting(value, 253).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/u.test(domain)) {
    throw integrationFailure("configuration_required", "Integration shop domain is invalid", 422);
  }
  return domain;
}

function shopifyResourceId(value: unknown) {
  const id = boundedSetting(value, 255);
  if (!/^gid:\/\/shopify\/(?:Order|DraftOrder|Customer|Product|Article|DiscountNode)\/[A-Za-z0-9_-]{1,128}$/u.test(id)) {
    throw integrationFailure("configuration_required", "Integration resource is invalid", 422);
  }
  return id;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isIntegrationError(value: unknown): value is IntegrationError {
  return value instanceof Error
    && typeof (value as Partial<IntegrationError>).code === "string"
    && typeof (value as Partial<IntegrationError>).status === "number";
}

function integrationFailure(code: string, message: string, status: number): IntegrationError {
  return Object.assign(new Error(message), { code, status });
}
