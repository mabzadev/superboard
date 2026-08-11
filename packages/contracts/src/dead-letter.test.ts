import { describe, expect, it } from "vitest";
import { deadLetterPayload } from "./dead-letter";

describe("dead-letter payload retention", () => {
  it("retains bounded JSON with an integrity digest", async () => {
    const result = await deadLetterPayload({ type: "email.deliver", messageId: "mail-1" });
    expect(result).toMatchObject({ replayable: true, jobType: "email.deliver" });
    expect(result.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(result.payloadJson)).toEqual({ type: "email.deliver", messageId: "mail-1" });
  });

  it("keeps metadata and digest but not an oversized original body", async () => {
    const result = await deadLetterPayload({ type: "large", value: "x".repeat(100) }, 32);
    expect(result.replayable).toBe(false);
    expect(result.payloadBytes).toBeGreaterThan(32);
    expect(JSON.parse(result.payloadJson)).toMatchObject({ payload_retained: false, job_type: "large" });
  });

  it("redacts nested credentials and disables unsafe replay", async () => {
    const result = await deadLetterPayload({
      type: "marketing.optin.deliver",
      token: "private-confirmation-token",
      headers: { Authorization: "Bearer private-access-token" },
      payload: { password: "private-password", messageId: "message-1" },
    });
    expect(result).toMatchObject({
      replayable: false,
      redacted: true,
      jobType: "marketing.optin.deliver",
    });
    expect(result.payloadJson).not.toMatch(/private-confirmation|private-access|private-password/u);
    expect(JSON.parse(result.payloadJson)).toEqual({
      type: "marketing.optin.deliver",
      token: "[REDACTED]",
      headers: { Authorization: "[REDACTED]" },
      payload: { password: "[REDACTED]", messageId: "message-1" },
    });
  });
});
