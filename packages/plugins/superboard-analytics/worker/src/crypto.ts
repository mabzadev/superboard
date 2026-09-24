import {
  stableAnalyticsJson,
  type AnalyticsEventV1,
} from "@superboard/contracts/analytics";
import { configuredSecrets } from "@superboard/contracts/secret";
import { httpError } from "./http";
import type { Env, IdentityKind, StoredAnalyticsEventV1 } from "./types";

const encoder = new TextEncoder();

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hex(new Uint8Array(bytes));
}

export function analyticsPayloadHash(event: AnalyticsEventV1): Promise<string> {
  return sha256Hex(stableAnalyticsJson(event));
}

export async function pseudonymizeEvent(
  env: Pick<Env, "ANALYTICS_ID_HASH_KEY" | "ANALYTICS_ID_HASH_KEY_PREVIOUS">,
  projectId: string,
  event: AnalyticsEventV1,
): Promise<StoredAnalyticsEventV1> {
  const secrets = configuredSecrets(
    env.ANALYTICS_ID_HASH_KEY,
    env.ANALYTICS_ID_HASH_KEY_PREVIOUS,
  );
  if (secrets.length === 0) {
    throw httpError(
      "analytics_hash_key_missing",
      "Analytics identity hashing is not configured",
      503,
    );
  }
  const identities: Array<[IdentityKind, keyof AnalyticsEventV1]> = [
    ["app_instance", "app_instance_id"],
    ["session", "session_id"],
    ["anonymous", "anonymous_id"],
    ["user", "user_id"],
  ];
  const identityHashes: StoredAnalyticsEventV1["identity_hashes"] = {};
  const normalized: AnalyticsEventV1 = { ...event };
  for (const [kind, field] of identities) {
    const raw = event[field];
    if (typeof raw !== "string" || !raw) continue;
    const candidates = await Promise.all(
      secrets.map((secret) => hmacHex(secret, `${projectId}:${kind}:${raw}`)),
    );
    identityHashes[kind] = candidates;
    Object.assign(normalized, { [field]: candidates[0] });
  }
  return { event: normalized, identity_hashes: identityHashes };
}

export async function identityHashCandidates(
  env: Pick<Env, "ANALYTICS_ID_HASH_KEY" | "ANALYTICS_ID_HASH_KEY_PREVIOUS">,
  projectId: string,
  kind: Exclude<IdentityKind, "session">,
  raw: string,
): Promise<string[]> {
  const secrets = configuredSecrets(
    env.ANALYTICS_ID_HASH_KEY,
    env.ANALYTICS_ID_HASH_KEY_PREVIOUS,
  );
  if (secrets.length === 0) {
    throw httpError(
      "analytics_hash_key_missing",
      "Analytics identity hashing is not configured",
      503,
    );
  }
  return Promise.all(
    secrets.map((secret) => hmacHex(secret, `${projectId}:${kind}:${raw}`)),
  );
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return hex(new Uint8Array(bytes));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
