import type { Env } from "../types";
import { failure } from "../http/errors";

const encoder = new TextEncoder();

export async function hashFlowUserId(
  env: Env,
  projectRef: string,
  userId: string,
): Promise<string> {
  const secret = env.FLOW_USER_HASH_KEY?.trim();
  if (!secret) {
    throw failure(
      "flows_encryption_unavailable",
      "Flows user encryption is not configured",
      503,
    );
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${projectRef}\n${userId}`),
  );
  return hex(new Uint8Array(signature));
}

export async function encryptFlowValue(
  env: Env,
  value: unknown,
): Promise<string> {
  const secret = env.FLOW_USER_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw failure(
      "flows_encryption_unavailable",
      "Flows user encryption is not configured",
      503,
    );
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function decryptFlowValue<T = unknown>(
  env: Env,
  ciphertext: string,
): Promise<T> {
  const parts = ciphertext.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw failure("flows_ciphertext_invalid", "Flows encrypted value is invalid", 500);
  }
  const keys = [
    env.FLOW_USER_ENCRYPTION_KEY?.trim(),
    env.FLOW_USER_ENCRYPTION_KEY_PREVIOUS?.trim(),
  ].filter((value): value is string => Boolean(value));
  for (const secret of keys) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
      const key = await crypto.subtle.importKey(
        "raw",
        digest,
        "AES-GCM",
        false,
        ["decrypt"],
      );
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64UrlDecode(parts[1]!) },
        key,
        base64UrlDecode(parts[2]!),
      );
      return JSON.parse(new TextDecoder().decode(decrypted)) as T;
    } catch {
      // Try the previous rotation key before returning a stable server error.
    }
  }
  throw failure(
    "flows_decryption_failed",
    "Flows encrypted value could not be decrypted",
    500,
  );
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
