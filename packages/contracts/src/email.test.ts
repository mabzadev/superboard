import { describe, expect, it } from "vitest";
import {
  EMAIL_INBOUND_LIMITS,
  EMAIL_SERVICE_INBOUND_NORMALIZE_PATH,
  EmailInboundContractError,
  parseEmailInboundEnvelope,
} from "./email";

function fixture() {
  return {
    schema_version: 1,
    provider: "google",
    endpoint_id: "google-primary",
    provider_message_id: "provider-message-1",
    received_at: "2026-08-13T09:00:00+02:00",
    sent_at: "2026-08-13T08:59:58+02:00",
    from: { email: " Sender@Example.com ", name: "Sender" },
    to: [{ email: "support@example.test", name: "Support" }],
    cc: [],
    bcc: [],
    subject: "Need help",
    body: { text: "Hello", html: "<p>Hello</p>" },
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
      provider_verified: true,
      spf: "pass",
      dkim: "pass",
      dmarc: "pass",
    },
    metadata: { mailbox: "support" },
  };
}

describe("canonical inbound email contract", () => {
  it("exposes a private native normalization path", () => {
    expect(EMAIL_SERVICE_INBOUND_NORMALIZE_PATH).toBe(
      "/internal/v1/inbound-email/normalize",
    );
  });

  it("normalizes addresses and timestamps while retaining native fields", () => {
    expect(parseEmailInboundEnvelope(fixture())).toMatchObject({
      schema_version: 1,
      provider: "google",
      endpoint_id: "google-primary",
      provider_message_id: "provider-message-1",
      received_at: "2026-08-13T07:00:00.000Z",
      sent_at: "2026-08-13T06:59:58.000Z",
      from: { email: "sender@example.com", name: "Sender" },
      to: [{ email: "support@example.test", name: "Support" }],
      attachments: [
        {
          provider_attachment_id: "attachment-1",
          file_name: "invoice.pdf",
          byte_size: 128,
        },
      ],
    });
  });

  it("rejects oversized bodies and non-HTTPS attachment locations", () => {
    expect(() =>
      parseEmailInboundEnvelope({
        ...fixture(),
        body: { text: "x".repeat(EMAIL_INBOUND_LIMITS.bodyBytesMaximum + 1) },
      }),
    ).toThrowError(EmailInboundContractError);
    expect(() =>
      parseEmailInboundEnvelope({
        ...fixture(),
        attachments: [
          {
            ...(fixture().attachments[0] as Record<string, unknown>),
            download_url: "http://mail.example.test/private",
          },
        ],
      }),
    ).toThrow(/attachment URL is invalid/u);
  });

  it("rejects a canonical envelope that would exceed the Support ingress bound", () => {
    expect(() =>
      parseEmailInboundEnvelope({
        ...fixture(),
        body: {
          text: "x".repeat(EMAIL_INBOUND_LIMITS.bodyBytesMaximum - 1_000),
          html: "y".repeat(2_000),
        },
      }),
    ).toThrow(/envelope is too large/u);
  });

  it("rejects identifiers and subjects containing transport injection", () => {
    expect(() =>
      parseEmailInboundEnvelope({
        ...fixture(),
        subject: "Hello\r\nBcc: hidden@example.test",
      }),
    ).toThrow(/subject/u);
    expect(() =>
      parseEmailInboundEnvelope({
        ...fixture(),
        endpoint_id: "invalid endpoint",
      }),
    ).toThrow(/unsupported characters/u);
  });
});
