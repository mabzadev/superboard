import type {
  FlowBlock,
  FlowBlockType,
  FlowComponentDefinition,
  FlowGraph,
  FlowPath,
} from "@/api/flows/flowsService";
import type {
  FlowPropertyMeta,
  FlowPropertyType,
} from "@superboard/contracts/flows";

export const BASICS_V2_COMPONENT_TYPES = {
  card: "BasicsV2Card",
  floatingChecklist: "BasicsV2FloatingChecklist",
  hint: "BasicsV2Hint",
  modal: "BasicsV2Modal",
  tooltip: "BasicsV2Tooltip",
  surveyPopover: "BasicsV2SurveyPopover",
} as const;

export type FlowGraphIssue = {
  blockId?: string;
  pathId?: string;
  message: string;
};

export type FlowGraphValidation = {
  valid: boolean;
  issues: FlowGraphIssue[];
};

export const BLOCK_CATALOG: ReadonlyArray<{
  type: FlowBlockType;
  label: string;
  category: "Logic" | "Experience" | "Utility";
  description: string;
  defaultProperties?: Record<string, unknown>;
}> = [
  {
    type: "start",
    label: "Start",
    category: "Logic",
    description: "Automatically starts when typed targeting rules match.",
  },
  {
    type: "manual-start",
    label: "Manual start",
    category: "Logic",
    description: "Starts only through the SDK startWorkflow API.",
  },
  {
    type: "component",
    label: "Component",
    category: "Experience",
    description: "Render Card, Checklist, Hint, Modal or Tooltip.",
    defaultProperties: { title: "", body: "" },
  },
  {
    type: "tour-component",
    label: "Tour component",
    category: "Experience",
    description: "A component step anchored to a client element.",
    defaultProperties: { anchor: "" },
  },
  {
    type: "tour",
    label: "Tour",
    category: "Experience",
    description: "Sequence of low-latency guided steps.",
    defaultProperties: { steps: [] },
  },
  {
    type: "survey",
    label: "Survey",
    category: "Experience",
    description: "Freeform, rating, choice, link and end-screen questions.",
    defaultProperties: {},
  },
  {
    type: "filter",
    label: "Filter",
    category: "Logic",
    description: "Routes users through typed conditions.",
    defaultProperties: {},
  },
  {
    type: "traffic-split",
    label: "Traffic split",
    category: "Logic",
    description: "Stable weighted assignment used by migrated experiments.",
    defaultProperties: {
      variants: [
        { key: "a", weight: 50 },
        { key: "b", weight: 50 },
      ],
    },
  },
  {
    type: "delay",
    label: "Delay",
    category: "Logic",
    description: "Pauses a branch for up to 30 days.",
    defaultProperties: { days: 0, hours: 1, minutes: 0 },
  },
  {
    type: "workflow-trigger",
    label: "Workflow trigger",
    category: "Logic",
    description: "Runs another workflow and waits for its completion.",
    defaultProperties: { workflowId: "", blockKey: "" },
  },
  {
    type: "end",
    label: "End",
    category: "Logic",
    description: "Stops every active branch in this workflow.",
  },
  {
    type: "note",
    label: "Note",
    category: "Utility",
    description: "Editor-only documentation with no runtime effect.",
    defaultProperties: { text: "" },
  },
] as const;

export function createBlock(
  type: FlowBlockType,
  position: { x: number; y: number },
  index: number
): FlowBlock {
  const definition = BLOCK_CATALOG.find((item) => item.type === type);
  const id = crypto.randomUUID();
  return {
    id,
    key: `${type.replaceAll("-", "_")}_${index}`,
    type,
    name: definition?.label ?? type,
    description: definition?.description,
    position,
    componentType:
      type === "component"
        ? BASICS_V2_COMPONENT_TYPES.card
        : type === "tour-component"
          ? BASICS_V2_COMPONENT_TYPES.tooltip
          : type === "survey"
            ? BASICS_V2_COMPONENT_TYPES.surveyPopover
            : null,
    componentLibraryName:
      type === "component" || type === "tour-component" || type === "survey"
        ? "Basics V2"
        : null,
    data: structuredClone(definition?.defaultProperties ?? {}),
    propertyMeta: [],
    exitNodes:
      type === "end" || type === "note"
        ? []
        : type === "filter"
          ? ["match", "no-match"]
          : type === "traffic-split"
            ? ["a", "b"]
            : ["default"],
    ...(type === "filter" ? { conditions: [] } : {}),
    ...(type === "survey" ? { surveyQuestions: [] } : {}),
    ...(type === "note" ? { notes: "" } : {}),
  };
}

