const hasNative =
	typeof Uint8Array.prototype.toBase64 === "function" &&
	typeof Uint8Array.fromBase64 === "function";

const BASE64_PLUS_PATTERN = /\+/g;
const BASE64_SLASH_PATTERN = /\//g;
const BASE64_PADDING_PATTERN = /=+$/;
const BASE64URL_DASH_PATTERN = /-/g;
const BASE64URL_UNDERSCORE_PATTERN = /_/g;

export function encodeBase64(str: string): string {
	const bytes = new TextEncoder().encode(str);
	if (hasNative) return bytes.toBase64();
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export function decodeBase64(base64: string): string {
	return new TextDecoder().decode(decodeBase64Bytes(base64));
}

export function decodeBase64Bytes(base64: string): Uint8Array {
	if (hasNative) return Uint8Array.fromBase64(base64);
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function encodeBase64url(bytes: Uint8Array): string {
	if (hasNative) return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary)
		.replace(BASE64_PLUS_PATTERN, "-")
		.replace(BASE64_SLASH_PATTERN, "_")
		.replace(BASE64_PADDING_PATTERN, "");
}

export function decodeBase64url(encoded: string): Uint8Array {
	if (hasNative) return Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
	const base64 = encoded
		.replace(BASE64URL_DASH_PATTERN, "+")
		.replace(BASE64URL_UNDERSCORE_PATTERN, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}
