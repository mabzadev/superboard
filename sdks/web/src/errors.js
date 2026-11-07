export class SuperBoardError extends Error {
	constructor(code, message, status = 0, details = undefined, retryable = false) {
		super(message);
		this.name = "SuperBoardError";
		this.code = code;
		this.status = status;
		this.details = details;
		this.retryable = retryable;
	}
}
