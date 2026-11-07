import { configuredSecrets } from "@superboard/contracts/secret";

import type { DataEnv } from "./env.js";
import { base64UrlDecode, base64UrlEncode } from "./http.js";

const keys = new Map<string, Promise<CryptoKey>>();

export async function signToken(env: DataEnv, purpose: string, payload: object): Promise<string> {
	const secret = env.FILES_DOWNLOAD_SIGNING_KEY;
	if (!secret) throw new Error("FILES_DOWNLOAD_SIGNING_KEY_missing");
	const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
	const signature = await crypto.subtle.sign(
		"HMAC",
		await key(secret),
		new TextEncoder().encode(`${purpose}.${body}`),
	);
	return `${body}.${base64UrlEncode(signature)}`;
}

export async function verifyToken<T extends { e: number }>(
	env: DataEnv,
	purpose: string,
	token: string,
	maximumLifetimeSeconds: number,
): Promise<T | null> {
	if (token.length > 4_096) return null;
	const [body, signature, extra] = token.split(".");
	if (!body || !signature || extra !== undefined) return null;
	let parsed: T;
	let signatureBytes: Uint8Array<ArrayBuffer>;
	try {
		signatureBytes = base64UrlDecode(signature);
		parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as T;
	} catch {
		return null;
	}
	const message = new TextEncoder().encode(`${purpose}.${body}`);
	const candidates = configuredSecrets(
		env.FILES_DOWNLOAD_SIGNING_KEY,
		env.FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS,
	);
	let valid = false;
	for (const secret of candidates)
		if (await crypto.subtle.verify("HMAC", await key(secret), signatureBytes, message))
			valid = true;
	const now = Math.floor(Date.now() / 1000);
	if (
		!valid ||
		typeof parsed !== "object" ||
		parsed === null ||
		!Number.isSafeInteger(parsed.e) ||
		parsed.e <= now ||
		parsed.e > now + maximumLifetimeSeconds
	)
		return null;
	return parsed;
}

function key(secret: string): Promise<CryptoKey> {
	let value = keys.get(secret);
	if (!value) {
		if (keys.size >= 8) keys.clear();
		value = crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		);
		keys.set(secret, value);
	}
	return value;
}

export function publicOrigin(env: DataEnv): string {
	return `${new URL(env.DATA_PUBLIC_ORIGIN || env.FILES_PUBLIC_ORIGIN).origin}/v1/data`;
}
