import { describe, expect, it } from "vitest";
import { configuredSecrets, matchesAnySecret } from "./secret";
import { customWorkerAuthorized } from "./custom-worker";

describe("secret overlap helpers", () => {
  it("keeps current and previous values in signing order", () => {
    expect(configuredSecrets("current", undefined, "previous", "")).toEqual([
      "current",
      "previous",
    ]);
  });

  it("accepts current or previous and rejects every other value", async () => {
    const candidates = configuredSecrets("current", "previous");
    await expect(matchesAnySecret("current", candidates)).resolves.toBe(true);
    await expect(matchesAnySecret("previous", candidates)).resolves.toBe(true);
    await expect(matchesAnySecret("invalid", candidates)).resolves.toBe(false);
    await expect(matchesAnySecret("", candidates)).resolves.toBe(false);
  });

  it("applies the same overlap contract to Custom Workers", async () => {
    const request = new Request("https://custom.internal/internal/v1/manifest", {
      headers: { "x-custom-worker-token": "previous-custom-token" },
    });
    await expect(customWorkerAuthorized(
      request,
      configuredSecrets("new-custom-token", "previous-custom-token"),
    )).resolves.toBe(true);
  });
});
