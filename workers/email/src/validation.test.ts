import { describe, expect, it } from "vitest";
import { parseEmailMessage, secretsEqual } from "./validation";

describe("email validation", () => {
  it("normalizes and deduplicates recipients", () => {
    expect(
      parseEmailMessage({
        kind: "transactional",
        to: [" User@example.com ", "user@example.com"],
        subject: "Welcome",
        text: "Hello",
      }).to,
    ).toEqual(["user@example.com"]);
  });

  it("rejects header injection", () => {
    expect(() =>
      parseEmailMessage({
        to: "user@example.com",
        subject: "Hello\r\nBcc: attacker@example.com",
        text: "Hello",
      }),
    ).toThrow(/subject invalid/);
  });

  it("rejects transport-owned headers even when their values are sanitized", () => {
    expect(() =>
      parseEmailMessage({
        to: "user@example.com",
        subject: "Hello",
        text: "Hello",
        headers: { From: "attacker@example.com" },
      }),
    ).toThrow(/headers invalid/);
  });

  it("accepts bounded portable idempotency keys", () => {
    expect(
      parseEmailMessage({
        to: "user@example.com",
        subject: "Hello",
        text: "Hello",
        idempotencyKey: "identity.verify_email:token-123",
      }).idempotencyKey,
    ).toBe("identity.verify_email:token-123");
    expect(() =>
      parseEmailMessage({
        to: "user@example.com",
        subject: "Hello",
        text: "Hello",
        idempotencyKey: "contains spaces",
      }),
    ).toThrow(/idempotency key invalid/);
  });

  it("compares internal secrets without early string equality", async () => {
    await expect(secretsEqual("same", "same")).resolves.toBe(true);
    await expect(secretsEqual("same", "different")).resolves.toBe(false);
  });
});
