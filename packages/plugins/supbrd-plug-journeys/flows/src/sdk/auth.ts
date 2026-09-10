import { constantTimeEqual } from "@superboard/contracts/secret";
import { sha256 } from "../d1/helpers";
import { failure } from "../http/errors";

export const FLOW_SDK_KEY_HEADER = "x-superboard-flows-sdk-key";
const INVALID_KEY_HASH = "0".repeat(64);

export type FlowSdkCredential = {
  projectIdentifier: string;
  sdkKey: string;
};

/**
 * Resolve the native credential without allowing an identifier-only fallback.
 *
 * SuperBoard SDKs send the key in a header (HTTP) or query parameter
 * (WebSocket). A composite `<project_ref>.<sdk_key>` remains accepted for
 * clients that cannot set a custom authorization header.
 */
export function readFlowSdkCredential(
  request: Request,
  projectId: string,
): FlowSdkCredential {
  const composite = splitCompositeCredential(projectId);
  const urlKey = new URL(request.url).searchParams.get("sdkKey")?.trim() || null;
  const headerKey = request.headers.get(FLOW_SDK_KEY_HEADER)?.trim() || null;
  const suppliedKeys = [headerKey, urlKey, composite.sdkKey].filter(
    (value): value is string => Boolean(value),
  );
  if (
    suppliedKeys.length === 0 ||
    suppliedKeys.some((value) => value.length > 512) ||
    new Set(suppliedKeys).size !== 1
  ) {
    throw invalidSdkCredential();
  }
  return {
    projectIdentifier: composite.projectIdentifier,
    sdkKey: suppliedKeys[0]!,
  };
}

export async function verifyFlowSdkKey(
  providedKey: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  const providedHash = await sha256(providedKey);
  const expectedHash =
    typeof storedHash === "string" && /^[a-f0-9]{64}$/u.test(storedHash)
      ? storedHash
      : INVALID_KEY_HASH;
  return constantTimeEqual(providedHash, expectedHash);
}

export function invalidSdkCredential() {
  return failure(
    "flow_sdk_key_invalid",
    "Flows SDK credentials are invalid",
    401,
  );
}

function splitCompositeCredential(value: string): {
  projectIdentifier: string;
  sdkKey: string | null;
} {
  const separator = value.indexOf(".");
  if (separator <= 0 || separator === value.length - 1) {
    return { projectIdentifier: value, sdkKey: null };
  }
  return {
    projectIdentifier: value.slice(0, separator),
    sdkKey: value.slice(separator + 1),
  };
}
