import { readTextLimited } from "@superboard/contracts/request-body";
import { isSafePublicHttpsUrl } from "@superboard/contracts/url-security";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "./secrets";
import type { Env } from "./types";

const AUTHORIZATION_PROVIDERS = new Set(["slack", "linear", "notion", "shopify"]);
const STATE_PREFIX = "si1";
const STATE_TTL_SECONDS = 600;
const MAX_OAUTH_RESPONSE_BYTES = 64_000;

type IntegrationOAuthEnv = Pick<
  Env,
  | "DB"
  | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY"
  | "SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS"
>;

type StartInput = {
  projectId: number;
  integrationId: string;
  callbackUri: string;
  returnUri: string;
  actorId: string;
};

export type IntegrationOAuthCallbackResult =
  | { handled: false }
  | { handled: true; response: Response };

export async function startIntegrationOAuth(env: IntegrationOAuthEnv, input: StartInput) {
  const callbackUri = boundedPublicHttpsUrl(input.callbackUri, "callback");
  const returnUri = boundedPublicHttpsUrl(input.returnUri, "return");
  const integration = await env.DB.prepare(`
    SELECT integration.provider, integration.settings_json,
      credential.encrypted_payload, credential.credential_version
    FROM support_integrations integration
    LEFT JOIN support_integration_credentials credential
      ON credential.integration_id = integration.id
      AND credential.project_id = integration.project_id
    WHERE integration.id = ? AND integration.project_id = ?
      AND integration.status != 'disabled'
  `).bind(input.integrationId, input.projectId).first<{
    provider: string;
    settings_json: string;
    encrypted_payload: string | null;
    credential_version: number | null;
  }>();
  if (!integration) {
    throw failure("support_integration_not_found", "Support integration not found", 404);
  }
  const provider = integrationProvider(integration.provider);
  const callback = new URL(callbackUri);
  if (callback.pathname !== `/api/v1/support/providers/${provider}/oauth/callback`) {
    throw failure(
      "support_oauth_uri_invalid",
      "OAuth callback URL does not match the Support integration route",
      422,
    );
  }
  if (!integration.encrypted_payload || integration.credential_version == null) {
    throw failure("configuration_required", "Integration client credentials are required", 422);
  }
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], integration.encrypted_payload);
  const credentials = decrypted.payload;
  const clientId = boundedSecret(credentials.client_id, 1, 4_096);
  const clientSecret = boundedSecret(credentials.client_secret, 1, 8_192);
  if (!clientId || !clientSecret) {
    throw failure("configuration_required", "Integration client credentials are incomplete", 422);
  }
  const settings = parseRecord(integration.settings_json);
  const adapter = authorizationAdapter(provider, settings, credentials);
  const nonce = randomToken(32);
  const signature = await signState(env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY, nonce);
  const state = `${STATE_PREFIX}.${nonce}.${signature}`;
  const verifier = adapter.pkce ? randomToken(48) : null;
  const verifierEncrypted = verifier
    ? await encryptCredentialPayload(env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY, { verifier })
    : null;
  const stateId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM support_integration_oauth_states
      WHERE julianday(expires_at) <= julianday('now', '-1 day')`).bind(),
    env.DB.prepare(`INSERT INTO support_integration_oauth_states
      (id, project_id, integration_id, provider, credential_version,
       state_hash, verifier_encrypted, callback_uri, redirect_uri,
       expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+10 minutes'), ?)`)
      .bind(
        stateId,
        input.projectId,
        input.integrationId,
        provider,
        integration.credential_version,
        await sha256(state),
        verifierEncrypted,
        callbackUri,
        returnUri,
        boundedActor(input.actorId),
      ),
  ]);

  const authorization = new URL(adapter.authorizationUrl);
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", callbackUri);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("state", state);
  if (adapter.scope) authorization.searchParams.set("scope", adapter.scope);
  if (verifier) {
    authorization.searchParams.set("code_challenge", await sha256Base64Url(verifier));
    authorization.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(adapter.extra)) {
    authorization.searchParams.set(key, value);
  }
  return { authorization_url: authorization.toString(), expires_in: STATE_TTL_SECONDS };
}

