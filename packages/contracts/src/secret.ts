export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const subtle = crypto.subtle as SubtleCrypto & {
		timingSafeEqual?: (left: ArrayBuffer, right: ArrayBuffer) => boolean;
	};
	const [leftDigest, rightDigest] = await Promise.all([
		subtle.digest("SHA-256", encoder.encode(left)),
		subtle.digest("SHA-256", encoder.encode(right)),
	]);
	if (typeof subtle.timingSafeEqual === "function") {
		return subtle.timingSafeEqual.call(subtle, leftDigest, rightDigest);
	}

	const comparisonKey = await subtle.importKey(
		"raw",
		encoder.encode("superboard-timing-safe-compare-v1"),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
	const signature = await subtle.sign("HMAC", comparisonKey, leftDigest);
	return subtle.verify("HMAC", comparisonKey, signature, rightDigest);
}

export type SecretCandidates = string | readonly (string | null | undefined)[];

export function configuredSecrets(...values: readonly (string | null | undefined)[]): string[] {
	return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

export async function matchesAnySecret(
	provided: string,
	candidates: SecretCandidates,
): Promise<boolean> {
	if (!provided) return false;
	const values =
		typeof candidates === "string"
			? configuredSecrets(candidates)
			: configuredSecrets(...candidates);
	if (values.length === 0) return false;
	const matches = await Promise.all(
		values.map((candidate) => constantTimeEqual(provided, candidate)),
	);
	return matches.some(Boolean);
}
