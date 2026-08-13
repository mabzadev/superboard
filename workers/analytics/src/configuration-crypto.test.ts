import { describe, expect, it } from "vitest";
import {
  decryptAnalyticsConfiguration,
  encryptAnalyticsConfiguration,
  signAnalyticsWebhook,
} from "./configuration-crypto";

describe("analytics configuration cryptography", () => {
  it("encrypts hook secrets with authenticated encryption", async () => {
    const encrypted = await encryptAnalyticsConfiguration("active-key", {
      secret: "webhook-secret",
    });
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    expect(encrypted).not.toContain("webhook-secret");
    await expect(
      decryptAnalyticsConfiguration<{ secret: string }>(
        "active-key",
        encrypted,
      ),
    ).resolves.toEqual({ secret: "webhook-secret" });
    await expect(
      decryptAnalyticsConfiguration("wrong-key", encrypted),
    ).rejects.toThrow();
  });

  it("signs exact webhook bodies with a stable SHA-256 HMAC", async () => {
    const first = await signAnalyticsWebhook("hook-secret", '{"id":"one"}');
    const replay = await signAnalyticsWebhook("hook-secret", '{"id":"one"}');
    const changed = await signAnalyticsWebhook("hook-secret", '{"id":"two"}');
    expect(first).toMatch(/^sha256=[a-f0-9]{64}$/u);
    expect(replay).toBe(first);
    expect(changed).not.toBe(first);
  });
});
