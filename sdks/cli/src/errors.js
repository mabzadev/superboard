export class UsageError extends Error {
	constructor(message) {
		super(message);
		this.name = "UsageError";
	}
}

export class ApiError extends Error {
	constructor(code, message, status, details, retryable) {
		super(message);
		this.name = "ApiError";
		this.code = code;
		this.status = status;
		this.details = details;
		this.retryable = retryable;
	}
}
