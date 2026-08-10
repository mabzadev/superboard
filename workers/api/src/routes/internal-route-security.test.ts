import { describe, expect, it } from "vitest";
import automation from "./automation";
import diagnostics from "./diagnostics";

describe("internal route credential transport", () => {
  it("never accepts the maintenance key from the query string", async () => {
    const response = await automation.request(
      "/run_maintenance?key=maintenance-secret",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      { MAINTENANCE_PROCESS_KEY: "maintenance-secret" } as never,
    );

    expect(response.status).toBe(403);
  });

  it("never accepts the diagnostics key from the query string", async () => {
    const response = await diagnostics.request(
      "/test_logs?api_key=diagnostics-secret",
      undefined,
      { DIAGNOSTICS_API_KEY: "diagnostics-secret" } as never,
    );

    expect(response.status).toBe(401);
  });

  it("rejects near-match header credentials", async () => {
    const [maintenance, diagnostic] = await Promise.all([
      automation.request(
        "/run_maintenance",
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-maintenance-key": "maintenance-secreu" },
          body: "{}",
        },
        { MAINTENANCE_PROCESS_KEY: "maintenance-secret" } as never,
      ),
      diagnostics.request(
        "/test_logs",
        { headers: { "x-diagnostics-key": "diagnostics-secreu" } },
        { DIAGNOSTICS_API_KEY: "diagnostics-secret" } as never,
      ),
    ]);

    expect(maintenance.status).toBe(403);
    expect(diagnostic.status).toBe(401);
  });
});
