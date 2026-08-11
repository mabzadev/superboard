import { describe, expect, it } from "vitest";
import { createFakeD1, type FakeD1Call } from "../test/fake-d1";
import type { Env } from "../types";
import { decryptCredential } from "./secrets";
import { migrateLegacyPushCredentials } from "./push-credentials";

function envWith(rows: Record<string, Array<Record<string, unknown>>>) {
  const updates: FakeD1Call[] = [];
  const db = createFakeD1((call) => {
    if (call.op === "all" && call.sql.includes("FROM ios_push_configurations")) return rows.ios || [];
    if (call.op === "all" && call.sql.includes("FROM android_push_configurations")) return rows.android || [];
    if (call.op === "all" && call.sql.includes("apn_key AS cleartext")) return rows.apns || [];
    if (call.op === "all" && call.sql.includes("json_key AS cleartext")) return rows.fcm || [];
    if (call.op === "all" && call.sql.includes("encrypted_legacy_credentials")) return rows.legacy || [];
    if (call.op === "run" && call.sql.includes("UPDATE")) {
      updates.push(call);
      return true;
    }
    return undefined;
  });
  const env = {
    DB: db,
    KV: {} as KVNamespace,
    ENVIRONMENT: "test",
    STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ v7: "push-migration-test-material" }),
    STORE_CREDENTIALS_ACTIVE_KEY_VERSION: "v7",
  } as Env;
  return { env, updates };
}

describe("legacy push credential migration", () => {
  it("encrypts all supported legacy credential locations and clears plaintext atomically", async () => {
    const { env, updates } = envWith({
      ios: [{ id: "ios-1", cleartext: "clear-ios-fixture" }],
      android: [{ id: "android-1", cleartext: '{"credential":"clear-android-fixture"}' }],
      apns: [{ id: "apns-1", cleartext: "clear-apns-fixture" }],
      fcm: [{ id: "fcm-1", cleartext: '{"credential":"clear-rpush-fixture"}' }],
      legacy: [{
        id: "legacy-1",
        certificate: "clear-certificate-fixture",
        password: "clear-password-fixture",
        auth_key: "clear-auth-fixture",
        client_secret: "clear-client-fixture",
      }],
    });

    await expect(migrateLegacyPushCredentials(env)).resolves.toEqual({
      iosConfigurations: 1,
      androidConfigurations: 1,
      rpushApns: 1,
      rpushFcm: 1,
      rpushLegacy: 1,
    });
    expect(updates).toHaveLength(5);
    expect(updates.every((update) => update.sql.includes("= NULL"))).toBe(true);
    const cleartexts = await Promise.all(updates.map((update) =>
      decryptCredential(env, String(update.args[0])),
    ));
    expect(cleartexts).toEqual([
      "clear-ios-fixture",
      '{"credential":"clear-android-fixture"}',
      "clear-apns-fixture",
      '{"credential":"clear-rpush-fixture"}',
      JSON.stringify({
        certificate: "clear-certificate-fixture",
        password: "clear-password-fixture",
        authKey: "clear-auth-fixture",
        clientSecret: "clear-client-fixture",
      }),
    ]);
  });

  it("does not require encryption material when no legacy plaintext remains", async () => {
    const { env } = envWith({});
    delete env.STORE_CREDENTIALS_ENCRYPTION_KEYS;
    delete env.STORE_CREDENTIALS_ACTIVE_KEY_VERSION;

    await expect(migrateLegacyPushCredentials(env)).resolves.toEqual({
      iosConfigurations: 0,
      androidConfigurations: 0,
      rpushApns: 0,
      rpushFcm: 0,
      rpushLegacy: 0,
    });
  });
});
