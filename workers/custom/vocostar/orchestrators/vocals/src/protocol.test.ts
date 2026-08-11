import { describe, expect, it } from "vitest";
import {
  isNonEmptyString,
  isRecord,
  parseContainerResponse,
  parseDispatcherResponse,
  parseJobEnvelope,
  positiveIntegerVariable,
} from "./protocol";

const isVocal = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && isNonEmptyString(value.user_vocal_id);

describe("managed vocal protocol", () => {
  it("accepts a validated vocal queue envelope", () => {
    expect(
      parseJobEnvelope(
        {
          id: "vocal.1",
          payload: { user_vocal_id: "vocal-1" },
        },
        isVocal,
      ),
    ).toEqual({
      queueId: "vocal.1",
      data: { user_vocal_id: "vocal-1" },
    });
  });

  it("rejects a malformed payload", () => {
    expect(() =>
      parseJobEnvelope(
        {
          id: "vocal.1",
          payload: { user_vocal_id: "" },
        },
        isVocal,
      ),
    ).toThrow("Invalid job payload");
  });

  it("fails closed on malformed container output", async () => {
    await expect(
      parseContainerResponse(new Response("not-json"), isRecord),
    ).rejects.toThrow("invalid JSON");
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
    expect(positiveIntegerVariable("20", "POOL", 100)).toBe(20);
    expect(() => positiveIntegerVariable("20.5", "POOL", 100)).toThrow(
      "positive integer",
    );
    expect(() => positiveIntegerVariable("101", "POOL", 100)).toThrow(
      "supported maximum",
    );
  });
});
