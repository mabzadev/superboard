import { describe, expect, it } from "vitest";
import { hashFlowUserId } from "./crypto";
import type { Env } from "../types";

describe("hashFlowUserId", () => {
  it("is independent from rotation of the encryption key", async () => {
    const base = {
      FLOW_USER_HASH_KEY: "stable-user-pseudonym-key",
      FLOW_USER_ENCRYPTION_KEY: "encryption-v1",
    } as Env;
    const rotated = {
      ...base,
      FLOW_USER_ENCRYPTION_KEY: "encryption-v2",
      FLOW_USER_ENCRYPTION_KEY_PREVIOUS: "encryption-v1",
    } as Env;
    await expect(hashFlowUserId(base, "10-test", "user@example.com"))
      .resolves.toBe(
        await hashFlowUserId(rotated, "10-test", "user@example.com"),
      );
  });

  it("keeps project identities isolated", async () => {
    const env = {
      FLOW_USER_HASH_KEY: "stable-user-pseudonym-key",
      FLOW_USER_ENCRYPTION_KEY: "encryption-v1",
    } as Env;
    await expect(hashFlowUserId(env, "10-test", "same-user"))
      .resolves.not.toBe(await hashFlowUserId(env, "20-test", "same-user"));
  });
});
