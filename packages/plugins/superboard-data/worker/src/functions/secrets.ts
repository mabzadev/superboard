import type { DataEnv } from "../platform/env.js";
import { DataError, base64UrlDecode, base64UrlEncode } from "../platform/http.js";

const keys = new Map<string, Promise<CryptoKey>>();

export function secretsAvailable(env: DataEnv): boolean {
	return typeof env.DATA_ENCRYPTION_KEY === "string" && env.DATA_ENCRYPTION_KEY.length >= 32;
}

export async function encryptSecrets(
	env: DataEnv,
	secrets: Record<string, string>,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(env),
		new TextEncoder().encode(JSON.stringify(secrets)),
	);
	const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.byteLength);
	return base64UrlEncode(combined);
}

export async function decryptSecrets(
	env: DataEnv,
	value: string | null,
): Promise<Record<string, string>> {
	if (!value) return {};
	const combined = base64UrlDecode(value);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: combined.slice(0, 12) },
		await encryptionKey(env),
		combined.slice(12),
	);
	return JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, string>;
}

function encryptionKey(env: DataEnv): Promise<CryptoKey> {
	const secret = env.DATA_ENCRYPTION_KEY;
	if (!secret || !secretsAvailable(env))
		throw new DataError(503, "secrets_unavailable", "DATA_ENCRYPTION_KEY is not configured");
	let key = keys.get(secret);
	if (!key) {
		if (keys.size >= 4) keys.clear();
		key = crypto.subtle
			.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"])
			.then((material) =>
				crypto.subtle.deriveKey(
					{
						name: "HKDF",
						hash: "SHA-256",
						salt: new TextEncoder().encode("superboard-data"),
						info: new TextEncoder().encode("function-secrets-v1"),
					},
					material,
					{ name: "AES-GCM", length: 256 },
					false,
					["encrypt", "decrypt"],
				),
			);
		keys.set(secret, key);
	}
	return key;
}
