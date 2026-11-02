import { InvalidCursorError } from "../database/repositories/types.js";
import { mapErrorStatus } from "./errors.js";
import type { ApiResult } from "./types.js";

export * from "./errors.js";

const API_CACHE_HEADERS: HeadersInit = {
	"Cache-Control": "private, no-store",
};

export function apiError(
	code: string,
	message: string,
	status: number,
	details?: Record<string, unknown>,
): Response {
	const error: { code: string; message: string; details?: Record<string, unknown> } = {
		code,
		message,
	};
	if (details !== undefined) error.details = details;
	return Response.json({ success: false, error }, { status, headers: API_CACHE_HEADERS });
}

export function apiSuccess<T>(data: T, status = 200): Response {
	return Response.json({ success: true, data }, { status, headers: API_CACHE_HEADERS });
}

export function handleError(
	error: unknown,
	fallbackMessage: string,
	fallbackCode: string,
): Response {
	if (error instanceof InvalidCursorError) {
		return apiError("INVALID_CURSOR", error.message, 400);
	}
	console.error(`[${fallbackCode}]`, error);
	return apiError(fallbackCode, fallbackMessage, 500);
}

export function requireInit(emdash: unknown): Response | null {
	if (!emdash || typeof emdash !== "object") {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	return null;
}

export function requireDb(db: unknown): Response | null {
	if (!db) {
		return apiError("NOT_CONFIGURED", "EmDash is not initialized", 500);
	}
	return null;
}

export function unwrapResult<T>(result: ApiResult<T>, successStatus = 200): Response {
	if (!result.success) {
		return apiError(
			result.error.code,
			result.error.message,
			mapErrorStatus(result.error.code),
			result.error.details,
		);
	}
	return apiSuccess(result.data, successStatus);
}
