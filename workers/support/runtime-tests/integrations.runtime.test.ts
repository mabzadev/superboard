import {
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredentialPayload,
  encryptCredentialPayload,
} from "../src/secrets";
import { handleSupportQueue } from "../src/webhooks";
import type { SupportQueueJob } from "../src/types";
import {
  completeIntegrationOAuth,
  startIntegrationOAuth,
} from "../src/integration-oauth";

const encryptionKey = "support-runtime-credential-encryption-key";

describe("native Support workflow integrations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("consumes a signed authorization state once and stores only encrypted tokens", async () => {
    const suffix = crypto.randomUUID();
    const integrationId = `oauth-linear-${suffix}`;
    const encrypted = await encryptCredentialPayload(encryptionKey, {
      client_id: "linear-client-id",
      client_secret: "linear-client-secret",
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO support_integrations
        (id, project_id, provider, display_name, status, settings_json)
        VALUES (?, 12, 'linear', ?, 'configuration_required', ?)`)
        .bind(integrationId, `Authorized Linear ${suffix}`, JSON.stringify({
          workflow_action: "create_issue",
          allowed_actions: ["create_issue"],
          team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
        })),
      env.DB.prepare(`INSERT INTO support_integration_credentials
        (integration_id, project_id, encrypted_payload) VALUES (?, 12, ?)`)
        .bind(integrationId, encrypted),
    ]);
    const started = await startIntegrationOAuth(env, {
      projectId: 12,
      integrationId,
      callbackUri: "https://api.example.test/api/v1/support/providers/linear/oauth/callback",
      returnUri: "https://dashboard.example.test/support/integrations",
      actorId: "agent-12",
    });
    const authorization = new URL(started.authorization_url);
    const state = authorization.searchParams.get("state");
    expect(authorization.origin).toBe("https://linear.app");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(state).toMatch(/^si1\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/u);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.url).toBe("https://api.linear.app/oauth/token");
      const form = new URLSearchParams(
        new TextDecoder().decode(await request.clone().arrayBuffer()),
      );
      expect(form.get("code")).toBe("authorization-code");
      expect(form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{64}$/u);
      return Response.json({
        access_token: "linear-access-token",
        refresh_token: "linear-refresh-token",
        token_type: "Bearer",
        scope: "read,write",
        expires_in: 3_600,
      });
    }));
    const callback = new Request(
      `https://support.internal/public/v1/providers/linear/oauth/callback?code=authorization-code&state=${encodeURIComponent(state!)}`,
    );
    const completed = await completeIntegrationOAuth(env, callback, "linear");
    expect(completed.handled).toBe(true);
    if (!completed.handled) throw new Error("authorization callback was not handled");
    expect(completed.response.status).toBe(302);
    expect(completed.response.headers.get("location")).toContain("support_result=success");

    const stored = await env.DB.prepare(`SELECT integration.status,
      credential.encrypted_payload, credential.credential_version
      FROM support_integrations integration
      INNER JOIN support_integration_credentials credential
        ON credential.integration_id = integration.id
      WHERE integration.id = ? AND integration.project_id = 12`)
      .bind(integrationId).first<{
        status: string;
        encrypted_payload: string;
        credential_version: number;
      }>();
    expect(stored).toMatchObject({ status: "validated", credential_version: 2 });
    expect(stored!.encrypted_payload).not.toContain("linear-access-token");
    await expect(decryptCredentialPayload([encryptionKey], stored!.encrypted_payload))
      .resolves.toMatchObject({
        payload: {
          access_token: "linear-access-token",
          refresh_token: "linear-refresh-token",
          authorization_provider: "linear",
        },
      });
    await expect(completeIntegrationOAuth(env, callback, "linear"))
      .rejects.toMatchObject({ code: "support_oauth_state_invalid", status: 422 });
  });

  it("uses only bounded official adapters and suppresses replayed side effects", async () => {
    const suffix = crypto.randomUUID();
    const conversationId = `integration-conversation-${suffix}`;
    await env.DB.prepare(`INSERT INTO conversations
      (id, project_id, external_user_id, client_conversation_id, subject, display_id,
       priority, last_message_preview)
      VALUES (?, 12, ?, ?, 'Payment investigation', 812, 'urgent', 'Customer needs an update')`)
      .bind(conversationId, `integration-user-${suffix}`, `integration-client-${suffix}`).run();

    const integrations = [
      {
        id: `slack-${suffix}`,
        provider: "slack",
        settings: {
          workflow_action: "post_message",
          allowed_actions: ["post_message"],
          channel_id: "C123ABC456",
          message_template: "#{{conversation.display_id}} {{conversation.subject}}",
        },
      },
      {
        id: `linear-${suffix}`,
        provider: "linear",
        settings: {
          workflow_action: "create_issue",
          allowed_actions: ["create_issue"],
          team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
        },
      },
      {
        id: `notion-${suffix}`,
        provider: "notion",
        settings: {
          workflow_action: "update_page_title",
          allowed_actions: ["update_page_title"],
          page_id: "d9824bdc-8445-4327-be8b-5b47500af6ce",
        },
      },
      {
        id: `shopify-${suffix}`,
        provider: "shopify",
        settings: {
          workflow_action: "add_tags",
          allowed_actions: ["add_tags"],
          shop_domain: "support-runtime.myshopify.com",
          resource_id: "gid://shopify/Customer/544365967",
          tags: ["support-urgent", "needs-review"],
        },
      },
    ];
    for (const integration of integrations) {
      const encrypted = await encryptCredentialPayload(encryptionKey, {
        access_token: `token-${integration.provider}`,
      });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO support_integrations
          (id, project_id, provider, display_name, status, settings_json)
          VALUES (?, 12, ?, ?, 'configured', ?)`)
          .bind(integration.id, integration.provider, `Runtime ${integration.provider} ${suffix}`, JSON.stringify(integration.settings)),
        env.DB.prepare(`INSERT INTO support_integration_credentials
          (integration_id, project_id, encrypted_payload) VALUES (?, 12, ?)`)
          .bind(integration.id, encrypted),
      ]);
    }

    const requests: Array<{
      method: string;
      url: string;
      headers: Headers;
      body: Record<string, unknown>;
    }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
        body: await request.clone().json<Record<string, unknown>>(),
      });
      const url = new URL(request.url);
      if (url.hostname === "slack.com") {
        return Response.json({ ok: true, ts: "1730000000.000100" });
      }
      if (url.hostname === "api.linear.app") {
        return Response.json({ data: { issueCreate: { success: true, issue: { id: "linear-issue" } } } });
      }
      if (url.hostname === "api.notion.com") {
        return Response.json({ id: "notion-page" });
      }
      return Response.json({
        data: { tagsAdd: { node: { id: "gid://shopify/Customer/544365967" }, userErrors: [] } },
      });
    }));

    const jobs = integrations.map((integration, index) => ({
      type: "support.workflow.action.v1" as const,
      projectId: 12,
      resourceId: crypto.randomUUID(),
      action: "integration" as const,
      target: integration.id,
      conversationId,
      queueMessageId: `integration-runtime-${index}`,
    }));
    for (const job of jobs) {
      const batch = createMessageBatch("support-test-events", [{
        id: job.queueMessageId,
        timestamp: new Date(),
        attempts: 1,
        body: queueBody(job),
      }]);
      const execution = createExecutionContext();
      await handleSupportQueue(batch, env);
      expect((await getQueueResult(batch, execution)).explicitAcks).toEqual([job.queueMessageId]);
    }

    expect(requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      "POST https://slack.com/api/chat.postMessage",
      "POST https://api.linear.app/graphql",
      "PATCH https://api.notion.com/v1/pages/d9824bdc-8445-4327-be8b-5b47500af6ce",
      "POST https://support-runtime.myshopify.com/admin/api/2026-07/graphql.json",
    ]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer token-slack");
    expect(requests[3].headers.get("x-shopify-access-token")).toBe("token-shopify");
    expect(requests[0].body).toMatchObject({
      channel: "C123ABC456",
      text: "#812 Payment investigation",
      client_msg_id: jobs[0].resourceId,
    });
    expect(requests[1].body).toMatchObject({
      variables: { input: { id: jobs[1].resourceId, teamId: integrations[1].settings.team_id } },
    });
    expect(requests[3].body).toMatchObject({
      variables: {
        id: "gid://shopify/Customer/544365967",
        tags: ["support-urgent", "needs-review"],
      },
    });

    const replay = createMessageBatch("support-test-events", [{
      id: "integration-runtime-replay",
      timestamp: new Date(),
      attempts: 2,
      body: queueBody(jobs[0]),
    }]);
    await handleSupportQueue(replay, env);
    expect((await getQueueResult(replay, createExecutionContext())).explicitAcks)
      .toEqual(["integration-runtime-replay"]);
    expect(requests).toHaveLength(4);

    const rows = await env.DB.prepare(`SELECT status, attempt_count, last_error_code
      FROM support_integration_deliveries WHERE project_id = 12 AND conversation_id = ?
      ORDER BY action_type`).bind(conversationId).all<{
        status: string;
        attempt_count: number;
        last_error_code: string | null;
      }>();
    expect(rows.results).toHaveLength(4);
    expect(rows.results.every((row) => row.status === "completed" && row.attempt_count === 1 && row.last_error_code == null)).toBe(true);
    const states = await env.DB.prepare(`SELECT status FROM support_integrations
      WHERE project_id = 12 AND id IN (?, ?, ?, ?)`)
      .bind(...integrations.map((integration) => integration.id)).all<{ status: string }>();
    expect(states.results.every((row) => row.status === "live_validated")).toBe(true);
  });

  it("classifies transient failures for Queue retry without exposing credentials", async () => {
    const suffix = crypto.randomUUID();
    const integrationId = `retry-integration-${suffix}`;
    const conversationId = `retry-conversation-${suffix}`;
    const encrypted = await encryptCredentialPayload(encryptionKey, { access_token: "never-persist-plain" });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject)
        VALUES (?, 12, ?, ?, 'Retry integration')`)
        .bind(conversationId, `retry-user-${suffix}`, `retry-client-${suffix}`),
      env.DB.prepare(`INSERT INTO support_integrations
        (id, project_id, provider, display_name, status, settings_json)
        VALUES (?, 12, 'slack', ?, 'configured', ?)`)
        .bind(integrationId, `Retry ${suffix}`, JSON.stringify({
          workflow_action: "post_message",
          allowed_actions: ["post_message"],
          channel_id: "C123ABC456",
        })),
      env.DB.prepare(`INSERT INTO support_integration_credentials
        (integration_id, project_id, encrypted_payload) VALUES (?, 12, ?)`)
        .bind(integrationId, encrypted),
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const body: SupportQueueJob = {
      type: "support.workflow.action.v1",
      projectId: 12,
      resourceId: crypto.randomUUID(),
      action: "integration",
      target: integrationId,
      conversationId,
    };
    const batch = createMessageBatch("support-test-events", [{
      id: "integration-retryable",
      timestamp: new Date(),
      attempts: 1,
      body,
    }]);
    await handleSupportQueue(batch, env);
    const result = await getQueueResult(batch, createExecutionContext());
    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toEqual([{ msgId: "integration-retryable" }]);
    await expect(env.DB.prepare(`SELECT delivery.status, delivery.last_error_code,
      integration.status integration_status, credential.encrypted_payload
      FROM support_integration_deliveries delivery
      INNER JOIN support_integrations integration ON integration.id = delivery.integration_id
      INNER JOIN support_integration_credentials credential ON credential.integration_id = integration.id
      WHERE delivery.integration_id = ? AND delivery.idempotency_key = ?`)
      .bind(integrationId, body.resourceId).first()).resolves.toMatchObject({
        status: "failed",
        last_error_code: "integration_unavailable",
        integration_status: "degraded",
        encrypted_payload: expect.not.stringContaining("never-persist-plain"),
      });
  });

  it("refreshes an expired authorization atomically before executing", async () => {
    const suffix = crypto.randomUUID();
    const integrationId = `refresh-integration-${suffix}`;
    const conversationId = `refresh-conversation-${suffix}`;
    const encrypted = await encryptCredentialPayload(encryptionKey, {
      access_token: "expired-access-token",
      refresh_token: "refresh-token",
      client_id: "client-id",
      client_secret: "client-secret",
      expires_at: "2020-01-01T00:00:00.000Z",
    });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO conversations
        (id, project_id, external_user_id, client_conversation_id, subject)
        VALUES (?, 12, ?, ?, 'Refresh integration')`)
        .bind(conversationId, `refresh-user-${suffix}`, `refresh-client-${suffix}`),
      env.DB.prepare(`INSERT INTO support_integrations
        (id, project_id, provider, display_name, status, settings_json)
        VALUES (?, 12, 'linear', ?, 'configured', ?)`)
        .bind(integrationId, `Refresh ${suffix}`, JSON.stringify({
          workflow_action: "create_issue",
          allowed_actions: ["create_issue"],
          team_id: "9cfb482a-81e3-4154-b5b9-2c805e70a02d",
        })),
      env.DB.prepare(`INSERT INTO support_integration_credentials
        (integration_id, project_id, encrypted_payload) VALUES (?, 12, ?)`)
        .bind(integrationId, encrypted),
    ]);
    const authorizations: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      authorizations.push(request.headers.get("authorization"));
      if (request.url.endsWith("/oauth/token")) {
        const form = new URLSearchParams(
          new TextDecoder().decode(await request.clone().arrayBuffer()),
        );
        expect(form.get("grant_type")).toBe("refresh_token");
        return Response.json({
          access_token: "renewed-access-token",
          refresh_token: "renewed-refresh-token",
          expires_in: 86_399,
        });
      }
      return Response.json({
        data: { issueCreate: { success: true, issue: { id: "refreshed-linear-issue" } } },
      });
    }));
    const batch = createMessageBatch("support-test-events", [{
      id: "integration-refresh",
      timestamp: new Date(),
      attempts: 1,
      body: {
        type: "support.workflow.action.v1",
        projectId: 12,
        resourceId: crypto.randomUUID(),
        action: "integration",
        target: integrationId,
        conversationId,
      } satisfies SupportQueueJob,
    }]);
    await handleSupportQueue(batch, env);
    expect((await getQueueResult(batch, createExecutionContext())).explicitAcks)
      .toEqual(["integration-refresh"]);
    expect(authorizations).toEqual([
      `Basic ${btoa("client-id:client-secret")}`,
      "Bearer renewed-access-token",
    ]);
    const stored = await env.DB.prepare(`SELECT encrypted_payload, credential_version
      FROM support_integration_credentials WHERE integration_id = ? AND project_id = 12`)
      .bind(integrationId).first<{ encrypted_payload: string; credential_version: number }>();
    expect(stored?.credential_version).toBe(2);
    const decrypted = await decryptCredentialPayload([encryptionKey], stored!.encrypted_payload);
    expect(decrypted.payload).toMatchObject({
      access_token: "renewed-access-token",
      refresh_token: "renewed-refresh-token",
    });
  });
});

function queueBody(job: {
  projectId: number;
  resourceId: string;
  action: "integration";
  target: string;
  conversationId: string;
}): SupportQueueJob {
  return {
    type: "support.workflow.action.v1",
    projectId: job.projectId,
    resourceId: job.resourceId,
    action: job.action,
    target: job.target,
    conversationId: job.conversationId,
  };
}
