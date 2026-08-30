import { describe, expect, it } from "vitest";
import type { FlowGraph } from "@superboard/contracts/flows";
import { executeGraph } from "./graph";

const stateId = (id: string) => `state:${id}`;

describe("executeGraph", () => {
  it("starts every eligible automatic branch and renders SDK blocks", () => {
    const graph = simpleGraph();
    const result = executeGraph({
      graph,
      userProperties: { plan: "pro", __flow_user_id: "user-1" },
      activeBlockIds: [],
      event: { name: "identify" },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });
    expect(result.activeBlockIds).toEqual(["card"]);
    expect(result.exitedBlockIds).toEqual(["start"]);
    expect(result.updatedBlocks).toMatchObject([
      {
        id: "card",
        blockStateId: "state:card",
        workflowId: "workflow-1",
        componentType: "card",
      },
    ]);
  });

  it("uses propertyKey as the public SDK exit node", () => {
    const result = executeGraph({
      graph: simpleGraph(),
      userProperties: {},
      activeBlockIds: ["card"],
      event: { name: "transition", blockId: "card", propertyKey: "dismiss" },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });
    expect(result.completed).toBe(true);
    expect(result.activeBlockIds).toEqual([]);
    expect(result.exitedBlockIds).toContain("card");
  });

  it("uses default only as a fallback when no exact exit path exists", () => {
    const graph = simpleGraph();
    graph.blocks.push({
      id: "fallback",
      key: "fallback",
      type: "component",
      name: "Fallback",
      componentType: "card",
      data: {},
      propertyMeta: [],
      exitNodes: [],
      position: { x: 640, y: 0 },
    });
    graph.blocks.push({
      id: "purchase",
      key: "purchase",
      type: "component",
      name: "Purchase",
      componentType: "card",
      data: {},
      propertyMeta: [],
      exitNodes: [],
      position: { x: 640, y: 200 },
    });
    graph.paths.push(
      {
        id: "card-default",
        sourceBlockId: "card",
        sourceExitNode: "default",
        targetBlockId: "fallback",
      },
      {
        id: "card-purchase",
        sourceBlockId: "card",
        sourceExitNode: "purchase",
        targetBlockId: "purchase",
      },
    );
    const run = (propertyKey: string) => executeGraph({
      graph,
      userProperties: {},
      activeBlockIds: ["card"],
      event: { name: "transition", blockId: "card", propertyKey },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });

    expect(run("purchase").activeBlockIds).toEqual(["purchase"]);
    expect(run("unknown").activeBlockIds).toEqual(["fallback"]);
  });

  it("only starts a matching targeted Manual Start for workflow-start", () => {
    const graph = simpleGraph();
    graph.blocks[0] = {
      ...graph.blocks[0]!,
      id: "manual",
      key: "manual",
      type: "manual-start",
      conditions: [{
        key: "plan",
        data_type: "string",
        operator: "equals",
        value: "pro",
      }],
    };
    graph.paths[0] = { ...graph.paths[0]!, sourceBlockId: "manual" };
    const execute = (blockKey: string, plan: string) => executeGraph({
      graph,
      userProperties: { plan },
      activeBlockIds: [],
      event: { name: "workflow-start", blockKey },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });
    expect(execute("missing", "pro").activeBlockIds).toEqual([]);
    expect(execute("manual", "free").activeBlockIds).toEqual([]);
    expect(execute("manual", "pro").activeBlockIds).toEqual(["card"]);
  });

  it("triggers another branch without exiting a block-trigger component", () => {
    const graph = simpleGraph();
    graph.blocks[1]!.propertyMeta = [
      { key: "show-hint", type: "block-trigger" },
    ];
    graph.blocks.push({
      id: "hint",
      key: "hint",
      type: "component",
      name: "Hint",
      componentType: "hint",
      data: {},
      propertyMeta: [],
      exitNodes: ["default"],
      position: { x: 600, y: 200 },
    });
    graph.paths.push({
      id: "trigger",
      sourceBlockId: "card",
      sourceExitNode: "show-hint",
      targetBlockId: "hint",
      triggerOnly: true,
    });
    const result = executeGraph({
      graph,
      userProperties: {},
      activeBlockIds: ["card"],
      event: {
        name: "transition",
        blockId: "card",
        propertyKey: "items.0.show-hint",
      },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });
    expect(result.activeBlockIds).toEqual(["card", "hint"]);
    expect(result.exitedBlockIds).not.toContain("card");
  });

  it("schedules delay blocks and never renders them", () => {
    const graph = simpleGraph();
    graph.blocks.splice(1, 0, {
      id: "delay",
      key: "delay",
      type: "delay",
      name: "Delay",
      data: { days: 0, hours: 0, minutes: 5 },
      propertyMeta: [],
      exitNodes: ["default"],
      position: { x: 200, y: 120 },
    });
    graph.paths[0]!.targetBlockId = "delay";
    graph.paths.push({
      id: "after-delay",
      sourceBlockId: "delay",
      sourceExitNode: "default",
      targetBlockId: "card",
    });
    const result = executeGraph({
      graph,
      userProperties: {},
      activeBlockIds: [],
      event: { name: "identify" },
      workflowId: "workflow-1",
      blockStateId: stateId,
    });
    expect(result.activeBlockIds).toEqual(["delay"]);
    expect(result.delays).toEqual([
      { blockId: "delay", targetBlockId: "card", delayMs: 300_000 },
    ]);
    expect(result.updatedBlocks).toEqual([]);
  });

  it("keeps traffic split assignment stable for a user", () => {
    const graph = simpleGraph();
    graph.blocks[0] = {
      id: "split",
      key: "split",
      type: "traffic-split",
      name: "Experiment",
      data: {
        variants: [
          { key: "a", weight: 50 },
          { key: "b", weight: 50 },
        ],
      },
      propertyMeta: [],
      exitNodes: ["a", "b"],
      position: { x: 0, y: 0 },
    };
    graph.paths[0]!.sourceBlockId = "split";
    graph.paths[0]!.sourceExitNode = "a";
    graph.paths.push({
      id: "variant-b",
      sourceBlockId: "split",
      sourceExitNode: "b",
      targetBlockId: "card",
    });
    const run = () =>
      executeGraph({
        graph,
        userProperties: { __flow_user_id: "stable-user" },
        activeBlockIds: ["split"],
        event: { name: "enter" },
        workflowId: "workflow-1",
        blockStateId: stateId,
      });
    expect(run().activeBlockIds).toEqual(run().activeBlockIds);
  });

  it("sends a complete low-latency tour with the persisted current index", () => {
    const graph = simpleGraph();
    graph.blocks[1] = {
      id: "tour",
      key: "activation-tour",
      type: "tour",
      name: "Activation tour",
      componentLibraryName: "basics-v2",
      data: {
        steps: [
          {
            id: "welcome",
            componentKey: "modal",
            name: "Welcome",
            data: { title: "Welcome" },
          },
          {
            id: "profile-wait",
            type: "wait",
            wait: "element-present",
            anchor: "#profile-form",
          },
          {
            id: "profile",
            componentKey: "tooltip",
            anchor: "#profile-form",
          },
        ],
      },
      propertyMeta: [],
      exitNodes: ["complete", "cancel"],
      position: { x: 320, y: 120 },
      tourTrigger: {
        $and: [{ type: "navigation", operator: "equals", values: ["/profile"] }],
      },
    };
    graph.paths[0]!.targetBlockId = "tour";
    const result = executeGraph({
      graph,
      userProperties: {},
      activeBlockIds: [],
      event: { name: "identify" },
      workflowId: "workflow-1",
      blockStateId: stateId,
      tourIndexes: { tour: 2 },
    });
    expect(result.updatedBlocks).toMatchObject([
      {
        id: "tour",
        type: "tour",
        currentTourIndex: 2,
        tour_trigger: { $and: [{ type: "navigation" }] },
        tourBlocks: [
          { id: "welcome", type: "tour-component", componentType: "modal" },
          {
            id: "profile-wait",
            type: "wait",
            tourWait: { interaction: "dom-element", element: "#profile-form" },
          },
          { id: "profile", type: "tour-component", componentType: "tooltip" },
        ],
      },
    ]);
  });
});

function simpleGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    blocks: [
      {
        id: "start",
        key: "start",
        type: "start",
        name: "Start",
        data: {},
        propertyMeta: [],
        exitNodes: ["default"],
        position: { x: 0, y: 120 },
      },
      {
        id: "card",
        key: "card",
        type: "component",
        name: "Card",
        componentType: "card",
        data: { title: "Hello" },
        propertyMeta: [],
        exitNodes: ["default", "dismiss"],
        position: { x: 320, y: 120 },
      },
    ],
    paths: [
      {
        id: "start-card",
        sourceBlockId: "start",
        sourceExitNode: "default",
        targetBlockId: "card",
      },
    ],
  };
}
