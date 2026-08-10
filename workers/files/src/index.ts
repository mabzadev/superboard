import { Hono, type Context, type Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  constantTimeEqual,
  configuredSecrets,
  matchesAnySecret,
} from "@opengrow/contracts/secret";
import { inspectSqlSchemaHealth } from "@opengrow/contracts/health";

export type FilesEnv = Cloudflare.Env;

type Variables = { userId: string };
type FilesContext = Context<{ Bindings: FilesEnv; Variables: Variables }>;
type FileRow = {
  id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  etag: string | null;
  created_at: string;
  updated_at: string;
};

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const app = new Hono<{ Bindings: FilesEnv; Variables: Variables }>();

app.onError((cause, c) => {
  if (cause instanceof FilesInputError)
    return error(cause.code, cause.message, cause.status);
  console.error(
    JSON.stringify({
      event: "files_worker_error",
      requestId: c.req.header("x-request-id") || null,
      error: cause instanceof Error ? cause.message : String(cause),
    }),
  );
  return error("files_internal_error", "Files service failed", 500, true);
});

app.get("/health", async (c) => {
  try {
    const [inventory, schema] = await Promise.all([
      c.env.DB.prepare(
        `
        SELECT COUNT(*) total_files, COALESCE(SUM(byte_size),0) total_bytes,
          COUNT(DISTINCT user_id) users_with_files
        FROM application_files
      `,
      ).first<{
        total_files: number;
        total_bytes: number;
        users_with_files: number;
      }>(),
      inspectSqlSchemaHealth(c.env.DB, c.env.D1_EXPECTED_MIGRATION),
    ]);
    const maximum = maximumBytes(c.env);
    const contentTypes = allowedContentTypes(c.env);
    const current = schema.status === "current";
    return json(
      {
        service: "files",
        status: current ? "ok" : "degraded",
        environment: c.env.ENVIRONMENT,
        schema,
        ...(current ? {} : { reason: "database_schema_not_current" }),
        inventory: {
          totalFiles: Number(inventory?.total_files || 0),
          totalBytes: Number(inventory?.total_bytes || 0),
          usersWithFiles: Number(inventory?.users_with_files || 0),
        },
        policy: {
          maxBytes: maximum,
          allowedContentTypes: contentTypes,
        },
      },
      current ? 200 : 503,
    );
  } catch {
    return json(
      {
        service: "files",
        status: "misconfigured",
        environment: c.env.ENVIRONMENT,
      },
      503,
    );
  }
});

