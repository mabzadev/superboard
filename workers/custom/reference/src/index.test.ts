import { describe, expect, it, vi } from "vitest";
import { parseJob, referenceRetentionDays } from "./index";

describe("custom Worker protocol", () => {
  it("accepts a bounded, versionable job envelope", () => {
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    expect(
      parseJob({
        idempotencyKey: "job:123",
        projectRef: "12-test",
        capability: "reference.echo",
        payload: { value: 42 },
        requestedAt: "2026-08-08T12:00:00Z",
      }),
    ).toMatchObject({ capability: "reference.echo", projectRef: "12-test" });
    vi.useRealTimers();
  });

  it("rejects unknown project reference formats", () => {
    expect(() =>
      parseJob({
        idempotencyKey: "job:123",
        projectRef: "vocostar-production",
        capability: "reference.echo",
        payload: {},
        requestedAt: new Date().toISOString(),
      }),
    ).toThrow(/project_ref_invalid/);
  });

  it("validates the target-defined job retention window", () => {
    expect(referenceRetentionDays("30")).toBe(30);
    expect(() => referenceRetentionDays("0")).toThrow(
      /reference_retention_invalid/,
    );
    expect(() => referenceRetentionDays("3651")).toThrow(
      /reference_retention_invalid/,
    );
    expect(() => referenceRetentionDays("thirty")).toThrow(
      /reference_retention_invalid/,
    );
  });
});
