import { describe, expect, it, vi } from "vitest";
import { EMAIL_SERVICE_INBOUND_NORMALIZE_PATH } from "@superboard/contracts/email";
import { app } from "../index";
import type { Env } from "../types";

function environment(overrides: Partial<Env> = {}): Env {
  return {
    API_DOMAIN: "api.test",
    CORS_ORIGINS_JSON: "[]",
    ...overrides,
  } as Env;
}

function inboundEnvelope() {
  return {
    schema_version: 1,
    provider: "google",
    endpoint_id: "email-primary",
    provider_message_id: "message-1",
    received_at: "2026-08-13T07:00:00.000Z",
    sent_at: null,
    from: { email: "sender@example.test", name: "Sender" },
    to: [{ email: "support@example.test", name: null }],
    cc: [],
    bcc: [],
    subject: "Help",
    body: { text: "Hello", html: null },
    thread: { message_id: "message-1", in_reply_to: null, references: [] },
    attachments: [],
    authenticity: {
      provider_verified: true,
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    },
    metadata: {},
  };
}

describe("native Support gateway", () => {
  it("maps the client root once, normalizes the project header, and preserves the Worker error envelope", async () => {
    let forwarded: Request | undefined;
    const fetch = vi.fn(async (request: Request) => {
      forwarded = request;
      const requestId = request.headers.get("x-request-id");
      return Response.json(
        {
          error: {
            code: "conversation_not_found",
            message: "Conversation was not found",
            retryable: false,
            request_id: requestId,
          },
        },
        { status: 404 },
      );
    });
    const response = await app.request(
      "/api/v1/support-client/conversations?limit=25",
      {
        headers: {
          Authorization: "Bearer application-identity",
          "X-SuperBoard-Project-Id": "12",
          "X-Request-Id": "support-contract-1",
        },
      },
      environment({ SUPPORT_MODULE: { fetch } as unknown as Fetcher }),
    );

    expect(response.status).toBe(404);
    expect(forwarded?.url).toBe(
      "https://support.internal/v1/conversations?limit=25",
    );
    expect(new URL(forwarded!.url).pathname).not.toContain("/v1/v1/");
    expect(forwarded?.headers.get("authorization")).toBe(
      "Bearer application-identity",
    );
    expect(forwarded?.headers.get("x-superboard-project-id")).toBe("12");
    expect(forwarded?.headers.get("x-opengrow-project-id")).toBe("12");
    expect(response.headers.get("x-request-id")).toBe("support-contract-1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "conversation_not_found",
        message: "Conversation was not found",
        retryable: false,
        request_id: "support-contract-1",
      },
    });
  });

  it("forwards only provider signature headers and derives the canonical Twilio URL", async () => {
    let forwarded: Request | undefined;
    const fetch = vi.fn(async (request: Request) => {
      forwarded = request;
      return Response.json({ data: { accepted: true } }, { status: 202 });
    });
    const response = await app.request(
      "https://untrusted-client.test/api/v1/support/providers/twilio/endpoint-1/events?channel=sms",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer must-not-leak",
          "X-SuperBoard-Email-Provider-Verified": "1",
          Cookie: "session=must-not-leak",
          Host: "attacker.test",
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Twilio-Signature": "twilio-signature",
          "X-Shopify-Topic": "must-not-leak",
          "X-Internal-Token": "must-not-leak",
          "X-Project-Id": "must-not-leak",
          "X-SuperBoard-Provider-Url": "https://attacker.test/forged",
          "X-SuperBoard-Inbound-Normalized": "forged",
          "X-Request-Id": "provider-contract-1",
        },
        body: "MessageSid=SM123&Body=Hello",
      },
      environment({ SUPPORT_MODULE: { fetch } as unknown as Fetcher }),
    );

    expect(response.status).toBe(202);
    expect(forwarded?.url).toBe(
      "https://support.internal/public/v1/providers/twilio/endpoint-1/events?channel=sms",
    );
    expect(forwarded?.headers.get("x-twilio-signature")).toBe(
      "twilio-signature",
    );
    expect(forwarded?.headers.get("content-type")).toContain(
      "application/x-www-form-urlencoded",
    );
    expect(forwarded?.headers.get("x-superboard-provider-url")).toBe(
      "https://api.test/api/v1/support/providers/twilio/endpoint-1/events?channel=sms",
    );
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(forwarded?.headers.get("cookie")).toBeNull();
    expect(forwarded?.headers.get("host")).toBeNull();
    expect(forwarded?.headers.get("x-internal-token")).toBeNull();
    expect(forwarded?.headers.get("x-project-id")).toBeNull();
    expect(forwarded?.headers.get("x-shopify-topic")).toBeNull();
    expect(
      forwarded?.headers.get("x-superboard-inbound-normalized"),
    ).toBeNull();
    expect(
      forwarded?.headers.get("x-superboard-email-provider-verified"),
    ).toBeNull();
    await expect(forwarded?.text()).resolves.toBe(
      "MessageSid=SM123&Body=Hello",
    );
  });

  it("bounds provider bodies before invoking Support", async () => {
    const fetch = vi.fn(async () => Response.json({ unexpected: true }));
    const response = await app.request(
      "/api/v1/support/providers/twilio/endpoint-1/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "provider-too-large",
        },
        body: "x".repeat(2 * 1024 * 1024 + 1),
      },
      environment({ SUPPORT_MODULE: { fetch } as unknown as Fetcher }),
    );

    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "body_too_large",
        retryable: false,
        request_id: "provider-too-large",
      },
    });
  });

  it("forwards provider verification challenges on the same native route", async () => {
    let forwarded: Request | undefined;
    const response = await app.request(
      "/api/v1/support/providers/whatsapp_cloud/endpoint-1/events?hub.mode=subscribe&hub.challenge=opaque&hub.verify_token=signed",
      {},
      environment({
        SUPPORT_MODULE: {
          fetch: vi.fn(async (request: Request) => {
            forwarded = request;
            return new Response("opaque");
          }),
        } as unknown as Fetcher,
      }),
    );
    expect(response.status).toBe(200);
    expect(forwarded?.method).toBe("GET");
    expect(forwarded?.url).toBe(
      "https://support.internal/public/v1/providers/whatsapp_cloud/endpoint-1/events?hub.mode=subscribe&hub.challenge=opaque&hub.verify_token=signed",
    );
    expect(forwarded?.headers.get("x-superboard-provider-url")).toBe(
      "https://api.test/api/v1/support/providers/whatsapp_cloud/endpoint-1/events?hub.mode=subscribe&hub.challenge=opaque&hub.verify_token=signed",
    );
  });

  it("normalizes inbound email through Email before delivering the canonical envelope to Support", async () => {
    let emailRequest: Request | undefined;
    let supportRequest: Request | undefined;
    const emailFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        emailRequest = new Request(input, init);
        return Response.json({ data: inboundEnvelope() });
      },
    );
    const supportFetch = vi.fn(async (request: Request) => {
      supportRequest = request;
      return Response.json({ data: { accepted: true } }, { status: 202 });
    });
    const raw = {
      message_id: "message-1",
      from: "Sender <sender@example.test>",
      to: "support@example.test",
      subject: "Help",
      text: "Hello",
    };
    const response = await app.request(
      "/api/v1/support/providers/email_google/email-primary/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer must-not-leak",
          "X-SuperBoard-Email-Provider-Verified": "1",
          "X-Request-Id": "email-contract-1",
        },
        body: JSON.stringify(raw),
      },
      environment({
        EMAIL_SERVICE: { fetch: emailFetch } as unknown as Fetcher,
        EMAIL_INTERNAL_TOKEN: "email-internal-secret",
        SUPPORT_MODULE: { fetch: supportFetch } as unknown as Fetcher,
      }),
    );

    expect(response.status).toBe(202);
    expect(new URL(emailRequest!.url).pathname).toBe(
      EMAIL_SERVICE_INBOUND_NORMALIZE_PATH,
    );
    expect(emailRequest?.headers.get("x-internal-token")).toBe(
      "email-internal-secret",
    );
    expect(emailRequest?.headers.get("x-superboard-email-provider")).toBe(
      "google",
    );
    expect(
      emailRequest?.headers.get("x-superboard-email-provider-verified"),
    ).toBeNull();
    await expect(emailRequest?.json()).resolves.toEqual(raw);
    expect(supportRequest?.url).toBe(
      "https://support.internal/public/v1/providers/email_google/email-primary/events",
    );
    expect(supportRequest?.headers.get("authorization")).toBeNull();
    expect(supportRequest?.headers.get("x-superboard-inbound-normalized")).toBe(
      "email-v1",
    );
    await expect(supportRequest?.json()).resolves.toEqual(inboundEnvelope());
  });

  it("fails closed when the private Email authority rejects its credentials", async () => {
    const supportFetch = vi.fn(async () => Response.json({ unexpected: true }));
    const response = await app.request(
      "/api/v1/support/providers/email_google/email-primary/events",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-Id": "email-auth-failure",
        },
        body: JSON.stringify({ message_id: "message-1" }),
      },
      environment({
        EMAIL_SERVICE: {
          fetch: vi.fn(async () =>
            Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
          ),
        } as unknown as Fetcher,
        EMAIL_INTERNAL_TOKEN: "mismatched-secret",
        SUPPORT_MODULE: { fetch: supportFetch } as unknown as Fetcher,
      }),
    );
    expect(response.status).toBe(503);
    expect(supportFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "email_processing_unavailable",
        retryable: true,
        request_id: "email-auth-failure",
      },
    });
  });

  it.each([
    ["/api/v1/support-widget/conversations", "/public/v1/widget/conversations"],
    [
      "/api/v1/support/help-center/docs/search?q=setup",
      "/public/v1/help-center/docs/search?q=setup",
    ],
    [
      "/api/v1/support/providers/google/oauth/callback?code=opaque&state=signed",
      "/public/v1/providers/google/oauth/callback?code=opaque&state=signed",
    ],
  ])("maps the native public surface %s", async (publicPath, internalPath) => {
    let forwarded: Request | undefined;
    const response = await app.request(
      publicPath,
      {},
      environment({
        SUPPORT_MODULE: {
          fetch: vi.fn(async (request: Request) => {
            forwarded = request;
            return new Response(null, { status: 204 });
          }),
        } as unknown as Fetcher,
      }),
    );
    expect(response.status).toBe(204);
    const target = new URL(forwarded!.url);
    expect(`${target.pathname}${target.search}`).toBe(internalPath);
  });

  it("forwards an integration callback without browser credentials or internal headers", async () => {
    let forwarded: Request | undefined;
    const response = await app.request(
      "/api/v1/support/providers/slack/oauth/callback?code=opaque&state=si1.signed",
      {
        headers: {
          Authorization: "Bearer must-not-leak",
          Cookie: "session=must-not-leak",
          "X-Internal-Token": "must-not-leak",
          "X-Context-Signature": "must-not-leak",
          "X-Request-Id": "integration-oauth-callback-1",
        },
      },
      environment({
        SUPPORT_MODULE: {
          fetch: vi.fn(async (request: Request) => {
            forwarded = request;
            return Response.redirect(
              "https://dashboard.example.test/support/integrations?support_result=success",
              302,
            );
          }),
        } as unknown as Fetcher,
      }),
    );
    expect(response.status).toBe(302);
    expect(forwarded?.url).toBe(
      "https://support.internal/public/v1/providers/slack/oauth/callback?code=opaque&state=si1.signed",
    );
    expect(forwarded?.headers.get("authorization")).toBeNull();
    expect(forwarded?.headers.get("cookie")).toBeNull();
    expect(forwarded?.headers.get("x-internal-token")).toBeNull();
    expect(forwarded?.headers.get("x-context-signature")).toBeNull();
    expect(forwarded?.headers.get("x-request-id")).toBe(
      "integration-oauth-callback-1",
    );
  });

  it("forwards only the public widget authentication contract", async () => {
    let forwarded: Request | undefined;
    const payload = JSON.stringify({ client_conversation_id: "widget-client-1" });
    const response = await app.request(
      "/api/v1/support-widget/conversations?locale=fr-CH",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "widget-create-1",
          "Origin": "https://support.example.test",
          "X-Request-Id": "widget-gateway-1",
          "X-SuperBoard-Project-Id": "project-public-reference",
          "X-SuperBoard-Widget-Key": "widget-public-key",
          "X-SuperBoard-Widget-Visitor": "opaque-client-visitor",
          "X-SuperBoard-Widget-Signature": "a".repeat(64),
          "X-SuperBoard-Widget-Timestamp": "1800000000",
          "Authorization": "Bearer supported-identity-alternative",
          "Cookie": "session=must-not-leak",
          "Host": "attacker.test",
          "X-Internal-Token": "must-not-leak",
          "X-Context-Signature": "must-not-leak",
        },
        body: payload,
      },
      environment({
        SUPPORT_MODULE: {
          fetch: vi.fn(async (request: Request) => {
            forwarded = request;
            return Response.json({ data: { accepted: true } }, { status: 201 });
          }),
        } as unknown as Fetcher,
      }),
    );

    expect(response.status).toBe(201);
    expect(forwarded?.url).toBe(
      "https://support.internal/public/v1/widget/conversations?locale=fr-CH",
    );
    expect(forwarded?.headers.get("authorization")).toBe(
      "Bearer supported-identity-alternative",
    );
    expect(forwarded?.headers.get("idempotency-key")).toBe("widget-create-1");
    expect(forwarded?.headers.get("origin")).toBe(
      "https://support.example.test",
    );
    expect(forwarded?.headers.get("x-superboard-project-id")).toBe(
      "project-public-reference",
    );
    expect(forwarded?.headers.get("x-superboard-widget-key")).toBe(
      "widget-public-key",
    );
    expect(forwarded?.headers.get("x-superboard-widget-visitor")).toBe(
      "opaque-client-visitor",
    );
    expect(forwarded?.headers.get("x-superboard-widget-signature")).toBe(
      "a".repeat(64),
    );
    expect(forwarded?.headers.get("x-superboard-widget-timestamp")).toBe(
      "1800000000",
    );
    expect(forwarded?.headers.get("x-request-id")).toBe("widget-gateway-1");
    expect(forwarded?.headers.get("cookie")).toBeNull();
    expect(forwarded?.headers.get("host")).toBeNull();
    expect(forwarded?.headers.get("x-internal-token")).toBeNull();
    expect(forwarded?.headers.get("x-context-signature")).toBeNull();
    await expect(forwarded?.text()).resolves.toBe(payload);
  });

  it("answers widget preflight with the complete public header contract", async () => {
    const response = await app.request(
      "/api/v1/support-widget/conversations",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://support.example.test",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": [
            "content-type",
            "idempotency-key",
            "x-superboard-project-id",
            "x-superboard-widget-key",
            "x-superboard-widget-visitor",
            "x-superboard-widget-signature",
            "x-superboard-widget-timestamp",
          ].join(","),
        },
      },
      environment(),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://support.example.test",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "POST",
    );
    const allowedHeaders = String(
      response.headers.get("access-control-allow-headers"),
    ).toLowerCase();
    for (const header of [
      "idempotency-key",
      "x-superboard-project-id",
      "x-superboard-widget-key",
      "x-superboard-widget-visitor",
      "x-superboard-widget-signature",
      "x-superboard-widget-timestamp",
    ]) {
      expect(allowedHeaders).toContain(header);
    }
  });
});
