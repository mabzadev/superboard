import { describe, expect, it } from "vitest";
import { resolveRuntimeMigration } from "./migration";

describe("resolveRuntimeMigration", () => {
  it("ends in-progress users when the public end strategy is activated", () => {
    expect(
      resolveRuntimeMigration(
        { workflowVersionId: "v1", state: "in-progress" },
        "v2",
        "finish-current",
        "once",
        "identify",
      ),
    ).toEqual({
      continueStoredVersion: false,
      resetRuntime: false,
      endRuntime: true,
    });
  });

  it("restarts only the intended population", () => {
    expect(
      resolveRuntimeMigration(
        { workflowVersionId: "v1", state: "in-progress" },
        "v2",
        "restart-current",
        "once",
        "identify",
      ).resetRuntime,
    ).toBe(true);
    expect(
      resolveRuntimeMigration(
        { workflowVersionId: "v1", state: "completed" },
        "v2",
        "restart-current",
        "once",
        "identify",
      ).resetRuntime,
    ).toBe(false);
    expect(
      resolveRuntimeMigration(
        { workflowVersionId: "v1", state: "completed" },
        "v2",
        "restart-all",
        "once",
        "identify",
      ).resetRuntime,
    ).toBe(true);
  });

  it("opens a clean generation for every-time terminal workflows", () => {
    expect(
      resolveRuntimeMigration(
        { workflowVersionId: "v2", state: "completed" },
        "v2",
        "finish-current",
        "every-time",
        "identify",
      ),
    ).toEqual({
      continueStoredVersion: false,
      resetRuntime: true,
      endRuntime: false,
    });
  });
});
