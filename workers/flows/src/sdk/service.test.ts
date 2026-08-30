import { describe, expect, it } from "vitest";
import type { FlowGraph } from "@superboard/contracts/flows";
import { selectLaunchpadReleases } from "./service";

describe("selectLaunchpadReleases", () => {
  it("does not let a terminal once workflow consume launchpad capacity", () => {
    const completed = release("completed-once", 100, "once", "completed");
    const waiting = release("waiting-once", 10, "once", null);
    expect(selectLaunchpadReleases([completed, waiting])).toEqual([
      expect.objectContaining({ workflowId: waiting.workflowId }),
    ]);
  });

  it("does not reserve capacity for a higher-priority workflow that is not targeted", () => {
    const notTargeted = release("not-targeted", 100, "once", null, {
      key: "plan",
      data_type: "string",
      operator: "equals",
      value: "enterprise",
    });
    const targeted = release("targeted", 10, "once", null);
    expect(selectLaunchpadReleases([notTargeted, targeted], { plan: "free" }))
      .toEqual([expect.objectContaining({ workflowId: targeted.workflowId })]);
  });

  it("uses the next ordered group when the first membership is paused", () => {
    const candidate = release("multi-group", 100, "once", null);
    candidate.launchpadGroups = [
      { ...candidate.launchpadGroups[0]!, groupId: "paused", paused: true },
      { ...candidate.launchpadGroups[0]!, groupId: "eligible", position: 1 },
    ];
    expect(selectLaunchpadReleases([candidate])).toEqual([
      expect.objectContaining({
        workflowId: "multi-group",
        launchpadAssignedGroupId: "eligible",
      }),
    ]);
  });

  it("keeps a running fallback workflow assigned to the group that started it", () => {
    const running = release("running", 100, "once", "in-progress");
    const waiting = release("waiting", 10, "once", null);
    const memberships = [
      { ...running.launchpadGroups[0]!, groupId: "paused", paused: true },
      {
        ...running.launchpadGroups[0]!,
        groupId: "fallback",
        position: 1,
        concurrency: 1,
      },
    ];
    running.launchpadGroups = memberships;
    running.launchpadAssignedGroupId = "fallback";
    waiting.launchpadGroups = memberships.map((membership) => ({ ...membership }));

    expect(selectLaunchpadReleases([running, waiting])).toEqual([running]);
  });

  it("reassigns a running workflow when its previous group membership was removed", () => {
    const running = release("moved", 100, "once", "in-progress");
    running.launchpadAssignedGroupId = "removed-group";
    running.launchpadGroups = [{
      ...running.launchpadGroups[0]!,
      groupId: "new-group",
    }];

    expect(selectLaunchpadReleases([running])).toEqual([
      expect.objectContaining({
        workflowId: "moved",
        launchpadAssignedGroupId: "new-group",
      }),
    ]);
  });
});

function release(
  workflowId: string,
  launchpadPriority: number,
  frequency: "once" | "every-time",
  state: "completed" | "in-progress" | null,
  condition?: FlowGraph["blocks"][number]["conditions"][number],
) {
  return {
    workflowId,
    workflowVersionId: `${workflowId}-version`,
    frequency,
    migrationStrategy: "finish-current" as const,
    graph: {
      schemaVersion: 1,
      blocks: [{
        id: "start",
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 0 },
        conditions: condition ? [condition] : [],
      }],
      paths: [],
    } satisfies FlowGraph,
    launchpadGroups: [{
      groupId: "group-1",
      position: 0,
      priority: launchpadPriority,
      paused: false,
      concurrency: 1,
    }],
    snapshot: state
      ? {
          workflowId,
          workflowVersionId: `${workflowId}-version`,
          state,
          activeBlockIds: [],
          exitedBlockIds: [],
          updatedBlocks: [],
          duplicate: false,
        }
      : null,
  };
}
