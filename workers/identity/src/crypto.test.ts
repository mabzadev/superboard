import { beforeAll, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import { issueAccessToken, issueOpenGrowToken, publicJwks, verifyApplicationToken } from "./crypto";
import type { IdentityEnv } from "./types";

let env: IdentityEnv;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  const privateKey = await exportJWK(pair.privateKey);
  privateKey.kid = "identity-test-key";
  env = {
    IDENTITY_KEYSET: JSON.stringify({ active_kid: "identity-test-key", keys: [privateKey] }),
    OPENGROW_IDENTITY_ISSUER: "https://api.example.test",
    OPENGROW_IDENTITY_AUDIENCE: "opengrow",
    OPENGROW_IDENTITY_TOKEN_TTL: "300",
    APPLICATION_AUDIENCE: "example.application",
    ACCESS_TOKEN_TTL: "900",
  } as IdentityEnv;
});

describe("application identity keys", () => {
  it("never exposes private key material through JWKS", () => {
    expect(publicJwks(env).keys[0]).toMatchObject({ kid: "identity-test-key", alg: "ES256", use: "sig" });
    expect(publicJwks(env).keys[0]).not.toHaveProperty("d");
  });

  it("issues an application token only for the application audience", async () => {
    const token = await issueAccessToken(env, "user-1", "session-1");
    await expect(verifyApplicationToken(env, token)).resolves.toMatchObject({
      sub: "user-1",
      sid: "session-1",
      aud: "example.application",
      type: "application_access",
    });
  });

  it("issues short-lived OpenGrow exchange tokens with a distinct audience", async () => {
    const result = await issueOpenGrowToken(env, "user-1");
    expect(result.expires_in).toBe(300);
    await expect(verifyApplicationToken(env, result.access_token)).rejects.toThrow();
  });
});