async function authenticate(c: FilesContext, next: Next) {
  const token = c.req.header("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return error("unauthorized", "Authentication is required", 401);
  try {
    const keys = remoteJwks(c.env.AUTH_GATEWAY_JWKS_URL);
    const verified = await jwtVerify(token, keys, {
      issuer: c.env.AUTH_GATEWAY_ISSUER,
      audience: c.env.APPLICATION_AUDIENCE,
      algorithms: ["ES256"],
    });
    if (!verified.payload.sub || verified.payload.type !== "application_access")
      throw new Error("token_invalid");
    c.set("userId", String(verified.payload.sub));
    await next();
  } catch {
    return error("unauthorized", "Authentication is invalid or expired", 401);
  }
}

app.use("/v1/files", authenticate);
app.use("/v1/files/*", authenticate);

app.get("/v1/files", async (c) => {
  const limit = integer(c.req.query("limit"), 50, 1, 100);
  const offset = integer(c.req.query("offset"), 0, 0, 1_000_000);
  const rows = (
    await c.env.DB.prepare(
      `SELECT id,filename,content_type,byte_size,etag,created_at,updated_at FROM application_files
     WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
      .bind(c.get("userId"), limit, offset)
      .all<Omit<FileRow, "object_key">>()
  ).results;
  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) total FROM application_files WHERE user_id=?",
  )
    .bind(c.get("userId"))
    .first<{ total: number }>();
  return json({
    files: rows.map(fileJson),
    meta: { limit, offset, total: Number(total?.total || 0) },
    policy: {
      max_bytes: maximumBytes(c.env),
      allowed_content_types: allowedContentTypes(c.env),
    },
  });
});

app.post("/v1/files", async (c) => {
  const contentLength = Number(c.req.header("content-length") || 0);
  const maximum = maximumBytes(c.env);
  if (contentLength > maximum)
    return error("file_too_large", `File exceeds ${maximum} bytes`, 413);
  if (!c.req.raw.body)
    return error("file_empty", "A file body is required", 422);
  const filename = safeFilename(c.req.header("x-filename") || "upload.bin");
  const contentType = safeContentType(
    c.req.header("content-type") || "application/octet-stream",
  );
  assertAllowedContentType(c.env, contentType);
  const id = crypto.randomUUID();
  const userHash = (await sha256(c.get("userId"))).slice(0, 24);
  const objectKey = `application-files/${c.env.ENVIRONMENT}/${userHash}/${id}`;
  let byteSize = 0;
  const boundedBody = c.req.raw.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        byteSize += chunk.byteLength;
        if (byteSize > maximum)
          throw new FilesInputError(
            "file_too_large",
            `File exceeds ${maximum} bytes`,
            413,
          );
        controller.enqueue(chunk);
      },
    }),
  );
  const object = await c.env.FILES.put(objectKey, boundedBody, {
    httpMetadata: { contentType },
    customMetadata: { fileId: id, owner: userHash },
  });
  if (byteSize === 0) {
    await c.env.FILES.delete(objectKey);
    return error("file_empty", "A non-empty file is required", 422);
  }
  try {
    await c.env.DB.prepare(
      `INSERT INTO application_files (id,user_id,object_key,filename,content_type,byte_size,etag)
       VALUES (?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        c.get("userId"),
        objectKey,
        filename,
        contentType,
        byteSize,
        object.etag,
      )
      .run();
  } catch (cause) {
    await c.env.FILES.delete(objectKey).catch(() => undefined);
    throw cause;
  }
  return json(
    {
      file: {
        id,
        filename,
        content_type: contentType,
        byte_size: byteSize,
        etag: object.etag,
      },
    },
    201,
  );
});

app.get("/v1/files/:id", async (c) => {
  const row = await ownedFile(c.env.DB, c.get("userId"), c.req.param("id"));
  return row
    ? json({ file: fileJson(row) })
    : error("file_not_found", "File was not found", 404);
});

app.get("/v1/files/:id/content", async (c) => {
  const row = await ownedFile(c.env.DB, c.get("userId"), c.req.param("id"));
  if (!row) return error("file_not_found", "File was not found", 404);
  return serveFile(c.env.FILES, row, c.req.header("range"));
});

async function serveFile(
  bucket: R2Bucket,
  row: FileRow,
  range: string | undefined,
): Promise<Response> {
  const object = await bucket.get(row.object_key, {
    range: range ? new Headers({ range }) : undefined,
  });
  if (!object)
    return error(
      "file_object_missing",
      "Stored file is unavailable",
      503,
      true,
    );
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
  );
  headers.set("x-content-type-options", "nosniff");
  headers.set("accept-ranges", "bytes");
  if (object.range) {
    const { start, length } = resolvedRange(object.range, object.size);
    headers.set(
      "content-range",
      `bytes ${start}-${start + length - 1}/${object.size}`,
    );
    headers.set("content-length", String(length));
  } else {
    headers.set("content-length", String(object.size));
  }
  return new Response(object.body, {
    status: object.range ? 206 : 200,
    headers,
  });
}

app.delete("/v1/files/:id", async (c) => {
  const row = await ownedFile(c.env.DB, c.get("userId"), c.req.param("id"));
  if (!row) return error("file_not_found", "File was not found", 404);
  await c.env.FILES.delete(row.object_key);
  await c.env.DB.prepare(
    "DELETE FROM application_files WHERE id=? AND user_id=?",
  )
    .bind(row.id, c.get("userId"))
    .run();
  return json({ deleted: true });
});

app.post("/internal/v1/files/:id/download-ticket", async (c) => {
  if (!(await internalAuthorized(c))) {
    return error("unauthorized", "Internal authentication is required", 401);
  }
  const owner = c.req.header("x-file-owner")?.trim() || "";
  if (!validOwner(owner)) {
    return error("file_owner_invalid", "File owner is invalid", 422);
  }
  const row = await ownedFile(c.env.DB, owner, c.req.param("id"));
  if (!row) return error("file_not_found", "File was not found", 404);
  const expiresAt = Math.floor(Date.now() / 1000) + downloadTicketTtl(c.env);
  const ticket = await createDownloadTicket(
    {
      fileId: row.id,
      ownerHash: await sha256(owner),
      expiresAt,
      nonce: crypto.randomUUID(),
    },
    c.env.FILES_DOWNLOAD_SIGNING_KEY,
  );
  return json({
    file: fileJson(row),
    download: {
      url: `${filesPublicOrigin(c.env)}/v1/downloads/${ticket}`,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    },
  });
});

app.get("/v1/downloads/:ticket", async (c) => {
  const payload = await verifyDownloadTicket(
    c.req.param("ticket"),
    configuredSecrets(
      c.env.FILES_DOWNLOAD_SIGNING_KEY,
      c.env.FILES_DOWNLOAD_SIGNING_KEY_PREVIOUS,
    ),
    downloadTicketTtl(c.env),
  );
  if (!payload) {
    return error(
      "download_ticket_invalid",
      "Download ticket is invalid or expired",
      401,
    );
  }
  const row = await fileById(c.env.DB, payload.fileId);
  if (
    !row ||
    !(await constantTimeEqual(await sha256(row.user_id), payload.ownerHash))
  ) {
    return error("file_not_found", "File was not found", 404);
  }
  return serveFile(c.env.FILES, row, c.req.header("range"));
});

app.delete("/internal/v1/users/:id", async (c) => {
  if (!(await internalAuthorized(c))) {
    return error("unauthorized", "Internal authentication is required", 401);
  }
  const userId = c.req.param("id");
  let deleted = 0;
  while (true) {
    const rows = (
      await c.env.DB.prepare(
        "SELECT id,object_key FROM application_files WHERE user_id=? ORDER BY id LIMIT 1000",
      )
        .bind(userId)
        .all<{ id: string; object_key: string }>()
    ).results;
    if (rows.length === 0) break;
    await c.env.FILES.delete(rows.map((row) => row.object_key));
    const placeholders = rows.map(() => "?").join(",");
    await c.env.DB.prepare(
      `DELETE FROM application_files WHERE user_id=? AND id IN (${placeholders})`,
    )
      .bind(userId, ...rows.map((row) => row.id))
      .run();
    deleted += rows.length;
  }
  return json({ deleted });
});

function remoteJwks(url: string) {
  if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error("jwks_url_invalid");
  let value = jwks.get(url);
  if (!value) {
    value = createRemoteJWKSet(new URL(url), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    });
    jwks.set(url, value);
  }
  return value;
}

