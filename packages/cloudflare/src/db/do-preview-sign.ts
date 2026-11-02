const HEX_PATTERN = /^[0-9a-f]+$/;

async function hmacSign(message: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const buffer = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
	return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signPreviewUrl(
	previewBase: string,
	source: string,
	secret: string,
	ttl = 3600,
): Promise<string> {
	const exp = Math.floor(Date.now() / 1000) + ttl;
	const sig = await hmacSign(`${source}:${exp}`, secret);

	const url = new URL(previewBase);
	url.searchParams.set("source", source);
	url.searchParams.set("exp", String(exp));
	url.searchParams.set("sig", sig);

	return url.toString();
}

export async function verifyPreviewSignature(
	source: string,
	exp: number,
	sig: string,
	secret: string,
): Promise<boolean> {
	if (sig.length !== 64 || !HEX_PATTERN.test(sig)) return false;
	const sigBytes = new Uint8Array(32);
	for (let i = 0; i < 64; i += 2) {
		sigBytes[i / 2] = parseInt(sig.substring(i, i + 2), 16);
	}

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);

	return crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(`${source}:${exp}`));
}
