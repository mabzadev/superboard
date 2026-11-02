import { encodeBase64url, decodeBase64url } from "../utils/base64.js";

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

export interface PreviewTokenPayload {
	cid: string;
	exp: number;
	iat: number;
}

export interface GeneratePreviewTokenOptions {
	contentId: string;
	expiresIn?: string | number;
	secret: string;
}

function parseDuration(duration: string | number): number {
	if (typeof duration === "number") {
		return duration;
	}

	const match = duration.match(DURATION_PATTERN);
	if (!match) {
		throw new Error(
			`Invalid duration format: "${duration}". Use "1h", "30m", "1d", "2w", or seconds.`,
		);
	}

	const value = parseInt(match[1], 10);
	const unit = match[2];

	switch (unit) {
		case "s":
			return value;
		case "m":
			return value * 60;
		case "h":
			return value * 60 * 60;
		case "d":
			return value * 60 * 60 * 24;
		case "w":
			return value * 60 * 60 * 24 * 7;
		default:
			throw new Error(`Unknown duration unit: ${unit}`);
	}
}

async function createSignature(data: string, secret: string): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
	return new Uint8Array(signature);
}

async function verifySignature(
	data: string,
	signature: Uint8Array,
	secret: string,
): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	const sigBuffer: ArrayBuffer = new ArrayBuffer(signature.byteLength);
	new Uint8Array(sigBuffer).set(signature);
	return crypto.subtle.verify("HMAC", key, sigBuffer, encoder.encode(data));
}

export async function generatePreviewToken(options: GeneratePreviewTokenOptions): Promise<string> {
	const { contentId, expiresIn = "1h", secret } = options;

	if (!secret) {
		throw new Error("Preview secret is required");
	}

	if (!contentId || !contentId.includes(":")) {
		throw new Error('Content ID must be in format "collection:id"');
	}

	const now = Math.floor(Date.now() / 1000);
	const duration = parseDuration(expiresIn);

	const payload: PreviewTokenPayload = {
		cid: contentId,
		exp: now + duration,
		iat: now,
	};

	const payloadJson = JSON.stringify(payload);
	const encodedPayload = encodeBase64url(new TextEncoder().encode(payloadJson));

	const signature = await createSignature(encodedPayload, secret);
	const encodedSignature = encodeBase64url(signature);

	return `${encodedPayload}.${encodedSignature}`;
}

export type VerifyPreviewTokenResult =
	| { valid: true; payload: PreviewTokenPayload }
	| { valid: false; error: "invalid" | "expired" | "malformed" | "none" };

export type VerifyPreviewTokenOptions = {
	secret: string;
} & (
	| { url: URL }
	| {
			token: string | null | undefined;
	  }
);

export async function verifyPreviewToken(
	options: VerifyPreviewTokenOptions,
): Promise<VerifyPreviewTokenResult> {
	const { secret } = options;

	if (!secret) {
		throw new Error("Preview secret is required");
	}

	const token = "url" in options ? options.url.searchParams.get("_preview") : options.token;

	if (!token) {
		return { valid: false, error: "none" };
	}

	const parts = token.split(".");
	if (parts.length !== 2) {
		return { valid: false, error: "malformed" };
	}

	const [encodedPayload, encodedSignature] = parts;

	let signature: Uint8Array;
	try {
		signature = decodeBase64url(encodedSignature);
	} catch {
		return { valid: false, error: "malformed" };
	}

	const isValid = await verifySignature(encodedPayload, signature, secret);
	if (!isValid) {
		return { valid: false, error: "invalid" };
	}

	let payload: PreviewTokenPayload;
	try {
		const payloadBytes = decodeBase64url(encodedPayload);
		const payloadJson = new TextDecoder().decode(payloadBytes);
		payload = JSON.parse(payloadJson);
	} catch {
		return { valid: false, error: "malformed" };
	}

	if (
		typeof payload.cid !== "string" ||
		typeof payload.exp !== "number" ||
		typeof payload.iat !== "number"
	) {
		return { valid: false, error: "malformed" };
	}

	const now = Math.floor(Date.now() / 1000);
	if (payload.exp < now) {
		return { valid: false, error: "expired" };
	}

	return { valid: true, payload };
}

export function parseContentId(contentId: string): {
	collection: string;
	id: string;
} {
	const colonIndex = contentId.indexOf(":");
	if (colonIndex === -1) {
		throw new Error('Content ID must be in format "collection:id"');
	}
	return {
		collection: contentId.slice(0, colonIndex),
		id: contentId.slice(colonIndex + 1),
	};
}