export async function completeIntegrationOAuth(
  env: IntegrationOAuthEnv,
  request: Request,
  providerInput: string,
): Promise<IntegrationOAuthCallbackResult> {
  const url = new URL(request.url);
  const state = String(url.searchParams.get("state") || "");
  if (!state.startsWith(`${STATE_PREFIX}.`)) return { handled: false };
  if (state.length > 512 || !(await verifyState([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], state))) {
    throw failure("support_oauth_state_invalid", "OAuth state is invalid", 422);
  }
  const provider = integrationProvider(providerInput);
  const record = await env.DB.prepare(`
    UPDATE support_integration_oauth_states
    SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL
      AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    RETURNING id, project_id, integration_id, credential_version,
      verifier_encrypted, callback_uri, redirect_uri
  `).bind(await sha256(state), provider).first<{
    id: string;
    project_id: number;
    integration_id: string;
    credential_version: number;
    verifier_encrypted: string | null;
    callback_uri: string;
    redirect_uri: string;
  }>();
  if (!record) {
    throw failure("support_oauth_state_invalid", "OAuth state is invalid or expired", 422);
  }

  const authorizationError = boundedQuery(url.searchParams.get("error"), 255);
  const code = boundedQuery(url.searchParams.get("code"), 4_096);
  if (authorizationError || !code) {
    await markAuthorizationRequired(
      env.DB,
      record.project_id,
      record.integration_id,
      "oauth_authorization_failed",
    );
    return {
      handled: true,
      response: redirectResult(record.redirect_uri, "error", "authorization_failed"),
    };
  }

  try {
    await exchangeAuthorizationCode(env, {
      ...record,
      provider,
      code,
      callbackUrl: url,
    });
    return {
      handled: true,
      response: redirectResult(record.redirect_uri, "success", "authorized"),
    };
  } catch {
    await markAuthorizationRequired(
      env.DB,
      record.project_id,
      record.integration_id,
      "oauth_token_exchange_failed",
    );
    return {
      handled: true,
      response: redirectResult(record.redirect_uri, "error", "authorization_failed"),
    };
  }
}

