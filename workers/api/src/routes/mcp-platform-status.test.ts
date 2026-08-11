import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { createFakeD1 } from "../test/fake-d1";

const buildPlatformStatus = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    status: "ok",
    environment: "development",
    deployment: { target: "reference", release: "sha-1" },
    services: [],
    dataStores: [],
    metrics: {},
    jobs: {},
  })
);
vi.mock("./platform-status", () => ({ buildPlatformStatus }));

import mcp from "./mcp";

describe("MCP platform status", () => {
  it("returns the shared Infrastructure aggregation to an administrator", async () => {
    const db = database("admin");
    const runtime = { DB: db, ENVIRONMENT: "development" } as Env;
    const response = await mcp.request(
      "/platform-status",
      { headers: { Authorization: "Bearer mcp-token" } },
      runtime
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      deployment: { target: "reference" },
    });
    expect(buildPlatformStatus).toHaveBeenCalledWith(runtime);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a non-administrator before running infrastructure probes", async () => {
    buildPlatformStatus.mockClear();
    const response = await mcp.request(
      "/platform-status",
      { headers: { Authorization: "Bearer mcp-token" } },
      { DB: database("member") } as Env
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "admin_required",
    });
    expect(buildPlatformStatus).not.toHaveBeenCalled();
  });
});

function database(role: "admin" | "member") {
  return createFakeD1((call) => {
    if (
      call.op === "first" &&
      call.sql.includes("SELECT user_id FROM mcp_tokens")
    ) {
      return { user_id: 7 };
    }
    if (
      call.op === "run" &&
      call.sql.includes("UPDATE mcp_tokens SET last_used_at")
    ) {
      return true;
    }
    if (
      call.op === "first" &&
      call.sql.includes("role IN ('owner', 'admin')")
    ) {
      return role === "admin" ? { role: "admin" } : null;
    }
    return undefined;
  });
}
