import { RequestBodyError, readJsonLimited } from "@superboard/contracts/request-body";

export class DataError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "DataError";
	}
}

export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
	const response = Response.json(value, { status });
	response.headers.set("cache-control", "no-store");
	response.headers.set("x-content-type-options", "nosniff");
	if (headers)
		for (const [name, header] of new Headers(headers)) response.headers.set(name, header);
	return response;
}

export function failure(cause: unknown, scope: string): Response {
	if (cause instanceof DataError)
		return json(
			{
				error: {
					code: cause.code,
					message: cause.message,
					retryable: cause.status >= 500,
					...(cause.details ? { details: cause.details } : {}),
				},
			},
			cause.status,
		);
	if (cause instanceof RequestBodyError)
		return json(
			{ error: { code: cause.code, message: cause.message, retryable: false } },
			cause.status,
		);
	console.error(
		JSON.stringify({
			event: "data_worker_error",
			scope,
			error: cause instanceof Error ? cause.message : String(cause),
		}),
	);
	return json(
		{ error: { code: "data_internal_error", message: "Data service failed", retryable: true } },
		500,
	);
}

export async function readJsonBody(request: Request, maxBytes = 1_048_576): Promise<unknown> {
	return readJsonLimited(request, maxBytes);
}

export async function readJsonObject(
	request: Request,
	maxBytes = 1_048_576,
): Promise<Record<string, unknown>> {
	const value = await readJsonBody(request, maxBytes);
	if (!isRecord(value))
		throw new DataError(422, "body_invalid", "Request body must be a JSON object");
	return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function boundedInteger(
	value: string | null | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
	code = "parameter_invalid",
): number {
	const candidate = value == null || value === "" ? fallback : Number(value);
	if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum)
		throw new DataError(422, code, `Value must be an integer between ${minimum} and ${maximum}`);
	return candidate;
}

export function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]*$/u.test(value))
		throw new DataError(400, "encoding_invalid", "Invalid encoding");
	const padded = value
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(value.length / 4) * 4, "=");
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
	const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
	return new Date().toISOString();
}