async function exchangeAuthorizationCode(
  env: IntegrationOAuthEnv,
  input: {
    project_id: number;
    integration_id: string;
    credential_version: number;
    verifier_encrypted: string | null;
    callback_uri: string;
    provider: string;
    code: string;
    callbackUrl: URL;
  },
) {
  const integration = await env.DB.prepare(`
    SELECT integration.settings_json, credential.encrypted_payload
    FROM support_integrations integration
    INNER JOIN support_integration_credentials credential
      ON credential.integration_id = integration.id
      AND credential.project_id = integration.project_id
      AND credential.credential_version = ?
    WHERE integration.id = ? AND integration.project_id = ?
      AND integration.provider = ? AND integration.status != 'disabled'
  `).bind(
    input.credential_version,
    input.integration_id,
    input.project_id,
    input.provider,
  ).first<{ settings_json: string; encrypted_payload: string }>();
  if (!integration) {
    throw failure("configuration_required", "Integration authorization must be restarted", 422);
  }
  const decrypted = await decryptCredentialPayload([
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
  ], integration.encrypted_payload);
  const credentials = decrypted.payload;
  const verifier = input.verifier_encrypted
    ? boundedSecret((await decryptCredentialPayload([
        env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
        env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS,
      ], input.verifier_encrypted)).payload.verifier, 43, 128)
    : "";
  const settings = parseRecord(integration.settings_json);
  if (input.provider === "shopify") {
    const configuredShop = shopDomain(settings.shop_domain || credentials.shop_domain);
    if (!configuredShop || input.callbackUrl.searchParams.get("shop")?.toLowerCase() !== configuredShop) {
      throw failure("support_oauth_callback_invalid", "OAuth callback does not match the configured shop", 401);
    }
    await verifyShopifyCallback(input.callbackUrl.searchParams, credentials.client_secret);
  }
  const request = tokenExchangeRequest(
    input.provider,
    settings,
    credentials,
    input.code,
    input.callback_uri,
    verifier,
  );
  let response: Response;
  try {
    response = await fetch(request, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw failure("oauth_token_exchange_failed", "Authorization could not be completed", 503);
  }
  const responseText = await readTextLimited(response, MAX_OAUTH_RESPONSE_BYTES);
  const token = parseRecord(responseText);
  if (!response.ok || token.ok === false) {
    throw failure("oauth_token_exchange_failed", "Authorization could not be completed", 422);
  }
  const accessToken = boundedSecret(token.access_token, 1, 16_384);
  if (!accessToken) {
    throw failure("oauth_token_exchange_failed", "Authorization could not be completed", 422);
  }
  const refreshToken = boundedSecret(token.refresh_token, 1, 16_384);
  const expiresIn = Number(token.expires_in || 0);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 && expiresIn <= 31_536_000
    ? new Date(Date.now() + expiresIn * 1_000).toISOString()
    : undefined;
  const authorizedAt = new Date().toISOString();
  const persisted: Record<string, unknown> = {
    ...credentials,
    access_token: accessToken,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(boundedTokenMetadata(token.token_type, 64) ? { token_type: boundedTokenMetadata(token.token_type, 64) } : {}),
    ...(boundedTokenMetadata(token.scope, 4_096) ? { scope: boundedTokenMetadata(token.scope, 4_096) } : {}),
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    authorization_provider: input.provider,
    authorized_at: authorizedAt,
    ...providerMetadata(input.provider, token),
  };
  const encrypted = await encryptCredentialPayload(
    env.SUPPORT_CREDENTIAL_ENCRYPTION_KEY,
    persisted,
  );
  const updated = await env.DB.prepare(`UPDATE support_integration_credentials
    SET encrypted_payload = ?, credential_version = credential_version + 1,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE integration_id = ? AND project_id = ? AND credential_version = ?`)
    .bind(encrypted, input.integration_id, input.project_id, input.credential_version)
    .run();
  if (Number(updated.meta.changes || 0) !== 1) {
    throw failure("configuration_required", "Integration authorization must be restarted", 422);
  }
  await env.DB.batch([
    env.DB.prepare(`UPDATE support_integrations SET status = 'validated',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ? AND status != 'disabled'`)
      .bind(input.integration_id, input.project_id),
    env.DB.prepare(`INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
      VALUES (?, ?, 'integrations', ?, 'oauth.authorized', 'system', ?)`)
      .bind(
        crypto.randomUUID(),
        input.project_id,
        input.integration_id,
        JSON.stringify({
          provider: input.provider,
          expires_at: expiresAt || null,
          scope: boundedTokenMetadata(token.scope, 4_096) || null,
        }),
      ),
  ]);
}

function authorizationAdapter(
  provider: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
) {
  const shop = shopDomain(settings.shop_domain || credentials.shop_domain);
  const adapters: Record<string, {
    authorizationUrl: string;
    scope: string;
    pkce: boolean;
    extra: Record<string, string>;
  }> = {
    slack: {
      authorizationUrl: "https://slack.com/oauth/v2/authorize",
      scope: "chat:write,channels:read,users:read",
      pkce: false,
      extra: {},
    },
    linear: {
      authorizationUrl: "https://linear.app/oauth/authorize",
      scope: "read,write",
      pkce: true,
      extra: { prompt: "consent" },
    },
    notion: {
      authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
      scope: "",
      pkce: false,
      extra: { owner: "user" },
    },
    shopify: {
      authorizationUrl: shop ? `https://${shop}/admin/oauth/authorize` : "",
      scope: "read_customers,write_customers,read_orders",
      pkce: false,
      extra: {},
    },
  };
  const adapter = adapters[provider];
  if (!adapter?.authorizationUrl) {
    throw failure("configuration_required", "Integration authorization is not configured", 422);
  }
  return adapter;
}

function tokenExchangeRequest(
  provider: string,
  settings: Record<string, unknown>,
  credentials: Record<string, unknown>,
  code: string,
  callbackUri: string,
  verifier: string,
) {
  const clientId = boundedSecret(credentials.client_id, 1, 4_096);
  const clientSecret = boundedSecret(credentials.client_secret, 1, 8_192);
  if (!clientId || !clientSecret) {
    throw failure("configuration_required", "Integration client credentials are incomplete", 422);
  }
  if (provider === "notion") {
    return new Request("https://api.notion.com/v1/oauth/token", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUri,
      }),
    });
  }
  if (provider === "shopify") {
    const shop = shopDomain(settings.shop_domain || credentials.shop_domain);
    if (!shop) throw failure("configuration_required", "Shop domain is required", 422);
    return new Request(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
  }
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUri,
    client_id: clientId,
    client_secret: clientSecret,
    ...(verifier ? { code_verifier: verifier } : {}),
  });
  const tokenUrl = provider === "slack"
    ? "https://slack.com/api/oauth.v2.access"
    : "https://api.linear.app/oauth/token";
  return new Request(tokenUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

async function verifyShopifyCallback(params: URLSearchParams, secretInput: unknown) {
  const supplied = boundedQuery(params.get("hmac"), 256).toLowerCase();
  const secret = boundedSecret(secretInput, 1, 8_192);
  if (!supplied || !/^[a-f0-9]{64}$/u.test(supplied) || !secret) {
    throw failure("support_oauth_callback_invalid", "OAuth callback signature is invalid", 401);
  }
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    hexBytes(supplied),
    new TextEncoder().encode(message),
  );
  if (!valid) {
    throw failure("support_oauth_callback_invalid", "OAuth callback signature is invalid", 401);
  }
}