export function resolvedRange(
  range: R2Range,
  size: number,
): { start: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(Math.max(0, range.suffix), size);
    return { start: size - length, length };
  }
  const start = Math.min(Math.max(0, range.offset ?? 0), size);
  const length = Math.min(
    Math.max(0, range.length ?? size - start),
    size - start,
  );
  return { start, length };
}

async function ownedFile(db: D1Database, userId: string, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return db
    .prepare(
      "SELECT id,object_key,filename,content_type,byte_size,etag,created_at,updated_at FROM application_files WHERE id=? AND user_id=?",
    )
    .bind(id, userId)
    .first<FileRow>();
}

async function fileById(db: D1Database, id: string) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return null;
  return db
    .prepare(
      "SELECT id,user_id,object_key,filename,content_type,byte_size,etag,created_at,updated_at FROM application_files WHERE id=?",
    )
    .bind(id)
    .first<FileRow & { user_id: string }>();
}

async function internalAuthorized(c: FilesContext): Promise<boolean> {
  return matchesAnySecret(
    c.req.header("x-internal-token") || "",
    configuredSecrets(
      c.env.FILES_INTERNAL_TOKEN,
      c.env.FILES_INTERNAL_TOKEN_PREVIOUS,
    ),
  );
}

function validOwner(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function filesPublicOrigin(env: FilesEnv): string {
  let url: URL;
  try {
    url = new URL(env.FILES_PUBLIC_ORIGIN);
  } catch {
    throw new Error("FILES_PUBLIC_ORIGIN_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("FILES_PUBLIC_ORIGIN_invalid");
  }
  return url.origin;
}

function downloadTicketTtl(env: FilesEnv): number {
  const value = Number(env.DOWNLOAD_TICKET_TTL_SECONDS);
  if (!Number.isSafeInteger(value) || value < 60 || value > 3_600) {
    throw new Error("DOWNLOAD_TICKET_TTL_SECONDS_invalid");
  }
  return value;
}

type DownloadTicketPayload = {
  version: 1;
  fileId: string;
  ownerHash: string;
  expiresAt: number;
  nonce: string;
};

type DownloadTicketInput = Omit<DownloadTicketPayload, "version">;

async function createDownloadTicket(
  input: DownloadTicketInput,
  secret: string,
): Promise<string> {
  if (!secret) throw new Error("FILES_DOWNLOAD_SIGNING_KEY_missing");
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ version: 1, ...input })),
  );
  const signature = await hmacSign(payload, secret);
  return `${payload}.${base64UrlEncode(signature)}`;
}

