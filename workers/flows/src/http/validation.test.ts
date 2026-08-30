import { describe, expect, it } from "vitest";
import { FlowHttpError } from "./errors";
import { parseFlowGraph } from "./validation";

describe("parseFlowGraph", () => {
  it("rejects Wait as a top-level block because Wait only exists inside Tours", () => {
    expect(() =>
      parseFlowGraph({
        schemaVersion: 1,
        blocks: [{
          id: "wait",
          key: "wait",
          type: "wait",
          name: "Wait",
          data: {},
          propertyMeta: [],
          exitNodes: ["default"],
          position: { x: 0, y: 0 },
        }],
        paths: [],
      })
    ).toThrow(FlowHttpError);
  });

  it("keeps nested Tour Wait steps in the Tour data contract", () => {
    const graph = parseFlowGraph({
      schemaVersion: 1,
      blocks: [{
        id: "tour",
        key: "tour",
        type: "tour",
        name: "Tour",
        data: {
          steps: [{
            id: "wait-navigation",
            type: "wait",
            wait: "navigation",
            page: "/dashboard",
          }],
        },
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 0 },
      }],
      paths: [],
    });
    expect(graph.blocks[0]?.data.steps).toEqual([
      expect.objectContaining({ id: "wait-navigation", type: "wait" }),
    ]);
  });
});