async function markAuthorizationRequired(
  db: D1Database,
  projectId: number,
  integrationId: string,
  errorCode: string,
) {
  await db.batch([
    db.prepare(`UPDATE support_integrations SET status = 'configuration_required',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND project_id = ? AND status != 'disabled'`)
      .bind(integrationId, projectId),
    db.prepare(`INSERT INTO support_operations_audit_events
      (id, project_id, resource_type, resource_id, action, actor_id, payload_json)
      VALUES (?, ?, 'integrations', ?, 'oauth.failed', 'system', ?)`)
      .bind(
        crypto.randomUUID(),
        projectId,
        integrationId,
        JSON.stringify({ code: errorCode }),
      ),
  ]);
}

function integrationProvider(value: string) {
  const provider = String(value || "").trim().toLowerCase();
  if (!AUTHORIZATION_PROVIDERS.has(provider)) {
    throw failure("support_integration_unsupported", "Support integration is not supported", 404);
  }
  return provider;
}

function boundedPublicHttpsUrl(value: string, name: string) {
  const trimmed = String(value || "").trim();
  if (trimmed.length > 2_048 || !isSafePublicHttpsUrl(trimmed)) {
    throw failure("support_oauth_uri_invalid", `OAuth ${name} URL must be a public HTTPS URL`, 422);
  }
  const url = new URL(trimmed);
  if (url.hash || url.username || url.password) {
    throw failure("support_oauth_uri_invalid", `OAuth ${name} URL must be a public HTTPS URL`, 422);
  }
  return url.toString();
}

function redirectResult(redirect: string, result: string, code: string) {
  const target = new URL(boundedPublicHttpsUrl(redirect, "return"));
  target.searchParams.set("support_result", result);
  target.searchParams.set("support_code", code);
  return Response.redirect(target.toString(), 302);
}

function shopDomain(value: unknown) {
  const domain = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(domain) ? domain : "";
}

function providerMetadata(provider: string, token: Record<string, unknown>) {
  if (provider === "slack") {
    const team = record(token.team);
    return {
      ...(boundedTokenMetadata(team.id, 255) ? { workspace_id: boundedTokenMetadata(team.id, 255) } : {}),
      ...(boundedTokenMetadata(token.bot_user_id, 255) ? { bot_user_id: boundedTokenMetadata(token.bot_user_id, 255) } : {}),
    };
  }
  if (provider === "notion") {
    return {
      ...(boundedTokenMetadata(token.workspace_id, 255) ? { workspace_id: boundedTokenMetadata(token.workspace_id, 255) } : {}),
      ...(boundedTokenMetadata(token.bot_id, 255) ? { bot_id: boundedTokenMetadata(token.bot_id, 255) } : {}),
    };
  }
  return {};
}

function boundedTokenMetadata(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value.trim()
    : "";
}

function boundedSecret(value: unknown, minimum: number, maximum: number) {
  const result = typeof value === "string" ? value.trim() : "";
  return result.length >= minimum && result.length <= maximum ? result : "";
}

function boundedQuery(value: string | null, maximum: number) {
  return value && value.length <= maximum ? value : "";
}

function boundedActor(value: string) {
  const actor = String(value || "").trim();
  if (!actor || actor.length > 255) {
    throw failure("support_actor_invalid", "A signed Support actor is required", 401);
  }
  return actor;
}

function parseRecord(value: string) {
  try {
    return record(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function randomToken(length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64Url(bytes);
}

async function signState(secret: string, nonce: string) {
  const key = await stateKey(secret, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${STATE_PREFIX}.${nonce}`),
  ));
  return base64Url(signature);
}

async function verifyState(secrets: Array<string | undefined>, state: string) {
  const [prefix, nonce, signature, extra] = state.split(".");
  if (prefix !== STATE_PREFIX || !nonce || !signature || extra ||
    !/^[A-Za-z0-9_-]{43}$/u.test(nonce) || !/^[A-Za-z0-9_-]{43}$/u.test(signature)) {
    return false;
  }
  const candidates = secrets.filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    throw failure("support_credentials_unavailable", "Support credential encryption is not configured", 503);
  }
  for (const secret of candidates) {
    try {
      const key = await stateKey(secret, ["verify"]);
      if (await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlBytes(signature),
        new TextEncoder().encode(`${prefix}.${nonce}`),
      )) return true;
    } catch {
      // Rotation candidates are deliberately indistinguishable to callers.
    }
  }
  return false;
}

async function stateKey(secret: string, usages: Array<"sign" | "verify">) {
  if (!secret) {
    throw failure("support_credentials_unavailable", "Support credential encryption is not configured", 503);
  }
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`support-integration-oauth:${secret}`),
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function sha256(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Base64Url(value: string) {
  return base64Url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  )));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function base64UrlBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function hexBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function failure(code: string, message: string, status: number) {
  return Object.assign(new Error(message), { code, status });
}
