import { describe, expect, it } from "vitest";
import {
  legacyTrafficEligible,
  legacyVariantBucket,
  stableBucket,
} from "./service";

describe("legacy experience assignment parity", () => {
  it("matches the removed Paywalls SHA-256 project-scoped seeds", async () => {
    const projectId = 11;
    const placementId = "placement-fixed";
    const experienceId = "experience-fixed";
    const subject = "customer-fixed";
    expect(
      await legacyTrafficEligible(
        "paywalls",
        projectId,
        placementId,
        subject,
        3_700,
      ),
    ).toBe(
      (await legacyPaywallsBucket(`${projectId}:${placementId}:${subject}`, 100)) < 37,
    );
    expect(
      await legacyVariantBucket(
        "paywalls",
        projectId,
        experienceId,
        subject,
        97,
      ),
    ).toBe(
      await legacyPaywallsBucket(`${projectId}:${experienceId}:${subject}`, 97),
    );
  });

  it("matches the removed Onboardings single FNV subject bucket", async () => {
    const subject = "anonymous-fixed";
    const bucket = legacyOnboardingsHash(subject);
    expect(
      await legacyTrafficEligible(
        "onboardings",
        11,
        "ignored-placement",
        subject,
        5_000,
      ),
    ).toBe(bucket % 10_000 < 5_000);
    expect(
      await legacyVariantBucket(
        "onboardings",
        11,
        "ignored-experience",
        subject,
        10_000,
      ),
    ).toBe(bucket % 10_000);
    expect(stableBucket(subject, 10_000)).toBe(bucket % 10_000);
  });
});

async function legacyPaywallsBucket(value: string, modulo: number) {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return (
    (((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0) %
    modulo
  );
}

function legacyOnboardingsHash(value: string) {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}
