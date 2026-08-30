import { describe, expect, it } from "vitest";

import type { FlowGraph } from "@/api/flows/flowsService";
import {
  BASICS_V2_COMPONENT_TYPES,
  createBlock,
  createBlockFromDefinition,
  createPath,
  normalizeGraph,
  validateGraph,
} from "../graph";

describe("Flows graph editor model", () => {
  it("creates typed blocks with persistent keys and independent properties", () => {
    const first = createBlock("component", { x: 10, y: 20 }, 1);
    const second = createBlock("component", { x: 30, y: 40 }, 2);
    expect(first).toMatchObject({
      type: "component",
      key: "component_1",
      position: { x: 10, y: 20 },
      componentType: BASICS_V2_COMPONENT_TYPES.card,
      componentLibraryName: "Basics V2",
    });
    expect(first.id).not.toBe(second.id);
    first.data.title = "Welcome";
    expect(second.data.title).toBe("");
  });

  it("creates SDK-compatible blocks from the versioned component catalog", () => {
    const block = createBlockFromDefinition(
      {
        id: "tooltip-definition",
        library_id: "basics-library",
        library_name: "Basics V2",
        library_identifier: "basics-v2",
        name: "Tooltip",
        key: "tour-tooltip",
        component_type: BASICS_V2_COMPONENT_TYPES.tooltip,
        current_version: 4,
        schema: {
          template_type: "tour-component",
          description: "A guided tooltip.",
          slottable: true,
          properties: [
            { key: "title", type: "string" },
            { key: "hideProgress", type: "boolean" },
            { key: "primaryButton", type: "action" },
          ],
        },
        exit_nodes: [],
        css_variables: {},
      },
      { x: 42, y: 84 },
      3
    );

    expect(block).toMatchObject({
      key: "tour_tooltip_3",
      type: "tour-component",
      componentType: "BasicsV2Tooltip",
      componentLibraryName: "Basics V2",
      slottable: true,
      slotId: "default",
      data: {
        componentKey: "tour-tooltip",
        componentVersion: 4,
        title: "",
        hideProgress: false,
      },
      propertyMeta: [
        {
          key: "primaryButton",
          type: "action",
          value: { label: "", exitNode: null },
        },
      ],
      exitNodes: [],
    });
  });

  it("creates workflow triggers with the target manual-start key", () => {
    const block = createBlock("workflow-trigger", { x: 0, y: 0 }, 1);

    expect(block.data).toEqual({ workflowId: "", blockKey: "" });
  });

  it("validates starts, ends, unique keys, connections and the 30-day delay limit", () => {
    const start = createBlock("start", { x: 0, y: 0 }, 1);
    const delay = createBlock("delay", { x: 100, y: 0 }, 2);
    const end = createBlock("end", { x: 200, y: 0 }, 3);
    delay.data.days = 30;
    delay.data.hours = 0;
    delay.data.minutes = 0;
    const graph: FlowGraph = {
      schemaVersion: 1,
      blocks: [start, delay, end],
      paths: [createPath(start.id, delay.id), createPath(delay.id, end.id)],
    };
    expect(validateGraph(graph)).toEqual({ valid: true, issues: [] });
    delay.data.days = 30;
    delay.data.hours = 1;
    expect(validateGraph(graph)).toMatchObject({ valid: false });
    expect(validateGraph(graph).issues.map(({ message }) => message)).toContain(
      "Delay must be between 0 seconds and 30 days."
    );
  });

  it("normalizes missing backend graph fields without inventing content", () => {
    expect(normalizeGraph(null)).toEqual({
      schemaVersion: 1,
      blocks: [],
      paths: [],
    });
    expect(normalizeGraph({ blocks: [] })).toEqual({
      schemaVersion: 1,
      blocks: [],
      paths: [],
    });
  });
});
