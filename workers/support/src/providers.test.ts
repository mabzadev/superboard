import { afterEach, describe, expect, it, vi } from "vitest";
import providers, { normalizeProviderEvent } from "./providers";
import { decryptCredentialPayload, encryptCredentialPayload } from "./secrets";
import type { Env } from "./types";
import {
  normalizeInboundProviderEvent,
  normalizeProviderDeliveryReceipts,
  outboundProviderRequest,
  providerOAuthRefreshRequest,
  providerOutboundValidatesLive,
  providerResponseFailure,
  refreshProviderCredentialsIfNeeded,
} from "./webhooks";

afterEach(() => {
  vi.unstubAllGlobals();
});

function hmacHex(secret: string, body: string) {
  return crypto.subtle
    .importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    )
    .then((key) => crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))
    .then((value) => [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join(""));
}

async function testEnv() {
  const encrypted = await encryptCredentialPayload("credentials-key", {
    app_secret: "provider-secret",
    verify_token: "verify-me",
  });
  const sent: unknown[] = [];
  const statements: Array<{ query: string; values: unknown[] }> = [];
  const db = {
    prepare: (query: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          if (query.includes("FROM support_provider_endpoints endpoint")) {
            return {
              id: "endpoint-1",
              project_id: 12,
              status: "configured",
              encrypted_payload: encrypted,
            };
          }
          if (query.includes("INSERT INTO support_provider_events")) return { id: "event-1" };
          return null;
        },
        run: async () => {
          statements.push({ query, values });
          return { success: true, meta: { changes: 1 }, values };
        },
      }),
    }),
  } as unknown as D1Database;
  return {
    env: {
      DB: db,
      SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "credentials-key",
      SUPPORT_QUEUE: { send: async (value: unknown) => { sent.push(value); } },
    } as unknown as Env,
    sent,
    statements,
  };
}

describe("Support provider ingress", () => {
  it("verifies a native Meta signature before persisting and enqueueing", async () => {
    const { env, sent, statements } = await testEnv();
    const body = JSON.stringify({ id: "provider-event-1", type: "message" });
    const response = await providers.fetch(new Request(
      "https://support.internal/whatsapp_cloud/endpoint-1/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${await hmacHex("provider-secret", body)}`,
        },
        body,
      },
    ), env);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: true, duplicate: false, event_id: "provider-event-1" },
    });
    expect(sent).toEqual([
      expect.objectContaining({
        type: "support.provider.event.received.v1",
        projectId: 12,
        endpointId: "endpoint-1",
      }),
    ]);
    expect(statements.some(({ query }) => query.includes("'live_validated'"))).toBe(true);
  });

  it("rejects an invalid signature without enqueueing", async () => {
    const { env, sent } = await testEnv();
    const response = await providers.fetch(new Request(
      "https://support.internal/whatsapp_cloud/endpoint-1/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": "sha256=invalid",
        },
        body: "{}",
      },
    ), env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "support_provider_signature_invalid", retryable: false },
    });
    expect(sent).toEqual([]);
  });

  it("accepts the canonical Email envelope and deduplicates by provider message id", async () => {
    const { env, sent } = await testEnv();
    const response = await providers.fetch(new Request(
      "https://support.internal/email_google/endpoint-1/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-superboard-inbound-normalized": "email-v1",
        },
        body: JSON.stringify({
          schema_version: 1,
          provider: "google",
          endpoint_id: "endpoint-1",
          provider_message_id: "mail-provider-1",
          received_at: "2026-08-13T10:00:00.000Z",
          sent_at: "2026-08-13T09:59:00.000Z",
          from: { email: "customer@example.test", name: "Customer" },
          to: [{ email: "help@example.test", name: null }],
          cc: [],
          bcc: [],
          subject: "Need help",
          body: { text: "Please help", html: null },
          thread: { message_id: "mail-provider-1", in_reply_to: null, references: [] },
          attachments: [],
          authenticity: {
            provider_verified: false,
            spf: "pass",
            dkim: "pass",
            dmarc: "pass",
          },
          metadata: {},
        }),
      },
    ), env);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      data: { accepted: true, duplicate: false, event_id: "mail-provider-1" },
    });
    expect(sent).toEqual([
      expect.objectContaining({
        type: "support.provider.event.received.v1",
        provider: "email_google",
      }),
    ]);
  });

  it("rejects raw Email payloads before persistence", async () => {
    const { env, sent } = await testEnv();
    const response = await providers.fetch(new Request(
      "https://support.internal/email_google/endpoint-1/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "raw-provider-event" }),
      },
    ), env);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "support_provider_payload_not_normalized" },
    });
    expect(sent).toEqual([]);
  });
});

