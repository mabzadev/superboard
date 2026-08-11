export type JsonRecord = Record<string, unknown>;

const MAX_CONTAINER_RESPONSE_BYTES = 1024 * 1024;
const JOB_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export function positiveIntegerVariable(
  value: string,
  name: string,
  maximum: number,
): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} exceeds its supported maximum`);
  }
  return parsed;
}

export function parseJobEnvelope<T>(
  input: unknown,
  isPayload: (value: unknown) => value is T,
): { queueId: string; data: T } {
  if (!isRecord(input)) throw new Error("Request body must be a JSON object");
  const record = isRecord(input.record) ? input.record : input;
  const data = isRecord(record.payload) ? record.payload : record;
  if (!isNonEmptyString(record.id) || !JOB_ID.test(record.id)) {
    throw new Error("Invalid queue id");
  }
  if (!isPayload(data)) throw new Error("Invalid job payload");
  return { queueId: record.id, data };
}

export async function parseContainerResponse<T>(
  response: Response,
  isResult: (value: unknown) => value is T,
): Promise<T> {
  const text = await boundedResponseText(response);
  if (!response.ok) {
    throw new Error(`Container HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text.trim());
  } catch {
    throw new Error(`Container returned invalid JSON: ${text.slice(-200)}`);
  }
  if (!isRecord(value)) throw new Error("Container result must be an object");
  if (value.status === "failed") {
    throw new Error(
      isNonEmptyString(value.error) ? value.error : "Container step failed",
    );
  }
  if (!isResult(value))
    throw new Error("Container result does not match the expected contract");
  return value;
}

export async function parseDispatcherResponse(
  response: Response,
): Promise<number | null> {
  if (!response.ok) throw new Error(`Dispatcher HTTP ${response.status}`);
  const value = await readJsonObjectLimited(response);
  if (!isRecord(value)) throw new Error("Dispatcher result must be an object");
  if (value.instanceId === null) return null;
  if (!Number.isInteger(value.instanceId) || Number(value.instanceId) < 1) {
    throw new Error("Dispatcher returned an invalid slot id");
  }
  return Number(value.instanceId);
}

async function readJsonObjectLimited(response: Response): Promise<unknown> {
  const text = await boundedResponseText(response);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Dispatcher returned invalid JSON");
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_CONTAINER_RESPONSE_BYTES) {
      await reader.cancel("container response too large");
      throw new Error("Container response exceeds 1 MiB");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
