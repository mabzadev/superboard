import { describe, it, expect } from "vitest";
import { getHealthLabel } from "../getHealthLabel";
import type { MigrationSource } from "@/types";

function buildSource(
  overrides: Partial<MigrationSource> = {}
): MigrationSource {
  return {
    id: 1,
    provider: "branch",
    old_host: "old.acme.com",
    enabled: true,
    health: "healthy",
    consecutive_failures: 0,
    first_failure_at: null,
    last_error_status: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("getHealthLabel", () => {
  it("returns green Active for healthy enabled source", () => {
    const result = getHealthLabel(buildSource({ health: "healthy" }));
    expect(result.tone).toBe("green");
    expect(result.label).toBe("Active");
  });

  it("returns amber Degraded for degraded enabled source", () => {
    const result = getHealthLabel(
      buildSource({
        health: "degraded",
        consecutive_failures: 5,
        last_error_status: 502,
        first_failure_at: "2026-06-01T00:00:00Z",
      })
    );
    expect(result.tone).toBe("amber");
    expect(result.label).toBe("Degraded");
  });

  it("returns amber Auto-disabled when consecutive_failures >= 500", () => {
    const result = getHealthLabel(
      buildSource({
        health: "disabled",
        enabled: false,
        consecutive_failures: 500,
        first_failure_at: "2026-06-01T00:00:00Z",
        last_error_status: 401,
      })
    );
    expect(result.tone).toBe("amber");
    expect(result.label).toBe("Auto-disabled");
  });

  it("returns amber Auto-disabled when first_failure_at older than 2 days", () => {
    // Mock-friendly: the helper compares first_failure_at to Date.now().
    const threeDaysAgo = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000
    ).toISOString();
    const result = getHealthLabel(
      buildSource({
        health: "disabled",
        enabled: false,
        consecutive_failures: 10,
        first_failure_at: threeDaysAgo,
        last_error_status: 502,
      })
    );
    expect(result.tone).toBe("amber");
    expect(result.label).toBe("Auto-disabled");
  });

  it("returns grey Paused for admin-disabled (enabled false + zero failures)", () => {
    const result = getHealthLabel(
      buildSource({
        health: "disabled",
        enabled: false,
        consecutive_failures: 0,
        first_failure_at: null,
      })
    );
    expect(result.tone).toBe("grey");
    expect(result.label).toBe("Paused");
  });
});
