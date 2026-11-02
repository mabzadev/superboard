export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const boundFetch: typeof fetch = globalThis.fetch.bind(globalThis);

export function parseSignatureMetadataCid(signatureMetadata: string | null): string | null {
	if (signatureMetadata === null) return null;
	try {
		const parsed: unknown = JSON.parse(signatureMetadata);
		if (isPlainObject(parsed) && typeof parsed["cid"] === "string") return parsed["cid"];
	} catch {}
	return null;
}
