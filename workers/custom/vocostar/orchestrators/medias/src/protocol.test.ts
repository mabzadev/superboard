import { describe, expect, it } from "vitest";
import {
  isNonEmptyString,
  isRecord,
  parseContainerResponse,
  parseDispatcherResponse,
  parseJobEnvelope,
  positiveIntegerVariable,
} from "./protocol";

const isMedia = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isNonEmptyString(value.media_id);

describe("managed media protocol", () => {
  it("accepts the historical record envelope without weakening validation", () => {
    expect(
      parseJobEnvelope(
        {
          record: { id: "queue:1", payload: { media_id: "media-1" } },
        },
        isMedia,
      ),
    ).toEqual({
      queueId: "queue:1",
      data: { media_id: "media-1" },
    });
  });

  it("rejects missing and unsafe queue identifiers", () => {
    expect(() => parseJobEnvelope({ media_id: "media-1" }, isMedia)).toThrow(
      "Invalid queue id",
    );
    expect(() =>
      parseJobEnvelope(
        {
          id: "../unsafe",
          payload: { media_id: "media-1" },
        },
        isMedia,
      ),
    ).toThrow("Invalid queue id");
  });

  it("parses bounded heartbeat-prefixed JSON and rejects failed results", async () => {
    const isResult = (value: unknown): value is { audio_crv_url: string } =>
      isRecord(value) && isNonEmptyString(value.audio_crv_url);
    await expect(
      parseContainerResponse(
        new Response('   {"status":"completed","audio_crv_url":"file"}'),
        isResult,
      ),
    ).resolves.toMatchObject({ audio_crv_url: "file" });
    await expect(
      parseContainerResponse(
        new Response('{"status":"failed","error":"provider unavailable"}'),
        isResult,
      ),
    ).rejects.toThrow("provider unavailable");
  });

  it("validates dispatcher slot responses", async () => {
    await expect(
      parseDispatcherResponse(Response.json({ instanceId: 7 })),
    ).resolves.toBe(7);
    await expect(
      parseDispatcherResponse(Response.json({ instanceId: null })),
    ).resolves.toBeNull();
    await expect(
      parseDispatcherResponse(Response.json({ instanceId: "7" })),
    ).rejects.toThrow("invalid slot id");
  });

  it("validates generated integer configuration", () => {
    expect(positiveIntegerVariable("10", "POOL", 100)).toBe(10);
    expect(() => positiveIntegerVariable("0", "POOL", 100)).toThrow(
      "positive integer",
    );
    expect(() => positiveIntegerVariable("101", "POOL", 100)).toThrow(
      "supported maximum",
    );
  });
});