type ComponentPropertyDefinition = {
  key: string;
  type: FlowPropertyType;
  default?: unknown;
  defaultValue?: unknown;
  options?: unknown;
};

export function createBlockFromDefinition(
  component: FlowComponentDefinition,
  position: { x: number; y: number },
  index: number
): FlowBlock {
  const schema = component.schema;
  const blockType = componentBlockType(component);
  const properties = componentProperties(schema);
  const data: Record<string, unknown> = {
    componentKey: component.key,
    componentVersion: component.current_version ?? 1,
  };
  const propertyMeta: FlowPropertyMeta[] = [];

  for (const property of properties) {
    const value = componentPropertyDefault(property);
    if (
      property.type === "action" ||
      property.type === "state-memory" ||
      property.type === "block-trigger" ||
      property.type === "block-state"
    ) {
      propertyMeta.push({ key: property.key, type: property.type, value });
    } else {
      data[property.key] = value;
    }
  }

  return {
    id: crypto.randomUUID(),
    key: `${component.key.replaceAll("-", "_")}_${index}`,
    type: blockType,
    name:
      blockType === "tour-component"
        ? `${component.name} tour step`
        : component.name,
    description:
      typeof schema.description === "string"
        ? schema.description
        : `Render ${component.name}.`,
    position,
    componentType: component.component_type,
    componentLibraryName:
      component.library_name ?? component.library_identifier ?? "Basics V2",
    data,
    propertyMeta,
    exitNodes: [...component.exit_nodes],
    slottable: schema.slottable === true,
    slotId: schema.slottable === true ? "default" : null,
    slotIndex: schema.slottable === true ? 0 : null,
    ...(blockType === "survey" ? { surveyQuestions: [] } : {}),
  };
}

export function applyComponentDefinition(
  block: FlowBlock,
  component: FlowComponentDefinition
): FlowBlock {
  const definitionBlock = createBlockFromDefinition(
    component,
    block.position,
    1
  );
  const nextData = { ...definitionBlock.data };
  for (const key of Object.keys(nextData)) {
    if (
      key in block.data &&
      key !== "componentKey" &&
      key !== "componentVersion"
    ) {
      nextData[key] = block.data[key];
    }
  }
  const propertyMeta = definitionBlock.propertyMeta.map((property) => {
    const existing = block.propertyMeta.find(
      (candidate) =>
        candidate.key === property.key && candidate.type === property.type
    );
    return existing ? structuredClone(existing) : property;
  });
  const definitionPropertyKeys = new Set(
    definitionBlock.propertyMeta.map((property) => property.key)
  );
  propertyMeta.push(
    ...block.propertyMeta
      .filter((property) => !definitionPropertyKeys.has(property.key))
      .map((property) => structuredClone(property))
  );
  return {
    ...definitionBlock,
    id: block.id,
    key: block.key,
    name: block.name,
    description: block.description ?? definitionBlock.description,
    position: block.position,
    data: nextData,
    propertyMeta,
    surveyQuestions:
      definitionBlock.type === "survey"
        ? (block.surveyQuestions ?? [])
        : undefined,
  };
}

export function componentBlockType(
  component: FlowComponentDefinition
): Extract<FlowBlockType, "component" | "tour-component" | "survey"> {
  const templateType = component.schema.template_type;
  if (templateType === "tour-component") return "tour-component";
  if (templateType === "survey-component") return "survey";
  return "component";
}