describe("Support provider normalization", () => {
  it("uses message and acknowledgement identities instead of the shared Meta page id", () => {
    const delivered = normalizeProviderEvent("whatsapp_cloud", {
      entry: [{ id: "shared-page", changes: [{ value: {
        statuses: [{ id: "wamid.outbound", status: "delivered" }],
      } }] }],
    }, {});
    const read = normalizeProviderEvent("whatsapp_cloud", {
      entry: [{ id: "shared-page", changes: [{ value: {
        statuses: [{ id: "wamid.outbound", status: "read" }],
      } }] }],
    }, {});
    const inbound = normalizeProviderEvent("whatsapp_cloud", {
      entry: [{ id: "shared-page", changes: [{ value: {
        messages: [{ id: "wamid.inbound" }],
      } }] }],
    }, {});
    expect(delivered).toMatchObject({
      eventId: "status:wamid.outbound:delivered",
      type: "delivery.updated",
    });
    expect(read).toMatchObject({
      eventId: "status:wamid.outbound:read",
      type: "delivery.updated",
    });
    expect(inbound).toMatchObject({
      eventId: "message:wamid.inbound",
      type: "message.created",
    });
  });

  it("maps the canonical Email envelope without serializing object values", () => {
    expect(normalizeInboundProviderEvent("email_google", {
      provider_message_id: "mail-provider-1",
      from: { email: "customer@example.test", name: "Customer" },
      subject: "Need help",
      body: { text: "Please help", html: null },
      thread: { message_id: "mail-provider-1", in_reply_to: null },
      attachments: [],
      authenticity: { spf: "pass", dkim: "pass", dmarc: "pass" },
    })).toMatchObject({
      externalUserId: "customer@example.test",
      senderEmail: "customer@example.test",
      senderName: "Customer",
      messageId: "mail-provider-1",
      messageBody: "Please help",
      contentType: "text",
    });
  });

  it("normalizes WhatsApp messages and delivery acknowledgements independently", () => {
    const messagePayload = {
      entry: [{ changes: [{ value: {
        contacts: [{ wa_id: "41790000000", profile: { name: "Customer" } }],
        messages: [{ id: "wamid.inbound", from: "41790000000", text: { body: "Need help" } }],
      } }] }],
    };
    expect(normalizeInboundProviderEvent("whatsapp_cloud", messagePayload)).toMatchObject({
      externalUserId: "41790000000",
      messageId: "wamid.inbound",
      messageBody: "Need help",
      senderName: "Customer",
    });

    const statusPayload = {
      entry: [{ changes: [{ value: { statuses: [
        { id: "wamid.outbound", status: "delivered" },
        { id: "wamid.failed", status: "failed", errors: [{ code: 131026 }] },
      ] } }] }],
    };
    expect(normalizeProviderDeliveryReceipts("whatsapp_cloud", statusPayload)).toEqual([
      { providerReference: "wamid.outbound", status: "delivered" },
      { providerReference: "wamid.failed", status: "failed", reasonCode: "131026" },
    ]);
    expect(normalizeInboundProviderEvent("whatsapp_cloud", statusPayload).messageBody).toBeNull();
  });

  it("normalizes Twilio delivery failures without creating inbound messages", () => {
    const payload = {
      MessageSid: "SM0001",
      MessageStatus: "undelivered",
      ErrorCode: "30003",
    };
    expect(normalizeProviderDeliveryReceipts("twilio_sms", payload)).toEqual([
      { providerReference: "SM0001", status: "failed", reasonCode: "30003" },
    ]);
    expect(normalizeInboundProviderEvent("twilio_sms", payload).messageBody).toBeNull();
    expect(normalizeProviderDeliveryReceipts("twilio_voice", {
      CallSid: "CA0001",
      CallStatus: "no-answer",
    })).toEqual([{ providerReference: "CA0001", status: "failed" }]);
    expect(normalizeProviderDeliveryReceipts("twilio_voice", {
      CallSid: "CA0002",
      CallStatus: "in-progress",
    })).toEqual([{ providerReference: "CA0002", status: "sent" }]);
  });

  it("correlates delegated Email events by the native delivery reference", () => {
    expect(normalizeProviderDeliveryReceipts("smtp", {
      providerMessageId: "mail-provider-1",
      referenceId: "support-delivery-1",
      eventType: "hard_bounce",
      metadata: { reason: "mailbox_unavailable" },
    })).toEqual([{
      providerReference: "mail-provider-1",
      deliveryId: "support-delivery-1",
      status: "failed",
      reasonCode: "mailbox_unavailable",
    }]);
    expect(providerOutboundValidatesLive("email_google", { id: "email-1", status: "queued" })).toBe(false);
    expect(providerOutboundValidatesLive("email_microsoft", { id: "email-1", status: "captured" })).toBe(false);
    expect(providerOutboundValidatesLive("smtp", {
      id: "email-1",
      status: "sent",
      providerMessageId: "smtp-message-1",
    })).toBe(true);
    expect(providerOutboundValidatesLive("twitter", { data: { dm_event_id: "dm-1" } })).toBe(true);
  });

  it("rejects Slack logical failures returned with HTTP 2xx", () => {
    expect(providerResponseFailure("slack", { ok: false, error: "channel_not_found" })).toEqual({
      code: "channel_not_found",
      message: "Provider rejected the request (channel_not_found)",
    });
    expect(providerResponseFailure("slack", { ok: true })).toBeNull();
  });
});

