export class RequestBodyError extends Error {
  constructor(
    readonly code: "body_too_large" | "json_invalid" | "json_object_required" | "form_invalid",
    message: string,
    readonly status: 400 | 413 | 422,
  ) {
    super(message);
    this.name = "RequestBodyError";
  }
}

export async function readBytesLimited(
  source: Request | Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }

  const contentLength = source.headers.get("content-length");
  if (contentLength !== null) {
    const announced = Number(contentLength);
    if (!Number.isSafeInteger(announced) || announced < 0) {
      throw new RequestBodyError("json_invalid", "Content-Length is invalid", 400);
    }
    if (announced > maxBytes) {
      throw new RequestBodyError("body_too_large", `Body exceeds ${maxBytes} bytes`, 413);
    }
  }

  if (!source.body) return new Uint8Array();
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("body_too_large").catch(() => undefined);
        throw new RequestBodyError("body_too_large", `Body exceeds ${maxBytes} bytes`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readTextLimited(
  source: Request | Response,
  maxBytes: number,
): Promise<string> {
  return new TextDecoder().decode(await readBytesLimited(source, maxBytes));
}

export async function readJsonLimited(
  source: Request | Response,
  maxBytes: number,
): Promise<unknown> {
  const text = await readTextLimited(source, maxBytes);
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestBodyError("json_invalid", "Request body must contain valid JSON", 400);
  }
}

export async function readJsonObjectLimited(
  source: Request | Response,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const value = await readJsonLimited(source, maxBytes);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestBodyError("json_object_required", "Request body must be a JSON object", 422);
  }
  return value as Record<string, unknown>;
}

export async function readRequestObjectLimited(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return readJsonObjectLimited(request, maxBytes);
  }

  const body = await readBytesLimited(request, maxBytes);
  if (body.byteLength === 0) return {};
  if (!contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("multipart/form-data")) {
    throw new RequestBodyError("form_invalid", "Request body media type is unsupported", 400);
  }
  try {
    const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
    return Object.fromEntries(form.entries());
  } catch {
    throw new RequestBodyError("form_invalid", "Request body must contain valid form data", 400);
  }
}
