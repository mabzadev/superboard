export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public data?: unknown
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

  if (
    payload.error &&
    typeof payload.error === "object" &&
    !Array.isArray(payload.error)
  ) {
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
    message:
      typeof payload.message === "string" ? payload.message : undefined,
    code: typeof payload.code === "string" ? payload.code : undefined,
  };
}

const USER_FRIENDLY_MESSAGES: Record<number, string> = {
  400: "Invalid request. Please check your input.",
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
