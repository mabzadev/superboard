export type DeadLetterPayload = {
  payloadJson: string;
  payloadSha256: string;
  payloadBytes: number;
  replayable: boolean;
  redacted: boolean;
  jobType: string | null;
};

export const DEAD_LETTER_MAX_RECORDS = 10_000;

export async function deadLetterPayload(
  value: unknown,
  maxRetainedBytes = 128 * 1024,
): Promise<DeadLetterPayload> {
  if (!Number.isSafeInteger(maxRetainedBytes) || maxRetainedBytes < 1) {
    throw new TypeError("maxRetainedBytes must be a positive safe integer");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify({ unserializable: true });
  }
  if (serialized === undefined) serialized = "null";
  const bytes = new TextEncoder().encode(serialized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const payloadSha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const jobType = value && typeof value === "object" && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).type === "string"
    ? String((value as Record<string, unknown>).type).slice(0, 128)
    : null;
  const sanitized = sanitizeSerializedPayload(serialized);
  const replayable = bytes.byteLength <= maxRetainedBytes
    && serialized !== '{"unserializable":true}'
    && !sanitized.redacted;
  return {
    payloadJson: bytes.byteLength <= maxRetainedBytes && serialized !== '{"unserializable":true}'
      ? sanitized.json
      : JSON.stringify({ quarantined: true, payload_retained: false, job_type: jobType }),
    payloadSha256,
    payloadBytes: bytes.byteLength,
    replayable,
    redacted: sanitized.redacted,
    jobType,
  };
}

function sanitizeSerializedPayload(serialized: string): { json: string; redacted: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { json: JSON.stringify({ unserializable: true }), redacted: true };
  }
  let redacted = false;
  const visit = (input: unknown, depth: number): unknown => {
    if (depth > 64) {
      redacted = true;
      return "[TRUNCATED]";
    }
    if (Array.isArray(input)) return input.map((item) => visit(item, depth + 1));
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(Object.entries(input).map(([key, item]) => {
      if (sensitiveField(key)) {
        redacted = true;
        return [key, "[REDACTED]"];
      }
      return [key, visit(item, depth + 1)];
    }));
  };
  return { json: JSON.stringify(visit(parsed, 0)), redacted };
}

function sensitiveField(field: string): boolean {
  const normalized = field.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
  return /(?:^|[_-])(?:authorization|cookie|credential|password|secret|token|api[_-]?key|private[_-]?key|signature)(?:$|[_-])/u
    .test(normalized);
}
