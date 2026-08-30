import { describe, expect, it } from "vitest";
import { flowWorkflowInstanceId } from "./instance-id";

describe("flowWorkflowInstanceId", () => {
  it("creates a deterministic Cloudflare-safe ID for long Delay and maintenance keys", async () => {
    const businessId = `${"event:".repeat(80)}:delay:${"block:".repeat(80)}`;
    const first = await flowWorkflowInstanceId("flow:delay", businessId);
    const second = await flowWorkflowInstanceId("flow:delay", businessId);

    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(100);
    expect(first).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/u);
    expect(await flowWorkflowInstanceId(
      "flows-maintenance",
      "11:1786636800000:purge",
    )).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9-_]*$/u);
  });
});
