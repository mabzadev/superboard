import { beforeEach, describe, expect, it, vi } from "vitest";

const sockets = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("cloudflare:sockets", () => ({ connect: sockets.connect }));

import { buildMessage, sendSmtpMessage } from "./index";

describe("SMTP provider acceptance boundary", () => {
  beforeEach(() => sockets.connect.mockReset());

  it("returns the accepted receipt when the provider drops QUIT", async () => {
    const writes: string[] = [];
    const socket = fakeSocket(
      [
        "220 ready",
        "250 hello",
        "250 sender accepted",
        "250 recipient accepted",
        "354 transmit message",
        "250 queued as provider-message-1",
      ],
      writes,
    );
    sockets.connect.mockReturnValue(socket);

    await expect(
      sendSmtpMessage(
        smtpConfig,
        { password: null },
        {
          to: "recipient@example.test",
          subject: "Accepted",
          text: "Body",
          html: null,
          messageId: "<opengrow-stable@example.test>",
        },
      ),
    ).resolves.toEqual({
      messageId: "provider-message-1",
      response: "queued as provider-message-1",
    });
    expect(writes.at(-1)).toBe("QUIT\r\n");
  });

  it("uses the caller's deterministic Message-ID verbatim", () => {
    const first = buildMessage(smtpConfig, {
      to: "recipient@example.test",
      subject: "Stable",
      text: "Body",
      html: null,
      messageId: "<opengrow-stable@example.test>",
    });
    const second = buildMessage(smtpConfig, {
      to: "recipient@example.test",
      subject: "Stable",
      text: "Body",
      html: null,
      messageId: "<opengrow-stable@example.test>",
    });
    expect(first.messageId).toBe("<opengrow-stable@example.test>");
    expect(second.messageId).toBe(first.messageId);
    expect(first.raw).toContain("Message-ID: <opengrow-stable@example.test>");
  });

  it("classifies a connection loss after DATA as outcome unknown", async () => {
    const writes: string[] = [];
    sockets.connect.mockReturnValue(
      fakeSocket(
        [
          "220 ready",
          "250 hello",
          "250 sender accepted",
          "250 recipient accepted",
          "354 transmit message",
        ],
        writes,
      ),
    );

    await expect(
      sendSmtpMessage(
        smtpConfig,
        { password: null },
        {
          to: "recipient@example.test",
          subject: "Ambiguous",
          text: "Body already transmitted",
          html: null,
          messageId: "<opengrow-stable@example.test>",
        },
      ),
    ).rejects.toMatchObject({
      code: "smtp_outcome_unknown",
      details: { phase: "provider_acceptance" },
    });
    expect(writes.join("")).toContain("Body already transmitted");
  });
});

const smtpConfig = {
  host: "smtp.example.test",
  port: 2525,
  security: "plain" as const,
  username: null,
  from_email: "sender@example.test",
  from_name: "OpenGrow",
  reply_to: null,
};

function fakeSocket(lines: string[], writes: string[]) {
  const bytes = new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
  return {
    opened: Promise.resolve({}),
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    writable: new WritableStream<Uint8Array>({
      write(value) {
        writes.push(new TextDecoder().decode(value));
      },
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}
