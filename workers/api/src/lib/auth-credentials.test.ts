import { describe, expect, it } from "vitest";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import type { Env } from "../types";
import {
  isEncryptedAuthCredential,
  migrateLegacyOtpSecrets,
  readOtpSecret,
  storeOtpSecret,
} from "./auth-credentials";

function testEnv(db: D1Database = {} as D1Database): Env {
  return {
    DB: db,
    KV: {} as KVNamespace,
    STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ v3: "otp-encryption-fixture" }),
    STORE_CREDENTIALS_ACTIVE_KEY_VERSION: "v3",
  } as Env;
}

describe("TOTP credential storage", () => {
  it("round-trips encrypted seeds and reads transitional plaintext", async () => {
    const env = testEnv();
    const encrypted = await storeOtpSecret(env, "JBSWY3DPEHPK3PXP");
    expect(isEncryptedAuthCredential(encrypted)).toBe(true);
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    await expect(readOtpSecret(env, encrypted)).resolves.toBe("JBSWY3DPEHPK3PXP");
    await expect(readOtpSecret(env, "JBSWY3DPEHPK3PXP")).resolves.toBe("JBSWY3DPEHPK3PXP");
  });

  it("converges a legacy seed and clears it through a conditional update", async () => {
    const updates: FakeD1Call[] = [];
    const db = createFakeD1((call) => {
      if (call.op === "all" && call.sql.includes("FROM users")) {
        return [{ id: 7, otp_secret: "JBSWY3DPEHPK3PXP" }];
      }
      if (call.op === "run" && call.sql.includes("UPDATE users")) {
        updates.push(call);
        return true;
      }
      return undefined;
    });
    const env = testEnv(db);
    await expect(migrateLegacyOtpSecrets(env)).resolves.toBe(1);
    expect(updates).toHaveLength(1);
    expect(isEncryptedAuthCredential(updates[0].args[0])).toBe(true);
    expect(updates[0].args.slice(1)).toEqual([7, "JBSWY3DPEHPK3PXP"]);
  });
});
