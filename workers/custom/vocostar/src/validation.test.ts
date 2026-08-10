import { describe, expect, it, vi } from "vitest";
import type { CustomWorkerJob } from "@opengrow/contracts/custom-worker";
import { observedStatus, resolveDispatchPayload } from "./jobs";
import {
  VocoStarJobError,
  parseMediaConvert,
  parseVoiceClone,
  requestHash,
} from "./validation";

const base = (
  capability: string,
  payload: Record<string, unknown>,
): CustomWorkerJob => ({
  idempotencyKey: "vocostar:test:1",
  projectRef: "11-test",
  capability,
  payload,
  requestedAt: "2026-08-08T12:00:00.000Z",
});

describe("VocoStar custom job validation", () => {
  it("accepts only an opaque common Files identifier for a voice sample", () => {
    expect(
      parseVoiceClone(
        base("vocostar.voice.clone", {
          fileId: "11111111-1111-4111-8111-111111111111",
          language: "fr",
        }),
      ),
    ).toEqual({
      fileId: "11111111-1111-4111-8111-111111111111",
      language: "fr",
    });
  });

  it("rejects URLs and malformed identifiers before owner resolution", () => {
    for (const fileId of [
      "https://files.example.test/v1/files/sample",
      "not-a-file-id",
    ]) {
      expect(() =>
        parseVoiceClone(
          base("vocostar.voice.clone", {
            fileId,
            language: "en",
          }),
        ),
      ).toThrow(VocoStarJobError);
    }
  });

  it("normalizes each media input shape and bounds credit cost", () => {
    expect(
      parseMediaConvert(
        base("vocostar.media.convert", {
          vocalId: "voice-1",
          vocalType: "user",
          mediaType: "text",
          creditCost: 25,
          input: { text: "Bonjour", language: "fr" },
        }),
      ),
    ).toMatchObject({
      mediaType: "text",
      input: { text_src: "Bonjour", language: "fr" },
      creditCost: 25,
      sourceFileId: null,
    });
    expect(
      parseMediaConvert(
        base("vocostar.media.convert", {
          vocalId: "voice-1",
          vocalType: "user",
          mediaType: "audio",
          input: { fileId: "22222222-2222-4222-8222-222222222222" },
        }),
      ),
    ).toMatchObject({
      input: {
        audio_file_id: "22222222-2222-4222-8222-222222222222",
      },
      sourceFileId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("uses a canonical request hash for idempotency conflict detection", async () => {
    const left = base("vocostar.media.convert", { b: 2, a: { z: 1, y: 2 } });
    const right = base("vocostar.media.convert", { a: { y: 2, z: 1 }, b: 2 });
    await expect(requestHash(left)).resolves.toBe(await requestHash(right));
  });

  it("resolves owner-scoped file IDs to short-lived URLs only at dispatch", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get("x-file-owner")).toBe("user-1");
      expect(request.headers.get("x-internal-token")).toBe("files-token");
      expect(request.url).toContain(
        "/internal/v1/files/11111111-1111-4111-8111-111111111111/download-ticket",
      );
      return Response.json({
        download: {
          url: "https://files.example.test/v1/downloads/signed-ticket",
        },
      });
    });
    await expect(
      resolveDispatchPayload(
        {
          user_id: "user-1",
          source_file_id: "11111111-1111-4111-8111-111111111111",
        },
        {
          audio_file_id: "11111111-1111-4111-8111-111111111111",
          media_type: "audio",
        },
        {
          FILES_SERVICE: { fetch } as unknown as Fetcher,
          FILES_INTERNAL_TOKEN: "files-token",
        },
      ),
    ).resolves.toEqual({
      audio_src: "https://files.example.test/v1/downloads/signed-ticket",
      media_type: "audio",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fails closed when a queued payload does not match its durable source file", async () => {
    await expect(
      resolveDispatchPayload(
        {
          user_id: "user-1",
          source_file_id: "11111111-1111-4111-8111-111111111111",
        },
        {
          video_file_id: "22222222-2222-4222-8222-222222222222",
        },
        {
          FILES_SERVICE: { fetch: vi.fn() } as unknown as Fetcher,
          FILES_INTERNAL_TOKEN: "files-token",
        },
      ),
    ).rejects.toThrow("dispatch_source_file_mismatch");
  });
});

describe("VocoStar observed job state", () => {
  it("prefers completed and failed durable state over adapter state", () => {
    expect(
      observedStatus("dispatched", {
        entity_job: 1,
        progress: 1,
        processed_at: "now",
        entity_error: null,
        dispatch_status: null,
        dispatch_error: null,
      }),
    ).toBe("completed");
    expect(
      observedStatus("running", {
        entity_job: 0,
        progress: 0.6,
        processed_at: null,
        entity_error: null,
        dispatch_status: "failed",
        dispatch_error: "provider_failed",
      }),
    ).toBe("failed");
  });

  it("marks a missing legacy entity as failed", () => {
    expect(observedStatus("queued", null)).toBe("failed");
  });
});