describe("Support provider OAuth refresh", () => {
  it("builds deterministic Google, Microsoft, and X refresh requests without leaking credentials in URLs", () => {
    const credentials = {
      client_id: "client-id",
      client_secret: "client-secret",
      refresh_token: "refresh-token",
    };
    const google = providerOAuthRefreshRequest("email_google", {}, credentials);
    expect(google.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(google.body)).toMatchObject(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
      client_id: "client-id",
      client_secret: "client-secret",
    }));
    expect(google.headers.has("authorization")).toBe(false);

    const microsoft = providerOAuthRefreshRequest("email_microsoft", { tenant: "organizations" }, credentials);
    expect(microsoft.tokenUrl).toBe("https://login.microsoftonline.com/organizations/oauth2/v2.0/token");

    const twitter = providerOAuthRefreshRequest("twitter", {}, credentials);
    expect(twitter.tokenUrl).toBe("https://api.x.com/2/oauth2/token");
    expect(twitter.headers.get("authorization")).toBe(`Basic ${btoa("client-id:client-secret")}`);
    expect(new URLSearchParams(twitter.body).has("client_secret")).toBe(false);
    expect(twitter.tokenUrl).not.toContain("client-id");
  });

  it("refreshes an expiring token and persists a rotated credential atomically", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      token_type: "bearer",
      expires_in: 7_200,
    }));
    vi.stubGlobal("fetch", fetchMock);
    const writes: Array<{ query: string; values: unknown[] }> = [];
    const db = {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            writes.push({ query, values });
            return { success: true, meta: { changes: 1 } };
          },
          first: async () => null,
        }),
      }),
    } as unknown as D1Database;
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const refreshed = await refreshProviderCredentialsIfNeeded({
      DB: db,
      SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "credentials-key",
      SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: undefined,
    }, {
      projectId: 12,
      endpointId: "endpoint-1",
      provider: "twitter",
      settings: {},
      credentials: {
        client_id: "client-id",
        client_secret: "client-secret",
        access_token: "expired-access",
        refresh_token: "old-refresh",
        expires_at: "2026-08-13T12:01:00.000Z",
      },
      credentialVersion: 4,
    }, now);
    expect(refreshed).toMatchObject({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_at: "2026-08-13T14:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const credentialWrite = writes.find(({ query }) => query.includes("UPDATE support_provider_credentials"));
    expect(credentialWrite?.values.slice(1)).toEqual(["endpoint-1", 12, 4]);
    const stored = await decryptCredentialPayload(["credentials-key"], String(credentialWrite?.values[0]));
    expect(stored.payload).toMatchObject({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_at: "2026-08-13T14:00:00.000Z",
    });
    expect(writes.some(({ query }) => query.includes("'live_validated'"))).toBe(false);
  });

  it("fails closed when an expired authorization cannot be refreshed", async () => {
    const writes: Array<{ query: string; values: unknown[] }> = [];
    const db = {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          run: async () => {
            writes.push({ query, values });
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as unknown as D1Database;
    await expect(refreshProviderCredentialsIfNeeded({
      DB: db,
      SUPPORT_CREDENTIAL_ENCRYPTION_KEY: "credentials-key",
      SUPPORT_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: undefined,
    }, {
      projectId: 12,
      endpointId: "endpoint-1",
      provider: "instagram",
      settings: {},
      credentials: { access_token: "expired", expires_at: "2026-08-13T11:00:00.000Z" },
      credentialVersion: 1,
    }, Date.parse("2026-08-13T12:00:00.000Z"))).rejects.toMatchObject({
      code: "configuration_required",
      status: 422,
    });
    expect(writes).toEqual([
      expect.objectContaining({ values: ["oauth_refresh_required", "endpoint-1", 12] }),
    ]);
  });
});

