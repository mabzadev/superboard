import type { FlowGraph, FlowSdkBlock } from "@superboard/contracts/flows";
import { describe, expect, it } from "vitest";
import { applyMemoryUpdates, transitionMemoryUpdates } from "./state-memory";

describe("transition state memory", () => {
  it("sets memory only after the configured block exits", () => {
    const graph: FlowGraph = {
      schemaVersion: 1,
      paths: [],
      blocks: [
        editorBlock("source", "source-key", []),
        editorBlock("card", "card-key", [
          {
            key: "completed",
            type: "state-memory",
            value: false,
            triggers: [{ type: "transition", blockKey: "source-key" }],
          },
        ]),
      ],
    };
    const updates = transitionMemoryUpdates(graph, ["source"]);
    expect([...updates]).toEqual([["completed", true]]);
    const output = applyMemoryUpdates([sdkBlock()], updates);
    expect(output[0]?.propertyMeta[0]?.value).toBe(true);
  });
});

function editorBlock(id: string, key: string, propertyMeta: FlowGraph["blocks"][number]["propertyMeta"]): FlowGraph["blocks"][number] {
  return {
    id,
    key,
    type: "component",
    data: {},
    propertyMeta,
    exitNodes: ["default"],
    position: { x: 0, y: 0 },
  };
}

function sdkBlock(): FlowSdkBlock {
  return {
    id: "card",
    workflowId: "workflow",
    type: "component",
    data: {},
    propertyMeta: [{ key: "completed", type: "state-memory", value: false }],
    exitNodes: ["default"],
    slottable: false,
  };
}
