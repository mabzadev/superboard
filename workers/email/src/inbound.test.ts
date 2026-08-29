import { describe, expect, it } from "vitest";
import {
  EMAIL_INBOUND_LIMITS,
  EMAIL_SERVICE_INBOUND_NORMALIZE_PATH,
} from "@superboard/contracts/email";
import worker from "./index";

function environment(overrides: Partial<Env> = {}): Env {
  return {
    EMAIL_INTERNAL_TOKEN: "email-internal-secret",
    ...overrides,
  } as Env;
}

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request(
    `https://email.internal${EMAIL_SERVICE_INBOUND_NORMALIZE_PATH}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-token": "email-internal-secret",
        "x-request-id": "inbound-email-1",
        "x-superboard-email-provider": "google",
        "x-superboard-email-endpoint-id": "email-primary",
        ...headers,
      },
      body,
    },
  );
}

describe("inbound email normalization endpoint", () => {
  it("returns a bounded provider-neutral envelope with sanitized content", async () => {
    const response = await worker.fetch(
      request(
        JSON.stringify({
          event_id: "event-1",
          message: {
            id: "provider-message-1",
            receivedDateTime: "2026-08-13T09:00:00+02:00",
            sentDateTime: "2026-08-13T08:59:00+02:00",
            from: {
              emailAddress: {
                address: "Sender@Example.com",
                name: "Sender",
              },
            },
            to: [
              {
                emailAddress: {
                  address: "support@example.test",
                  name: "Support",
                },
              },
            ],
            subject: "Need help",
            html: '<p onclick="steal()">Hello</p><script>steal()</script>',
            headers: {
              "Message-Id": "<provider-message-1@example.com>",
              "Authentication-Results":
                "mx.example; spf=pass; dkim=pass; dmarc=pass",
            },
            attachments: [
              {
                id: "attachment-1",
                name: "../invoice.pdf",
                contentType: "application/pdf",
                size: 128,
                downloadUrl:
                  "https://mail.example.test/attachments/attachment-1",
              },
            ],
            authenticity: { provider_verified: true },
          },
        }),
      ),
      environment(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("inbound-email-1");
    await expect(response.json()).resolves.toEqual({
      data: {
        schema_version: 1,
        provider: "google",
        endpoint_id: "email-primary",
        provider_message_id: "provider-message-1",
        received_at: "2026-08-13T07:00:00.000Z",
        sent_at: "2026-08-13T06:59:00.000Z",
        from: { email: "sender@example.com", name: "Sender" },
        to: [{ email: "support@example.test", name: "Support" }],
        cc: [],
        bcc: [],
        subject: "Need help",
        body: { text: null, html: "<p>Hello</p>" },
        thread: {
          message_id: "<provider-message-1@example.com>",
          in_reply_to: null,
          references: [],
        },
        attachments: [
          {
            provider_attachment_id: "attachment-1",
            file_name: "invoice.pdf",
            content_type: "application/pdf",
            byte_size: 128,
            content_id: null,
            download_url: "https://mail.example.test/attachments/attachment-1",
          },
        ],
        authenticity: {
          provider_verified: false,
          spf: "pass",
          dkim: "pass",
          dmarc: "pass",
        },
        metadata: { event_id: "event-1" },
      },
    });
  });

  it("accepts a generic SMTP form and normalizes address lists", async () => {
    const form = new URLSearchParams({
      message_id: "smtp-message-1",
      from: "Sender <sender@example.test>",
      to: "Support <support@example.test>, Archive <archive@example.test>",
      subject: "SMTP message",
      text: "Hello from SMTP",
    });
    const response = await worker.fetch(
      request(form.toString(), {
        "content-type": "application/x-www-form-urlencoded",
        "x-superboard-email-provider": "smtp",
      }),
      environment(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        provider: "smtp",
        provider_message_id: "smtp-message-1",
        from: { email: "sender@example.test", name: "Sender" },
        to: [
          { email: "support@example.test", name: "Support" },
          { email: "archive@example.test", name: "Archive" },
        ],
        body: { text: "Hello from SMTP", html: null },
      },
    });
  });

  it("requires internal authentication", async () => {
    const unauthorized = request("{}", { "x-internal-token": "invalid" });
    const response = await worker.fetch(
      unauthorized,
      environment(),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", retryable: false },
    });
  });

  it("rejects announced and streamed bodies above the contract limit", async () => {
    const response = await worker.fetch(
      request("x".repeat(EMAIL_INBOUND_LIMITS.networkBodyBytesMaximum + 1), {
        "content-type": "application/octet-stream",
      }),
      environment(),
      {} as ExecutionContext,
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "body_too_large", retryable: false },
    });
  });
});
