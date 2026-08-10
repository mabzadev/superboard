import { describe, expect, it, vi } from "vitest";
import { isEmailTransportInProgress, sendSmtpMessage } from "./email-service";
import type { Env } from "./types";

const command = {
  idempotencyKey: "marketing.campaign:12:delivery-1:profile-1",
  projectId: 12,
  referenceId: "delivery-1",
  profileId: "profile-1",
  publicConfig: {
    host: "smtp.example.test",
    port: 587,
    security: "starttls" as const,
    username: "mailer",
    from_email: "sender@example.test",
    from_name: "OpenGrow",
    reply_to: null,
  },
  secret: { password: "private-password" },
  message: {
    to: "recipient@example.test",
    subject: "Personalized subject",
    text: "Tracked body",
    html: null,
  },
};

describe("Marketing Email service binding", () => {
  it("delegates a fully materialized message over the private binding", async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          id: "transport-1",
          status: "sent",
          messageId: "provider-1",
          response: "accepted",
        },
        { status: 201 },
      ),
    );
    const receipt = await sendSmtpMessage(
      {
        EMAIL_SERVICE: { fetch },
        EMAIL_INTERNAL_TOKEN: "internal-email-secret",
      } as unknown as Env,
      command,
    );
    expect(receipt.messageId).toBe("provider-1");
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0]![1] as RequestInit;
    expect(request.headers).toMatchObject({
      "x-internal-token": "internal-email-secret",
    });
    expect(JSON.parse(String(request.body))).toMatchObject({
      source: "marketing",
      idempotencyKey: command.idempotencyKey,
      projectId: 12,
      profileId: "profile-1",
      secret: { password: "private-password" },
      message: { subject: "Personalized subject", text: "Tracked body" },
    });
  });

  it("preserves the transport in-progress signal for Queue retry safety", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: "email_transport_in_progress" },
          { status: 409 },
        ),
      );
    await expect(
      sendSmtpMessage(
        {
          EMAIL_SERVICE: { fetch },
          EMAIL_INTERNAL_TOKEN: "internal-email-secret",
        } as unknown as Env,
        command,
      ),
    ).rejects.toMatchObject({
      code: "email_transport_in_progress",
      status: 409,
    });
  });

  it("marks a binding failure as an unknown outcome so failover cannot duplicate", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("binding disconnected"));
    await expect(
      sendSmtpMessage(
        {
          EMAIL_SERVICE: { fetch },
          EMAIL_INTERNAL_TOKEN: "internal-email-secret",
        } as unknown as Env,
        command,
      ),
    ).rejects.toMatchObject({
      code: "email_transport_outcome_unknown",
      status: 503,
    });
  });

  it("preserves an unconfirmed SMTP acceptance for same-profile retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "smtp_outcome_unknown" }, { status: 503 }),
      );
    const delivery = sendSmtpMessage(
      {
        EMAIL_SERVICE: { fetch },
        EMAIL_INTERNAL_TOKEN: "internal-email-secret",
      } as unknown as Env,
      command,
    );
    await expect(delivery).rejects.toMatchObject({
      code: "smtp_outcome_unknown",
      status: 503,
    });
    await delivery.catch((error) =>
      expect(isEmailTransportInProgress(error)).toBe(true),
    );
  });

  it("fails closed without a binding and token", async () => {
    await expect(sendSmtpMessage({} as Env, command)).rejects.toMatchObject({
      code: "email_service_unavailable",
      status: 503,
    });
  });
});
