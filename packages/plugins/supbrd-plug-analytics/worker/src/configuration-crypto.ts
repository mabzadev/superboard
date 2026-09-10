import { stableAnalyticsJson } from "@superboard/contracts/analytics";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encryptAnalyticsConfiguration(
  secret: string,
  value: unknown,
): Promise<string> {
  const key = await encryptionKey(secret, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(stableAnalyticsJson(value)),
    ),
  );
  return `v1.${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decryptAnalyticsConfiguration<T>(
  secret: string,
  value: string,
): Promise<T> {
  const [version, encodedIv, encodedCiphertext, ...remainder] =
    value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedCiphertext ||
    remainder.length > 0
  ) {
    throw new Error("Unsupported analytics configuration ciphertext");
  }
  const key = await encryptionKey(secret, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64Url(encodedIv) },
    key,
    fromBase64Url(encodedCiphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function signAnalyticsWebhook(
  secret: string,
  body: string,
): Promise<string> {
  if (!secret.trim()) throw new Error("Analytics webhook secret is empty");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  return `sha256=${hex(signature)}`;
}

async function encryptionKey(
  secret: string,
  usage: Array<"encrypt" | "decrypt">,
): Promise<CryptoKey> {
  if (!secret.trim()) {
    throw new Error("Analytics configuration encryption key is missing");
  }
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, usage);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(`${normalized}${padding}`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
