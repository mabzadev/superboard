import { describe, expect, it } from "vitest";
import { validateWorkflowConfiguration } from "./workflows";

describe("Support workflow contracts", () => {
  it("accepts bounded nested condition groups and native actions", () => {
    expect(() => validateWorkflowConfiguration("automation_rule", {
      conditions: [
        {
          mode: "all",
          conditions: [
            { field: "status", operator: "equals", value: "open" },
            {
              mode: "any",
              conditions: [
                { field: "labels", operator: "includes_any", value: ["urgent", "vip"] },
                { field: "subject", operator: "matches", value: "refund|charge" },
              ],
            },
          ],
        },
      ],
      actions: [
        { type: "set_priority", value: "urgent" },
        { type: "assign_team", value: "billing" },
        { type: "add_label", value: "escalated" },
        { type: "send_message", body: "A specialist will reply shortly.", visibility: "public" },
      ],
    })).not.toThrow();
  });

  it("rejects unsupported actions, invalid patterns and excessive nesting", () => {
    expect(() => validateWorkflowConfiguration("automation_rule", {
      conditions: [{ field: "subject", operator: "matches", value: "[" }],
      actions: [{ type: "set_priority", value: "urgent" }],
    })).toThrowError(expect.objectContaining({ code: "workflow_condition_invalid" }));

    expect(() => validateWorkflowConfiguration("macro", {
      actions: [{ type: "execute_shell", value: "unsafe" }],
    })).toThrowError(expect.objectContaining({ code: "workflow_action_invalid" }));

    const nested = (depth: number): unknown => depth === 0
      ? { field: "status", operator: "equals", value: "open" }
      : { mode: "all", conditions: [nested(depth - 1)] };
    expect(() => validateWorkflowConfiguration("automation_rule", {
      conditions: [nested(4)],
      actions: [{ type: "set_status", value: "pending" }],
    })).toThrowError(expect.objectContaining({ code: "workflow_condition_invalid" }));
  });
});
