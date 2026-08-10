import {
  SignJWT,
  createLocalJWKSet,
  createRemoteJWKSet,
  importJWK,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import type { IdentityEnv } from "./types";

type IdentityJwk = JsonWebKey & { kid: string; kty: "EC"; crv: "P-256"; d?: string };
type IdentityKeyset = { active_kid: string; keys: IdentityJwk[] };

const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function publicJwks(env: IdentityEnv): JSONWebKeySet {
  const keyset = parseKeyset(env.IDENTITY_KEYSET);
  return {
    keys: keyset.keys.map(({ d: _private, ...key }) => ({ ...key, alg: "ES256", use: "sig" })),
  };
}

export async function issueAccessToken(env: IdentityEnv, userId: string, sessionId: string): Promise<string> {
  return sign(env, {
    sub: userId,
    sid: sessionId,
    type: "application_access",
  }, env.APPLICATION_AUDIENCE, ttl(env.ACCESS_TOKEN_TTL, 300, 3600, "ACCESS_TOKEN_TTL"));
}

export async function issueOpenGrowToken(env: IdentityEnv, userId: string): Promise<{
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
}> {
  const expiresIn = ttl(env.OPENGROW_IDENTITY_TOKEN_TTL, 60, 900, "OPENGROW_IDENTITY_TOKEN_TTL");
  return {
    access_token: await sign(env, { sub: userId, type: "opengrow_identity" }, env.OPENGROW_IDENTITY_AUDIENCE, expiresIn),
    token_type: "Bearer",
    expires_in: expiresIn,
  };
}

export async function verifyApplicationToken(env: IdentityEnv, token: string): Promise<JWTPayload> {
  const verified = await jwtVerify(token, createLocalJWKSet(publicJwks(env)), {
    issuer: env.OPENGROW_IDENTITY_ISSUER,
    audience: env.APPLICATION_AUDIENCE,
    algorithms: ["ES256"],
  });
  if (verified.payload.type !== "application_access" || !verified.payload.sub || !verified.payload.sid) {
    throw new Error("application_token_invalid");
  }
  return verified.payload;
}

export async function verifyProviderToken(
  env: IdentityEnv,
  provider: "google" | "apple",
  token: string,
): Promise<JWTPayload> {
  const audiences = provider === "google"
    ? audienceList(env.GOOGLE_AUDIENCES_JSON)
    : audienceList(env.APPLE_AUDIENCES_JSON);
  if (audiences.length === 0) throw new Error(`${provider}_not_configured`);
  const url = provider === "google"
    ? "https://www.googleapis.com/oauth2/v3/certs"
    : "https://appleid.apple.com/auth/keys";
  let keys = remoteKeys.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
    remoteKeys.set(url, keys);
  }
  const verified = await jwtVerify(token, keys, {
    issuer: provider === "google"
      ? ["https://accounts.google.com", "accounts.google.com"]
      : "https://appleid.apple.com",
    audience: audiences,
    algorithms: ["RS256"],
  });
  if (!verified.payload.sub) throw new Error(`${provider}_subject_missing`);
  return verified.payload;
}

async function sign(
  env: IdentityEnv,
  payload: JWTPayload,
  audience: string,
  expiresIn: number,
): Promise<string> {
  const keyset = parseKeyset(env.IDENTITY_KEYSET);
  const signing = keyset.keys.find((key) => key.kid === keyset.active_kid && key.d);
  if (!signing) throw new Error("identity_active_key_missing");
  const key = await importJWK(signing, "ES256");
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", typ: "JWT", kid: signing.kid })
    .setIssuer(env.OPENGROW_IDENTITY_ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) - 5)
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .setJti(crypto.randomUUID())
    .sign(key);
}

function parseKeyset(serialized: string): IdentityKeyset {
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("identity_keyset_invalid_json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("identity_keyset_invalid");
  const record = parsed as Record<string, unknown>;
  if (typeof record.active_kid !== "string" || !Array.isArray(record.keys)) throw new Error("identity_keyset_invalid");
  const keys = record.keys.filter((value): value is IdentityJwk => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const key = value as Record<string, unknown>;
    return key.kty === "EC" && key.crv === "P-256" && typeof key.kid === "string" &&
      typeof key.x === "string" && typeof key.y === "string";
  });
  if (keys.length !== record.keys.length || !keys.some((key) => key.kid === record.active_kid && key.d)) {
    throw new Error("identity_keyset_invalid");
  }
  return { active_kid: record.active_kid, keys };
}

function audienceList(serialized: string): string[] {
  try {
    const value = JSON.parse(serialized);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.length >= 3)
      : [];
  } catch { return []; }
}

export function ttl(value: string, minimum: number, maximum: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name}_invalid`);
  return parsed;
}
