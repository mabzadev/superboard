import { ApiError } from "@/lib/ApiError";
import { getApiErrorMessage } from "@/lib/apiErrorHelpers";

export function migrationErrorToCopy(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return getApiErrorMessage(err, "Something went wrong. Please try again.");
  }

  const fallback = getApiErrorMessage(
    err,
    "Something went wrong. Please try again."
  );
  const raw = fallback.toLowerCase();

  if (err.status === 403) {
    return "Only project admins can configure migration. Ask your admin to set it up.";
  }
  if (err.status === 503) {
    return "Migration is unavailable on this deployment.";
  }
  if (err.status === 429) {
    return "Too many requests — please try again in a minute.";
  }
  if (err.status === 409 && raw.includes("already configured")) {
    return "Migration is already configured for this project.";
  }
  if (err.status === 409 && raw.includes("different project")) {
    return "That hostname is already attached to a different project on Grovs. Contact support if you believe this is a mistake.";
  }
  if (err.status === 422 && raw.includes("not active yet")) {
    return "Your migration domain is still provisioning. Wait for it to become active before adding credentials.";
  }
  if (err.status === 422 && raw.includes("missing keys")) {
    return "Some required credentials are missing. Please re-check the form.";
  }
  return fallback;
}
