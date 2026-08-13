import { describe, expect, it, vi } from "vitest";
import {
  normalizeAwsSesEvent,
  parseAwsSnsEnvelope,
  trustedAwsSnsConfirmationUrl,
  verifyAwsSnsEnvelope,
  type AwsSnsEnvelope,
} from "./aws-ses";

const TOPIC = "arn:aws:sns:eu-central-1:123456789012:superboard-development";

describe("AWS SNS and SES verification", () => {
  it("verifies a version 2 SNS signature with the certificate public key", async () => {
    const keyPair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2_048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const envelope: AwsSnsEnvelope = {
      Type: "Notification",
      MessageId: "sns-message-1",
      TopicArn: TOPIC,
      Message: JSON.stringify({ eventType: "Delivery" }),
      Timestamp: "2026-08-13T00:00:00.000Z",
      SignatureVersion: "2",
      Signature: "pending",
      SigningCertURL:
        "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-1234567890abcdef.pem",
      Subject: "Amazon SES Email Event Notification",
    };
    const canonical = [
      "Message",
      envelope.Message,
      "MessageId",
      envelope.MessageId,
      "Subject",
      envelope.Subject,
      "Timestamp",
      envelope.Timestamp,
      "TopicArn",
      envelope.TopicArn,
      "Type",
      envelope.Type,
      "",
    ].join("\n");
    envelope.Signature = encodeBase64(
      new Uint8Array(
        await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          keyPair.privateKey,
          new TextEncoder().encode(canonical),
        ),
      ),
    );
    const certificate = testCertificatePem(
      new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey)),
    );
    const fetchCertificate = vi.fn().mockResolvedValue(
      new Response(certificate, {
        status: 200,
        headers: { "content-type": "application/x-pem-file" },
      }),
    );

    await expect(
      verifyAwsSnsEnvelope(envelope, TOPIC, fetchCertificate),
    ).resolves.toBeUndefined();
    expect(fetchCertificate).toHaveBeenCalledWith(
      new URL(envelope.SigningCertURL),
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("rejects another topic and certificate hosts before network access", async () => {
    const fetchCertificate = vi.fn();
    const envelope = parseAwsSnsEnvelope({
      Type: "Notification",
      MessageId: "sns-message-2",
      TopicArn: TOPIC,
      Message: "{}",
      Timestamp: "2026-08-13T00:00:00.000Z",
      SignatureVersion: "2",
      Signature: "c2lnbmF0dXJl",
      SigningCertURL:
        "https://attacker.example/SimpleNotificationService-1234567890abcdef.pem",
    });
    await expect(
      verifyAwsSnsEnvelope(envelope, TOPIC, fetchCertificate),
    ).rejects.toThrow("aws_sns_url_untrusted");
    await expect(
      verifyAwsSnsEnvelope(
        { ...envelope, SigningCertURL: envelope.SigningCertURL },
        "arn:aws:sns:eu-central-1:123456789012:another-topic",
        fetchCertificate,
      ),
    ).rejects.toThrow("aws_sns_topic_invalid");
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it("allows only the exact signed SNS subscription confirmation URL", () => {
    const envelope = parseAwsSnsEnvelope({
      Type: "SubscriptionConfirmation",
      MessageId: "sns-subscription-1",
      TopicArn: TOPIC,
      Message: "Confirm",
      Timestamp: "2026-08-13T00:00:00.000Z",
      SignatureVersion: "2",
      Signature: "c2lnbmF0dXJl",
      SigningCertURL:
        "https://sns.eu-central-1.amazonaws.com/SimpleNotificationService-1234567890abcdef.pem",
      Token: "token",
      SubscribeURL: `https://sns.eu-central-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=token`,
    });
    expect(trustedAwsSnsConfirmationUrl(envelope).hostname).toBe(
      "sns.eu-central-1.amazonaws.com",
    );
    expect(() =>
      trustedAwsSnsConfirmationUrl({
        ...envelope,
        SubscribeURL: "https://attacker.example/?Action=ConfirmSubscription",
      }),
    ).toThrow("aws_sns_url_untrusted");
  });
});

describe("Amazon SES event normalization", () => {
  it("normalizes delivery without exporting recipient addresses", () => {
    const event = normalizeAwsSesEvent(
      JSON.stringify({
        eventType: "Delivery",
        mail: {
          messageId: "ses-message-1",
          timestamp: "2026-08-13T00:00:00.000Z",
          destination: ["private@example.test"],
        },
        delivery: {
          timestamp: "2026-08-13T00:00:02.000Z",
          processingTimeMillis: 2_000,
          smtpResponse: "250 accepted",
        },
      }),
    );
    expect(event).toEqual({
      providerMessageId: "ses-message-1",
      eventType: "delivered",
      occurredAt: "2026-08-13T00:00:02.000Z",
      metadata: {
        processing_time_ms: 2_000,
        smtp_response: "250 accepted",
      },
    });
    expect(JSON.stringify(event)).not.toContain("private@example.test");
  });

  it("distinguishes permanent and transient bounces", () => {
    const bounce = (bounceType: string) =>
      normalizeAwsSesEvent(
        JSON.stringify({
          notificationType: "Bounce",
          mail: {
            messageId: `ses-${bounceType}`,
            timestamp: "2026-08-13T00:00:00.000Z",
          },
          bounce: {
            bounceType,
            bounceSubType: "General",
            timestamp: "2026-08-13T00:00:03.000Z",
          },
        }),
      );
    expect(bounce("Permanent").eventType).toBe("hard_bounce");
    expect(bounce("Transient").eventType).toBe("soft_bounce");
  });
});

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function testCertificatePem(spki: Uint8Array): string {
  // The production parser only extracts SubjectPublicKeyInfo. Build the
  // minimal DER certificate shape around a fresh key so no private fixture is
  // ever committed to the repository.
  const tbsCertificate = derSequence(
    derElement(0x02, new Uint8Array([1])),
    derSequence(),
    derSequence(),
    derSequence(),
    derSequence(),
    spki,
  );
  const certificate = derSequence(
    tbsCertificate,
    derSequence(),
    derElement(0x03, new Uint8Array([0])),
  );
  return `-----BEGIN CERTIFICATE-----\n${encodeBase64(certificate)}\n-----END CERTIFICATE-----\n`;
}

function derSequence(...elements: Uint8Array[]): Uint8Array {
  return derElement(0x30, concatenate(elements));
}

function derElement(tag: number, content: Uint8Array): Uint8Array {
  return concatenate([
    new Uint8Array([tag]),
    derLength(content.length),
    content,
  ]);
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  for (let remaining = length; remaining > 0; remaining >>>= 8) {
    bytes.unshift(remaining & 0xff);
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function concatenate(values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}
