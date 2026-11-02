import { hmac } from "@oslojs/crypto/hmac";
import { sha256, SHA256 } from "@oslojs/crypto/sha2";
import { constantTimeEqual } from "@oslojs/crypto/subtle";
import { encodeBase64urlNoPadding, decodeBase64urlIgnorePadding } from "@oslojs/encoding";

const TOKEN_BYTES = 32;

export const TOKEN_PREFIXES = {
	PAT: "ec_pat_",
	OAUTH_ACCESS: "ec_oat_",
	OAUTH_REFRESH: "ec_ort_",
} as const;

export const VALID_SCOPES = [
	"content:read",
	"content:write",
	"media:read",
	"media:write",
	"schema:read",
	"schema:write",
	"taxonomies:manage",
	"menus:manage",
	"settings:read",
	"settings:manage",
	"mcp:tools",
	"admin",
] as const;

export type ApiTokenScope = (typeof VALID_SCOPES)[number] | `mcp:tools:${string}`;

const PLUGIN_MCP_SCOPE_PATTERN = /^mcp:tools:[a-z][a-z0-9_-]*$/;

export function isValidScope(scope: string): scope is ApiTokenScope {
	return (
		(VALID_SCOPES as readonly string[]).includes(scope) || PLUGIN_MCP_SCOPE_PATTERN.test(scope)
	);
}

export function validateScopes(scopes: string[]): string[] {
	return scopes.filter((scope) => !isValidScope(scope));
}

const IMPLICIT_SCOPE_GRANTS = new Map<string, readonly string[]>([
	["content:write", ["menus:manage", "taxonomies:manage"]],
]);

export function hasScope(scopes: string[], required: string): boolean {
	if (required === "mcp:tools" || required.startsWith("mcp:tools:")) {
		return scopes.includes("mcp:tools") || scopes.includes(required);
	}
	if (scopes.includes("admin")) return true;
	if (scopes.includes(required)) return true;
	for (const held of scopes) {
		const granted = IMPLICIT_SCOPE_GRANTS.get(held);
		if (granted?.includes(required)) return true;
	}
	return false;
}

export function generateToken(): string {
	const bytes = new Uint8Array(TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	return encodeBase64urlNoPadding(bytes);
}

export function hashToken(token: string): string {
	const bytes = decodeBase64urlIgnorePadding(token);
	const hash = sha256(bytes);
	return encodeBase64urlNoPadding(hash);
}

export function generateTokenWithHash(): { token: string; hash: string } {
	const token = generateToken();
	const hash = hashToken(token);
	return { token, hash };
}

export function generateSessionId(): string {
	const bytes = new Uint8Array(20);
	crypto.getRandomValues(bytes);
	return encodeBase64urlNoPadding(bytes);
}

export function generateAuthSecret(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return encodeBase64urlNoPadding(bytes);
}

export function generatePrefixedToken(prefix: string): {
	raw: string;
	hash: string;
	prefix: string;
} {
	const bytes = new Uint8Array(TOKEN_BYTES);
	crypto.getRandomValues(bytes);

	const encoded = encodeBase64urlNoPadding(bytes);
	const raw = `${prefix}${encoded}`;
	const hash = hashPrefixedToken(raw);

	const displayPrefix = raw.slice(0, prefix.length + 4);

	return { raw, hash, prefix: displayPrefix };
}

export function hashPrefixedToken(token: string): string {
	const bytes = new TextEncoder().encode(token);
	const hash = sha256(bytes);
	return encodeBase64urlNoPadding(hash);
}

export function computeS256Challenge(codeVerifier: string): string {
	const hash = sha256(new TextEncoder().encode(codeVerifier));
	return encodeBase64urlNoPadding(hash);
}

export function secureCompare(a: string, b: string): boolean {
	const text = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
	const hash = (str: string) => hmac(SHA256, salt, text.encode(str));

	return constantTimeEqual(hash(a), hash(b));
}

const ALGORITHM = "AES-GCM";
const IV_BYTES = 12;

async function deriveKey(secret: string): Promise<CryptoKey> {
	const decoded = decodeBase64urlIgnorePadding(secret);
	const buffer = new Uint8Array(decoded).buffer;
	const keyMaterial = await crypto.subtle.importKey("raw", buffer, "PBKDF2", false, ["deriveKey"]);

	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: new TextEncoder().encode("emdash-auth-v1"),
			iterations: 100000,
			hash: "SHA-256",
		},
		keyMaterial,
		{ name: ALGORITHM, length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function encrypt(plaintext: string, secret: string): Promise<string> {
	const key = await deriveKey(secret);
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const encoded = new TextEncoder().encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

	const combined = new Uint8Array(iv.length + ciphertext.byteLength);
	combined.set(iv);
	combined.set(new Uint8Array(ciphertext), iv.length);

	return encodeBase64urlNoPadding(combined);
}

export async function decrypt(encrypted: string, secret: string): Promise<string> {
	const key = await deriveKey(secret);
	const combined = decodeBase64urlIgnorePadding(encrypted);

	const iv = combined.slice(0, IV_BYTES);
	const ciphertext = combined.slice(IV_BYTES);

	const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

	return new TextDecoder().decode(decrypted);
}