describe("Support provider outbound adapters", () => {
  const baseInput = {
    projectId: 12,
    deliveryId: "delivery-1",
    idempotencyKey: "delivery-key-1",
    recipient: "123456789",
    subject: "Support update",
    body: "Hello & <welcome>",
    settings: {},
    credentials: {},
  };

  it("delegates authorized Google and Microsoft email delivery to the native Email authority", async () => {
    const emailFetch = vi.fn().mockResolvedValue(Response.json({ id: "email-1", status: "queued" }, { status: 202 }));
    const env = {
      EMAIL_SERVICE: { fetch: emailFetch },
      EMAIL_INTERNAL_TOKEN: "internal-email-token",
    } as unknown as Env;
    for (const provider of ["email_google", "email_microsoft"]) {
      await outboundProviderRequest(env, {
        ...baseInput,
        provider,
        recipient: "customer@example.test",
        credentials: { access_token: "current-oauth-access" },
      });
    }
    expect(emailFetch).toHaveBeenCalledTimes(2);
    for (const call of emailFetch.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe("https://email.internal/internal/v1/messages");
      expect(new Headers(init.headers).get("x-internal-token")).toBe("internal-email-token");
      expect(JSON.parse(String(init.body))).toMatchObject({
        kind: "transactional",
        to: "customer@example.test",
        idempotencyKey: "delivery-key-1",
        projectId: 12,
        templateKey: "support.conversation.message",
      });
    }
    await expect(outboundProviderRequest(env, {
      ...baseInput,
      provider: "email_google",
      credentials: {},
    })).rejects.toMatchObject({ code: "configuration_required", status: 422 });
  });

  it("uses provider-specific Messenger and Instagram account authorities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ message_id: "mid-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await outboundProviderRequest({} as Env, {
      ...baseInput,
      provider: "facebook_messenger",
      settings: { page_id: "111111" },
      credentials: { page_access_token: "page-token" },
    });
    await outboundProviderRequest({} as Env, {
      ...baseInput,
      provider: "instagram",
      settings: { instagram_id: "222222" },
      credentials: { access_token: "instagram-token" },
    });
    const messenger = fetchMock.mock.calls[0] as [string, RequestInit];
    const instagram = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(messenger[0]).toBe("https://graph.facebook.com/v22.0/111111/messages");
    expect(new Headers(messenger[1].headers).get("authorization")).toBe("Bearer page-token");
    expect(JSON.parse(String(messenger[1].body))).toEqual({
      recipient: { id: "123456789" },
      messaging_type: "RESPONSE",
      message: { text: "Hello & <welcome>" },
    });
    expect(instagram[0]).toBe("https://graph.facebook.com/v22.0/222222/messages");
    expect(new Headers(instagram[1].headers).get("authorization")).toBe("Bearer instagram-token");
    expect(JSON.parse(String(instagram[1].body))).toEqual({
      recipient: { id: "123456789" },
      message: { text: "Hello & <welcome>" },
    });
  });

  it("sends X direct messages through the user OAuth v2 contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: { dm_event_id: "dm-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await outboundProviderRequest({} as Env, {
      ...baseInput,
      provider: "twitter",
      credentials: { access_token: "user-access-token" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.com/2/dm_conversations/with/123456789/messages");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-access-token");
    expect(JSON.parse(String(init.body))).toEqual({ text: "Hello & <welcome>" });
    expect(providerResponseFailure("twitter", { data: { dm_event_id: "dm-1" } })).toBeNull();
    expect(providerResponseFailure("twitter", {
      errors: [{ title: "Unauthorized", detail: "Token expired" }],
    })).toMatchObject({ code: "unauthorized" });
  });

  it("creates a deterministic Twilio voice call and escapes generated TwiML", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ sid: "CA123" }));
    vi.stubGlobal("fetch", fetchMock);
    const accountSid = `AC${"a".repeat(32)}`;
    await outboundProviderRequest({} as Env, {
      ...baseInput,
      provider: "twilio_voice",
      recipient: "+41790000000",
      settings: {
        from_number: "+14155550100",
        status_callback_url: "https://api.example.test/support/call-status",
      },
      credentials: { account_sid: accountSid, auth_token: "auth-token" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`);
    expect(new Headers(init.headers).get("authorization")).toBe(`Basic ${btoa(`${accountSid}:auth-token`)}`);
    const form = new URLSearchParams(String(init.body));
    expect(form.get("To")).toBe("+41790000000");
    expect(form.get("From")).toBe("+14155550100");
    expect(form.get("Twiml")).toBe("<Response><Say>Hello &amp; &lt;welcome&gt;</Say></Response>");
    expect(form.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
  });

  it("never returns a synthetic success for channels without an executable contract", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const provider of ["whatsapp_calls", "tiktok"]) {
      await expect(outboundProviderRequest({} as Env, {
        ...baseInput,
        provider,
      })).rejects.toMatchObject({ code: "configuration_required", status: 422 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
