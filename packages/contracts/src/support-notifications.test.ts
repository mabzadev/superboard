import { describe, expect, it } from "vitest";
import {
  parseSupportNotificationEvent,
  parseSupportNotificationReceipt,
  SUPPORT_NOTIFICATION_INGRESS_PATH,
  SupportNotificationContractError,
} from "./support-notifications";

const validEvent = {
  schema_version: 1,
  event_id: "support-notification:notification-1",
  project_id: 42,
  recipient_user_id: "auth-user-1",
  notification_type: "conversation.assigned",
  title: "Conversation assigned",
  body: "A conversation was assigned to you.",
  conversation_id: "conversation-1",
  occurred_at: "2026-08-13T12:00:00.000Z",
  channels: { push: true, browser: false },
};

describe("Support notification internal contract", () => {
  it("parses a bounded, versioned event and exposes the private path", () => {
    expect(SUPPORT_NOTIFICATION_INGRESS_PATH).toBe(
      "/internal/v1/push/support-notifications",
    );
    expect(parseSupportNotificationEvent(validEvent)).toEqual(validEvent);
  });

  it("rejects arbitrary metadata and secret-bearing fields", () => {
    for (const field of ["payload", "credentials", "signing_secret", "access_token"]) {
      expect(() =>
        parseSupportNotificationEvent({ ...validEvent, [field]: "must-not-cross" }),
      ).toThrowError(SupportNotificationContractError);
    }
    expect(() =>
      parseSupportNotificationEvent({
        ...validEvent,
        channels: { ...validEvent.channels, email: true },
      }),
    ).toThrow(/channels\.email/u);
  });

  it("rejects oversized and malformed events", () => {
    expect(() =>
      parseSupportNotificationEvent({ ...validEvent, body: "x".repeat(2_001) }),
    ).toThrow(/body/u);
    expect(() =>
      parseSupportNotificationEvent({ ...validEvent, project_id: 0 }),
    ).toThrow(/project_id/u);
    expect(() =>
      parseSupportNotificationEvent({ ...validEvent, occurred_at: "yesterday" }),
    ).toThrow(/occurred_at/u);
  });

  it("parses the bounded API receipt", () => {
    expect(parseSupportNotificationReceipt({
      data: {
        event_id: validEvent.event_id,
        duplicate: true,
        browser_messages: 2,
        push_queued: 1,
      },
    }).data).toMatchObject({ duplicate: true, push_queued: 1 });
  });
});
