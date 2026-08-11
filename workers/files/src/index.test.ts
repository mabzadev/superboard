import { describe, expect, it } from "vitest";
import app, {
  allowedContentTypes,
  assertAllowedContentType,
  createDownloadTicket,
  downloadTicketTtl,
  filesPublicOrigin,
  maximumBytes,
  resolvedRange,
  safeContentType,
  safeFilename,
  verifyDownloadTicket,
  type FilesEnv,
} from "./index";

describe("SuperBoard Files Worker", () => {
  it("reports a configured private runtime", async () => {
    const response = await app.request("/health", {}, environment());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      service: "files",
      status: "ok",
      policy: {
        maxBytes: 1024,
        allowedContentTypes: ["application/pdf", "audio/*", "image/png"],
      },
    });
  });

  it("resolves byte ranges for complete HTTP partial-content headers", () => {
    expect(resolvedRange({ offset: 10, length: 20 }, 100)).toEqual({
      start: 10,
      length: 20,
    });
    expect(resolvedRange({ suffix: 25 }, 100)).toEqual({
      start: 75,
      length: 25,
    });
    expect(resolvedRange({ offset: 90 }, 100)).toEqual({
      start: 90,
      length: 10,
    });
  });

  it("rejects file access without an application identity", async () => {
    const response = await app.request("/v1/files", {}, environment());
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("accepts the previous internal token during identity rotation", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ all: async () => ({ results: [] }) }),
      }),
    } as unknown as D1Database;
    const response = await app.request(
      "/internal/v1/users/user-1",
      {
        method: "DELETE",
        headers: { "x-internal-token": "previous-files-token" },
      },
      environment({
        DB: db,
        FILES_INTERNAL_TOKEN: "new-files-token",
        FILES_INTERNAL_TOKEN_PREVIOUS: "previous-files-token",
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 0 });
  });

  it("issues owner-scoped short-lived download tickets for internal processors", async () => {
    const fileId = "11111111-1111-4111-8111-111111111111";
    const owner = "user-1";
    const db = {
      prepare: () => ({
        bind: (id: string, userId: string) => ({
          first: async () =>
            id === fileId && userId === owner
              ? {
                  id: fileId,
                  object_key: "application-files/test/file",
                  filename: "voice.m4a",
                  content_type: "audio/mp4",
                  byte_size: 100,
                  etag: "etag",
                  created_at: "2026-08-10T00:00:00.000Z",
                  updated_at: "2026-08-10T00:00:00.000Z",
                }
              : null,
        }),
      }),
    } as unknown as D1Database;
    const response = await app.request(
      `/internal/v1/files/${fileId}/download-ticket`,
      {
        method: "POST",
        headers: {
          "x-internal-token": "internal-files-token",
          "x-file-owner": owner,
        },
      },
      environment({ DB: db }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      file: { id: string };
      download: { url: string; expires_at: string };
    };
    expect(body.file.id).toBe(fileId);
    expect(body.download.url).toMatch(
      /^https:\/\/files\.example\.test\/v1\/downloads\/[A-Za-z0-9_.-]+$/u,
    );
    expect(new Date(body.download.expires_at).valueOf()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("signs tickets with the active key and verifies an overlap key without exposing owners", async () => {
    const now = 1_786_320_000;
    const ticket = await createDownloadTicket(
      {
        fileId: "11111111-1111-4111-8111-111111111111",
        ownerHash: "a".repeat(64),
        expiresAt: now + 300,
        nonce: "22222222-2222-4222-8222-222222222222",
      },
      "previous-signing-key",
    );
    await expect(
      verifyDownloadTicket(
        ticket,
        ["active-signing-key", "previous-signing-key"],
        600,
        now,
      ),
    ).resolves.toMatchObject({
      fileId: "11111111-1111-4111-8111-111111111111",
      ownerHash: "a".repeat(64),
    });
    expect(ticket).not.toContain("user-1");
    await expect(
      verifyDownloadTicket(
        `${ticket.slice(0, -1)}x`,
        ["active-signing-key", "previous-signing-key"],
        600,
        now,
      ),
    ).resolves.toBeNull();
  });

  it("normalizes user filenames and validates bounded configuration", () => {
    expect(safeFilename("../voice/audio.wav")).toBe("..-voice-audio.wav");
    expect(safeContentType("Audio/WAV; charset=binary")).toBe("audio/wav");
    expect(maximumBytes(environment())).toBe(1024);
    expect(() => safeContentType("not-a-type")).toThrow(/Content type/);
  });

  it("enforces the application-specific exact and wildcard MIME policy", () => {
    const env = environment();
    expect(allowedContentTypes(env)).toEqual([
      "application/pdf",
      "audio/*",
      "image/png",
    ]);
    expect(() => assertAllowedContentType(env, "audio/wav")).not.toThrow();
    expect(() =>
      assertAllowedContentType(env, "application/pdf"),
    ).not.toThrow();
    expect(() => assertAllowedContentType(env, "video/mp4")).toThrow(
      /not allowed/u,
    );
  });

  it("fails closed when the MIME policy is malformed or duplicated", () => {
    expect(() =>
      allowedContentTypes({
        ...environment(),
        ALLOWED_FILE_CONTENT_TYPES_JSON: "not-json",
      }),
    ).toThrow(/ALLOWED_FILE_CONTENT_TYPES_JSON_invalid/u);
    expect(() =>
      allowedContentTypes({
        ...environment(),
        ALLOWED_FILE_CONTENT_TYPES_JSON: '["audio/*","audio/*"]',
      }),
    ).toThrow(/ALLOWED_FILE_CONTENT_TYPES_JSON_invalid/u);
  });

  it("validates the public file origin and bounded processor ticket lifetime", () => {
    expect(filesPublicOrigin(environment())).toBe("https://files.example.test");
    expect(downloadTicketTtl(environment())).toBe(600);
    expect(() =>
      filesPublicOrigin({
        ...environment(),
        FILES_PUBLIC_ORIGIN: "http://files.example.test",
      }),
    ).toThrow(/FILES_PUBLIC_ORIGIN_invalid/u);
    expect(() =>
      downloadTicketTtl({
        ...environment(),
        DOWNLOAD_TICKET_TTL_SECONDS: "7200",
      }),
    ).toThrow(/DOWNLOAD_TICKET_TTL_SECONDS_invalid/u);
  });
});

function environment(overrides: Partial<FilesEnv> = {}): FilesEnv {
  return {
    DB: {
      prepare: (query: string) => {
        const first = async () =>
          query.includes("d1_migrations")
            ? {
                applied_migration_count: 1,
                expected_migration_applied: 1,
                latest_migration: "0001_files.sql",
              }
            : { total_files: 0, total_bytes: 0, users_with_files: 0 };
        return { first, bind: () => ({ first }) };
      },
    } as unknown as D1Database,
    FILES: {} as R2Bucket,
    ENVIRONMENT: "development",
    D1_EXPECTED_MIGRATION: "0001_files.sql",
    AUTH_GATEWAY_ISSUER: "https://api.example.test",
    APPLICATION_AUDIENCE: "example.application",
    AUTH_GATEWAY_JWKS_URL: "https://api.example.test/.well-known/jwks.json",
    MAX_FILE_BYTES: "1024",
    ALLOWED_FILE_CONTENT_TYPES_JSON:
      '["application/pdf","audio/*","image/png"]',
    FILES_INTERNAL_TOKEN: "internal-files-token",
    FILES_PUBLIC_ORIGIN: "https://files.example.test",
    DOWNLOAD_TICKET_TTL_SECONDS: "600",
    FILES_DOWNLOAD_SIGNING_KEY: "files-download-signing-key",
    ...overrides,
  } as FilesEnv;
}
