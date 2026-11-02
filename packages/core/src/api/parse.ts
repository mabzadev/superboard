import { z } from "zod";

import { apiError } from "./error.js";

const MAX_BODY_SIZE = 10 * 1024 * 1024;

export type ParseResult<T> = T | Response;

export async function parseBody<T extends z.ZodType>(
	request: Request,
	schema: T,
): Promise<ParseResult<z.infer<T>>> {
	const contentLength = request.headers.get("Content-Length");
	if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
		return apiError("PAYLOAD_TOO_LARGE", "Request body too large", 413);
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
	}

	return validate(schema, raw);
}

export async function parseOptionalBody<T extends z.ZodType>(
	request: Request,
	schema: T,
	defaultValue: z.infer<T>,
): Promise<ParseResult<z.infer<T>>> {
	const contentLength = request.headers.get("Content-Length");
	if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
		return apiError("PAYLOAD_TOO_LARGE", "Request body too large", 413);
	}

	let text: string;
	try {
		text = await request.text();
	} catch {
		return defaultValue;
	}

	if (!text.trim()) {
		return defaultValue;
	}

	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
	}

	return validate(schema, raw);
}

export function parseQuery<T extends z.ZodType>(url: URL, schema: T): ParseResult<z.infer<T>> {
	const raw: Record<string, string> = {};
	for (const [key, value] of url.searchParams) {
		raw[key] = value;
	}
	return validate(schema, raw);
}

function validate<T extends z.ZodType>(schema: T, data: unknown): ParseResult<z.infer<T>> {
	const result = schema.safeParse(data);

	if (result.success) {
		return result.data;
	}

	const issues = result.error.issues.map((issue: z.ZodIssue) => ({
		path: issue.path.join("."),
		message: issue.message,
	}));

	return apiError("VALIDATION_ERROR", "Invalid request data", 400, { issues });
}

export function isParseError<T>(result: ParseResult<T>): result is Response {
	return result instanceof Response;
}
