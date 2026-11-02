export const MAX_CONTENT_HASH_BYTES = 8 * 1024 * 1024;

function formatContentHash(hash: Uint8Array): string {
	const hashHex = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `sha1:${hashHex}`;
}

export async function hashString(content: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join(
		"",
	);
}

export async function computeContentHash(content: Uint8Array | ArrayBuffer): Promise<string> {
	let buf: ArrayBuffer;
	if (content instanceof ArrayBuffer) {
		buf = content;
	} else if (
		content.buffer instanceof ArrayBuffer &&
		content.byteOffset === 0 &&
		content.byteLength === content.buffer.byteLength
	) {
		buf = content.buffer;
	} else {
		buf = new ArrayBuffer(content.byteLength);
		new Uint8Array(buf).set(content);
	}
	const hashBuffer = await crypto.subtle.digest("SHA-1", buf);
	return formatContentHash(new Uint8Array(hashBuffer));
}
