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
