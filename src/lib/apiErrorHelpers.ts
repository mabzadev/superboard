import { ApiError } from "./ApiError";

export function getApiErrorStatus(err: unknown): number | undefined {
  return err instanceof ApiError ? err.status : undefined;
}

export function isFeatureOff(err: unknown, expectedStatus: number): boolean {
  return getApiErrorStatus(err) === expectedStatus;
}

export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.data && typeof err.data === "object") {
    const data = err.data as Record<string, unknown>;
    const msg = data.message ?? data.error;
    if (typeof msg === "string" && msg.trim().length > 0) {
      return msg;
    }
  }
  return fallback;
}
