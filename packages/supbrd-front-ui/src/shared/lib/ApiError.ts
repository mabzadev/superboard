export class ApiError extends Error {
	constructor(
		message: string,
		public status: number,
		public code?: string,
		public data?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export function parseApiErrorPayload(data: unknown): {
	message?: string;
	code?: string;
} {
	if (!data || typeof data !== "object" || Array.isArray(data)) return {};

	const payload = data as Record<string, unknown>;
	if (typeof payload.error === "string") {
		return {
			message: payload.error,
			code: typeof payload.code === "string" ? payload.code : undefined,
		};
	}

	if (payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
		const nested = payload.error as Record<string, unknown>;
		return {
			message:
				typeof nested.message === "string"
					? nested.message
					: typeof payload.message === "string"
						? payload.message
						: undefined,
			code:
				typeof nested.code === "string"
					? nested.code
					: typeof payload.code === "string"
						? payload.code
						: undefined,
		};
	}

	return {
		message: typeof payload.message === "string" ? payload.message : undefined,
		code: typeof payload.code === "string" ? payload.code : undefined,
	};
}

const USER_FRIENDLY_MESSAGES: Record<number, string> = {
	400: "Invalid request. Please check your input.",
	401: "Authentication is required to perform this action.",
	403: "You don't have permission to perform this action.",
	404: "The requested resource was not found.",
	409: "This action conflicts with the current state.",
	422: "The provided data is invalid.",
	429: "Too many requests. Please try again later.",
};

export function getErrorMessage(status: number): string {
	if (status >= 500) return "Server error. Please try again later.";
	return USER_FRIENDLY_MESSAGES[status] ?? "An unexpected error occurred.";
}

const CODE_STATUSES: Record<string, number> = {
	BAD_REQUEST: 400,
	INVALID_REQUEST: 400,
	INVALID_JSON: 400,
	MISSING_PARAM: 400,
	UNAUTHORIZED: 401,
	UNAUTHENTICATED: 401,
	NOT_AUTHENTICATED: 401,
	FORBIDDEN: 403,
	ACCESS_DENIED: 403,
	PERMISSION_DENIED: 403,
	INSUFFICIENT_ROLE: 403,
	CSRF_REJECTED: 403,
	NOT_FOUND: 404,
	CONFLICT: 409,
	ALREADY_EXISTS: 409,
	VALIDATION_ERROR: 422,
	INVALID_INPUT: 422,
	RATE_LIMITED: 429,
	TOO_MANY_REQUESTS: 429,
	INTERNAL_ERROR: 500,
	INTERNAL_SERVER_ERROR: 500,
	SERVICE_UNAVAILABLE: 503,
};

function statusForCode(code: string): number | undefined {
	const normalized = code.toUpperCase();
	if (Object.hasOwn(CODE_STATUSES, normalized)) return CODE_STATUSES[normalized];
	if (normalized.endsWith("_NOT_FOUND")) return 404;
	if (normalized.endsWith("_CONFLICT")) return 409;
	return undefined;
}

function isKnownStatus(status: number): boolean {
	return Object.hasOwn(USER_FRIENDLY_MESSAGES, status) || (status >= 500 && status < 600);
}

function apiErrorDetails(error: unknown): { status?: number; code?: string } {
	if (error instanceof ApiError) {
		return { status: error.status, code: error.code ?? parseApiErrorPayload(error.data).code };
	}
	if (!error || typeof error !== "object" || !("response" in error)) return {};
	const { response } = error;
	if (!response || typeof response !== "object") return {};
	return {
		status:
			"status" in response && typeof response.status === "number" ? response.status : undefined,
		code: "data" in response ? parseApiErrorPayload(response.data).code : undefined,
	};
}

/**
 * Generic message for an API error whose stable code or HTTP status is known, so the client can
 * show a localized message instead of the server's English text. `undefined` for anything else.
 */
export function getApiErrorMessage(error: unknown): string | undefined {
	const { status, code } = apiErrorDetails(error);
	const known =
		(code === undefined ? undefined : statusForCode(code)) ??
		(status !== undefined && isKnownStatus(status) ? status : undefined);
	return known === undefined ? undefined : getErrorMessage(known);
}
