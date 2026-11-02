import type { ContentItem } from "../database/repositories/types.js";
import { encodeBase64, decodeBase64 } from "../utils/base64.js";

export function encodeRev(item: ContentItem): string {
	return encodeBase64(`${item.version}:${item.updatedAt}`);
}

export function decodeRev(rev: string): { version: number; updatedAt: string } | null {
	try {
		const decoded = decodeBase64(rev);
		const colonIdx = decoded.indexOf(":");
		if (colonIdx === -1) return null;

		const version = parseInt(decoded.slice(0, colonIdx), 10);
		const updatedAt = decoded.slice(colonIdx + 1);

		if (isNaN(version) || !updatedAt) return null;
		return { version, updatedAt };
	} catch {
		return null;
	}
}

export function validateRev(
	rev: string | undefined,
	item: ContentItem,
): { valid: true } | { valid: false; message: string } {
	if (!rev) return { valid: true };

	const decoded = decodeRev(rev);
	if (!decoded) {
		return { valid: false, message: "Malformed _rev token" };
	}

	if (decoded.version !== item.version || decoded.updatedAt !== item.updatedAt) {
		return {
			valid: false,
			message: "Content has been modified since last read (version conflict)",
		};
	}

	return { valid: true };
}
