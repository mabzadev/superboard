import { ApiError, getErrorMessage } from "@/lib/ApiError";

/**
 * Categorizes an error into a user-friendly title and description.
 * Uses ApiError status codes when available, falls back to message matching.
 */
export function categorizeError(error: Error): {
  title: string;
  description: string;
} {
  // Use structured ApiError when available
  if (error instanceof ApiError) {
    const { status } = error;

    if (status === 401) {
      return {
        title: "Session expired",
        description: "Please sign in again to continue.",
      };
    }
    if (status === 403) {
      return {
        title: "Access denied",
        description: "You don't have permission to perform this action.",
      };
    }
    if (status === 404) {
      return {
        title: "Not found",
        description: "The requested resource could not be found.",
      };
    }
    if (status === 429) {
      return {
        title: "Too many requests",
        description: "Please wait a moment and try again.",
      };
    }
    if (status >= 500) {
      return {
        title: "Server error",
        description:
          "Our servers are having trouble right now. Please try again later.",
      };
    }

    return {
      title: "Request failed",
      description: getErrorMessage(status),
    };
  }

  // Fallback: match on message text for non-API errors
  const message = error.message?.toLowerCase() ?? "";

  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("unable to connect") ||
    message.includes("failed to fetch") ||
    message.includes("internet")
  ) {
    return {
      title: "Connection error",
      description: "Check your internet connection and try again.",
    };
  }

  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("server error")
  ) {
    return {
      title: "Server error",
      description:
        "Our servers are having trouble right now. Please try again later.",
    };
  }

  return {
    title: "Something went wrong!",
    description: "An unexpected error occurred.",
  };
}

/**
 * Registers a global handler for unhandled promise rejections.
 * Should be called once from the root layout or analytics provider.
 */
export function registerGlobalErrorHandlers(
  onError: (event: string, properties: Record<string, unknown>) => void
) {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "Unknown");

    console.error("Unhandled promise rejection:", reason);
    onError("unhandled_rejection", {
      error_message: message,
      error_type: reason instanceof Error ? reason.name : "Unknown",
    });
  });
}
