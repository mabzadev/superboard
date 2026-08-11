import { describe, expect, it, vi } from "vitest";
import {
  parseDnsMessage,
  verifyEmailAuthentication,
} from "./email-authentication";

describe("sender DNS authentication", () => {
  it("requires SPF, DKIM and DMARC before a sender becomes production-ready", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        dnsTxtResponse("example.com", "v=spf1 include:mail.example.net -all"),
      )
      .mockResolvedValueOnce(
        dnsTxtResponse("_dmarc.example.com", "v=DMARC1; p=reject"),
      )
      .mockResolvedValueOnce(
        dnsTxtResponse(
          "mail._domainkey.example.com",
          "v=DKIM1; k=rsa; p=publickey",
        ),
      );

    const result = await verifyEmailAuthentication(
      "news@example.com",
      "mail",
      fetcher as typeof fetch,
    );

    expect(result).toMatchObject({
      domain: "example.com",
      dkimSelector: "mail",
      spf: "verified",
      dkim: "verified",
      dmarc: "verified",
      ready: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({
        headers: { accept: "application/dns-message" },
      });
    }
  });

  it("does not confuse a successful SMTP connection with authenticated sending", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        dnsTxtResponse("example.com", "google-site-verification=123"),
      )
      .mockResolvedValueOnce(dnsEmptyResponse("_dmarc.example.com"));

    const result = await verifyEmailAuthentication(
      "news@example.com",
      null,
      fetcher as typeof fetch,
    );

    expect(result).toMatchObject({
      spf: "missing",
      dkim: "unconfigured",
      dmarc: "missing",
      ready: false,
    });
  });

  it("rejects malformed DNS wire responses", () => {
    expect(() => parseDnsMessage(Uint8Array.from([0, 1, 2]))).toThrow(
      /truncated/,
    );
  });

  it("rejects an oversized DNS response before buffering it", async () => {
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(new Uint8Array(), {
          headers: {
            "content-type": "application/dns-message",
            "content-length": "65536",
          },
        }),
    );
    await expect(
      verifyEmailAuthentication(
        "news@example.com",
        null,
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow(/exceeds 65535 bytes/);
  });
});

function dnsTxtResponse(name: string, value: string): Response {
  const question = dnsQuestion(name);
  const text = new TextEncoder().encode(value);
  const answer = new Uint8Array(13 + text.length);
  answer.set([0xc0, 0x0c, 0x00, 0x10, 0x00, 0x01, 0x00, 0x00, 0x01, 0x2c], 0);
  new DataView(answer.buffer).setUint16(10, text.length + 1);
  answer[12] = text.length;
  answer.set(text, 13);
  return dnsResponse(question, [answer]);
}

function dnsEmptyResponse(name: string): Response {
  return dnsResponse(dnsQuestion(name), []);
}

function dnsResponse(question: Uint8Array, answers: Uint8Array[]): Response {
  const bytes = new Uint8Array(
    12 +
      question.length +
      answers.reduce((total, answer) => total + answer.length, 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 0x8180);
  view.setUint16(4, 1);
  view.setUint16(6, answers.length);
  bytes.set(question, 12);
  let offset = 12 + question.length;
  for (const answer of answers) {
    bytes.set(answer, offset);
    offset += answer.length;
  }
  return new Response(bytes, {
    headers: { "content-type": "application/dns-message" },
  });
}

function dnsQuestion(name: string): Uint8Array {
  const labels = name
    .split(".")
    .map((label) => new TextEncoder().encode(label));
  const bytes = new Uint8Array(
    labels.reduce((total, label) => total + label.length + 1, 0) + 5,
  );
  let offset = 0;
  for (const label of labels) {
    bytes[offset] = label.length;
    bytes.set(label, offset + 1);
    offset += label.length + 1;
  }
  bytes[offset] = 0;
  bytes.set([0, 16, 0, 1], offset + 1);
  return bytes;
}
