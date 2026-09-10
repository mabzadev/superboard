import { readJsonObjectLimited } from "@superboard/contracts/request-body";

export const API_JSON_BODY_MAX_BYTES = 1024 * 1024;

export function readApiJson(
  request: Request,
  maxBytes = API_JSON_BODY_MAX_BYTES,
): Promise<Record<string, any>> {
  return readJsonObjectLimited(request, maxBytes) as Promise<Record<string, any>>;
}
