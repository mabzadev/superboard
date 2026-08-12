import { configuredSecrets } from "@superboard/contracts/secret";
import type { Env } from "./types";

const encoder = new TextEncoder();

export async function marketingIdentityHashCandidates(
  env: Pick<Env, "ANALYTICS_ID_HASH_KEY" | "ANALYTICS_ID_HASH_KEY_PREVIOUS">,
  projectId: number,
  kind: "user" | "anonymous" | "instance",
  raw: string,
): Promise<string[]> {
  const secrets = configuredSecrets(
    env.ANALYTICS_ID_HASH_KEY,
    env.ANALYTICS_ID_HASH_KEY_PREVIOUS,
  );
  if (!secrets.length) throw new Error("Marketing identity hashing is not configured");
  return Promise.all(
    secrets.map((secret) =>
      hmacHex(secret, `${projectId}:${kind}:${raw}`),
    ),
  );
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