async function verifyDownloadTicket(
  ticket: string,
  secrets: readonly string[],
  maximumTtlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<DownloadTicketPayload | null> {
  if (ticket.length > 2_048 || secrets.length === 0) return null;
  const [payloadPart, signaturePart, extra] = ticket.split(".");
  if (!payloadPart || !signaturePart || extra) return null;
  let signature: Uint8Array;
  let parsed: unknown;
  try {
    signature = base64UrlDecode(signaturePart);
    parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
  } catch {
    return null;
  }
  const matches = await Promise.all(
    secrets.map(async (secret) => {
      const key = await hmacKey(secret, "verify");
      return crypto.subtle.verify(
        "HMAC",
        key,
        signature,
        new TextEncoder().encode(payloadPart),
      );
    }),
  );
  if (!matches.some(Boolean) || !validDownloadTicketPayload(parsed))
    return null;
  if (
    parsed.expiresAt <= nowSeconds ||
    parsed.expiresAt > nowSeconds + maximumTtlSeconds
  ) {
    return null;
  }
  return parsed;
}

function validDownloadTicketPayload(
  value: unknown,
): value is DownloadTicketPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return (
    input.version === 1 &&
    typeof input.fileId === "string" &&
    /^[a-f0-9-]{36}$/i.test(input.fileId) &&
    typeof input.ownerHash === "string" &&
    /^[a-f0-9]{64}$/.test(input.ownerHash) &&
    typeof input.expiresAt === "number" &&
    Number.isSafeInteger(input.expiresAt) &&
    typeof input.nonce === "string" &&
    /^[a-f0-9-]{36}$/i.test(input.nonce)
  );
}

async function hmacSign(value: string, secret: string): Promise<ArrayBuffer> {
  return crypto.subtle.sign(
    "HMAC",
    await hmacKey(secret, "sign"),
    new TextEncoder().encode(value),
  );
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

function base64UrlEncode(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("base64url_invalid");
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function fileJson(row: Omit<FileRow, "object_key"> | FileRow) {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    etag: row.etag,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
function maximumBytes(env: FilesEnv) {
  const value = Number(env.MAX_FILE_BYTES);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100 * 1024 * 1024)
    throw new Error("MAX_FILE_BYTES_invalid");
  return value;
}
function allowedContentTypes(env: FilesEnv): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.ALLOWED_FILE_CONTENT_TYPES_JSON);
  } catch {
    throw new Error("ALLOWED_FILE_CONTENT_TYPES_JSON_invalid");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > 100 ||
    parsed.some(
      (value) =>
        typeof value !== "string" ||
        !/^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/.test(value),
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error("ALLOWED_FILE_CONTENT_TYPES_JSON_invalid");
  }
  return parsed;
}
function assertAllowedContentType(env: FilesEnv, contentType: string): void {
  const allowed = allowedContentTypes(env);
  const type = contentType.slice(0, contentType.indexOf("/"));
  if (!allowed.some((rule) => rule === contentType || rule === `${type}/*`)) {
    throw new FilesInputError(
      "content_type_not_allowed",
      "Content type is not allowed for this application",
      415,
    );
  }
}
function integer(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const candidate = value == null ? fallback : Number(value);
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new FilesInputError(
      "pagination_invalid",
      "Pagination value is invalid",
      422,
    );
  }
  return candidate;
}
function safeFilename(value: string) {
  const filename = value
    .trim()
    .replace(/[\x00-\x1f\x7f/\\]/g, "-")
    .slice(0, 255);
  if (!filename)
    throw new FilesInputError("filename_invalid", "Filename is invalid", 422);
  return filename;
}
function safeContentType(value: string) {
  const contentType = value.split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(contentType)) {
    throw new FilesInputError(
      "content_type_invalid",
      "Content type is invalid",
      422,
    );
  }
  return contentType;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
class FilesInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
function error(
  code: string,
  message: string,
  status: number,
  retryable = false,
) {
  return json({ error: { code, message, retryable } }, status);
}
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export default app;
export {
  allowedContentTypes,
  assertAllowedContentType,
  createDownloadTicket,
  downloadTicketTtl,
  filesPublicOrigin,
  maximumBytes,
  safeContentType,
  safeFilename,
  verifyDownloadTicket,
};
