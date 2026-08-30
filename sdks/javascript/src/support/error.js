/**
 * A stable, serializable error raised by the SuperBoard Support SDK.
 */
export class SuperBoardSupportException extends Error {
  constructor(
    code,
    message,
    {
      retryable = false,
      statusCode = null,
      requestId = null,
      details = null,
      cause,
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SuperBoardSupportException";
    this.code = typeof code === "string" && code ? code : "request_failed";
    this.retryable = retryable === true;
    this.statusCode = Number.isInteger(statusCode) ? statusCode : null;
    this.requestId = typeof requestId === "string" && requestId ? requestId : null;
    this.details = isRecord(details) ? { ...details } : null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status_code: this.statusCode,
      request_id: this.requestId,
      details: this.details,
    };
  }
}

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