function componentProperties(
  schema: Record<string, unknown>
): ComponentPropertyDefinition[] {
  if (!Array.isArray(schema.properties)) return [];
  return schema.properties.filter(
    (property): property is ComponentPropertyDefinition =>
      Boolean(property) &&
      typeof property === "object" &&
      !Array.isArray(property) &&
      typeof (property as { key?: unknown }).key === "string" &&
      isFlowPropertyType((property as { type?: unknown }).type)
  );
}

function isFlowPropertyType(value: unknown): value is FlowPropertyType {
  return new Set<FlowPropertyType>([
    "string",
    "number",
    "boolean",
    "select",
    "array",
    "action",
    "state-memory",
    "block-trigger",
    "block-state",
  ]).has(value as FlowPropertyType);
}

function componentPropertyDefault(
  property: ComponentPropertyDefinition
): unknown {
  if (property.default !== undefined) return structuredClone(property.default);
  if (property.defaultValue !== undefined)
    return structuredClone(property.defaultValue);
  switch (property.type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "select":
      return Array.isArray(property.options) &&
        typeof property.options[0] === "string"
        ? property.options[0]
        : "";
    case "array":
      return [];
    case "action":
      return { label: "", exitNode: null };
    case "state-memory":
      return false;
    case "block-trigger":
      return { blockKey: "" };
    case "block-state":
      return { blockKey: "", state: "active" };
  }
}

export function createPath(
  sourceBlockId: string,
  targetBlockId: string,
  sourceExitNode = "default"
): FlowPath {
  return {
    id: crypto.randomUUID(),
    sourceBlockId,
    sourceExitNode,
    targetBlockId,
  };
}

export function validateGraph(graph: FlowGraph): FlowGraphValidation {
  const issues: FlowGraphIssue[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();

  for (const block of graph.blocks) {
    if (ids.has(block.id))
      issues.push({ blockId: block.id, message: "Block id must be unique." });
    ids.add(block.id);
    if (!block.key.trim())
      issues.push({
        blockId: block.id,
        message: "Persistent key is required.",
      });
    if (keys.has(block.key))
      issues.push({
        blockId: block.id,
        message: "Persistent key must be unique.",
      });
    keys.add(block.key);
    if (!block.name.trim())
      issues.push({ blockId: block.id, message: "Block name is required." });
    if (block.type === "delay") {
      const duration =
        (Number(block.data.days ?? 0) * 24 * 60 +
          Number(block.data.hours ?? 0) * 60 +
          Number(block.data.minutes ?? 0)) *
        60;
      if (
        !Number.isFinite(duration) ||
        duration < 0 ||
        duration > 30 * 24 * 60 * 60
      ) {
        issues.push({
          blockId: block.id,
          message: "Delay must be between 0 seconds and 30 days.",
        });
      }
    }
  }

  if (
    !graph.blocks.some(
      (block) => block.type === "start" || block.type === "manual-start"
    )
  ) {
    issues.push({
      message: "At least one Start or Manual start block is required.",
    });
  }
  for (const path of graph.paths) {
    if (!ids.has(path.sourceBlockId))
      issues.push({
        pathId: path.id,
        message: "Connection source is missing.",
      });
    if (!ids.has(path.targetBlockId))
      issues.push({
        pathId: path.id,
        message: "Connection target is missing.",
      });
    if (path.sourceBlockId === path.targetBlockId)
      issues.push({
        pathId: path.id,
        message: "A block cannot connect to itself.",
      });
  }

  return { valid: issues.length === 0, issues };
}

export function normalizeGraph(value: unknown): FlowGraph {
  if (!value || typeof value !== "object")
    return { schemaVersion: 1, blocks: [], paths: [] };
  const candidate = value as Partial<FlowGraph>;
  return {
    schemaVersion: 1,
    blocks: Array.isArray(candidate.blocks) ? candidate.blocks : [],
    paths: Array.isArray(candidate.paths) ? candidate.paths : [],
  };
}
