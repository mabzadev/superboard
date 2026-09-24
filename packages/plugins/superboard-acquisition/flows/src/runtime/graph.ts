import {
  FLOW_MAX_DELAY_MS,
  type FlowEditorBlock,
  type FlowGraph,
  type FlowPath,
  type FlowSdkBlock,
} from "@superboard/contracts/flows";
import { matchesTargeting } from "./targeting";

export type GraphExecutionInput = {
  graph: FlowGraph;
  userProperties: Readonly<Record<string, unknown>>;
  activeBlockIds: readonly string[];
  event: {
    name: string;
    blockId?: string;
    blockKey?: string;
    propertyKey?: string;
    properties?: Record<string, unknown>;
  };
  workflowId: string;
  blockStateId: (blockId: string) => string;
  tourIndexes?: Readonly<Record<string, number>>;
};

export type DelaySchedule = {
  blockId: string;
  targetBlockId: string;
  delayMs: number;
};

export type GraphExecutionResult = {
  activeBlockIds: string[];
  exitedBlockIds: string[];
  updatedBlocks: FlowSdkBlock[];
  completed: boolean;
  delays: DelaySchedule[];
};

export function executeGraph(input: GraphExecutionInput): GraphExecutionResult {
  const blocks = new Map(input.graph.blocks.map((block) => [block.id, block]));
  const outgoing = groupPaths(input.graph.paths);
  const active = new Set(input.activeBlockIds.filter((id) => blocks.has(id)));
  const exited = new Set<string>();
  const delays: DelaySchedule[] = [];

  const requestedManualStart =
    input.event.name === "workflow-start"
      ? resolveEventBlock(blocks, input.event.blockId, input.event.blockKey)
      : undefined;
  if (active.size === 0 && input.event.name !== "workflow-start") {
    for (const block of input.graph.blocks) {
      if (
        block.type === "start" &&
        matchesTargeting(block.conditions, input.userProperties)
      ) {
        active.add(block.id);
      }
    }
  }
  if (
    requestedManualStart?.type === "manual-start" &&
    matchesTargeting(requestedManualStart.conditions, input.userProperties)
  ) {
    active.add(requestedManualStart.id);
  }

  if (input.event.name === "transition") {
    const source = resolveEventBlock(blocks, input.event.blockId, input.event.blockKey);
    if (source && active.has(source.id)) {
      const exitNode =
        typeof input.event.propertyKey === "string"
          ? input.event.propertyKey
          : typeof input.event.properties?.exitNode === "string"
          ? input.event.properties.exitNode
          : "default";
      const triggersWithoutExit = source.propertyMeta.some(
        (property) =>
          property.type === "block-trigger" &&
          (property.key === exitNode || exitNode.endsWith(`.${property.key}`)),
      );
      if (triggersWithoutExit) {
        activateTriggerPaths(outgoing.get(source.id) ?? [], exitNode, active);
      } else {
        active.delete(source.id);
        exited.add(source.id);
        activatePaths(outgoing.get(source.id) ?? [], exitNode, active);
      }
    }
  }

  if (input.event.name === "reset-progress") {
    active.clear();
    exited.clear();
  }

  let guard = 0;
  let progressed = true;
  while (progressed && guard < input.graph.blocks.length * 4 + 4) {
    guard += 1;
    progressed = false;
    for (const blockId of [...active]) {
      const block = blocks.get(blockId);
      if (!block) continue;
      if (block.type === "filter") {
        active.delete(block.id);
        exited.add(block.id);
        const matched = matchesTargeting(block.conditions, input.userProperties);
        activatePaths(
          outgoing.get(block.id) ?? [],
          matched ? "match" : "no-match",
          active,
        );
        progressed = true;
      } else if (block.type === "traffic-split") {
        active.delete(block.id);
        exited.add(block.id);
        const variant = selectTrafficVariant(
          String(input.userProperties.__flow_user_id ?? "anonymous"),
          block,
        );
        activatePaths(outgoing.get(block.id) ?? [], variant, active);
        progressed = true;
      } else if (block.type === "note" || block.type === "start" || block.type === "manual-start") {
        active.delete(block.id);
        exited.add(block.id);
        activatePaths(outgoing.get(block.id) ?? [], "default", active);
        progressed = true;
      } else if (block.type === "end") {
        for (const id of active) exited.add(id);
        active.clear();
        progressed = false;
        break;
      } else if (block.type === "delay") {
        const path = firstPath(outgoing.get(block.id) ?? [], "default");
        if (path && !delays.some((entry) => entry.blockId === block.id)) {
          delays.push({
            blockId: block.id,
            targetBlockId: path.targetBlockId,
            delayMs: delayMilliseconds(block),
          });
        }
      }
    }
  }

  const renderable = [...active]
    .map((id) => blocks.get(id))
    .filter((block): block is FlowEditorBlock => Boolean(block))
    .filter((block) =>
      new Set(["component", "tour-component", "tour", "survey"]).has(
        block.type,
      ),
    )
    .map((block) =>
      sdkBlock(
        block,
        input.workflowId,
        input.blockStateId,
        input.tourIndexes?.[block.id] ?? 0,
      ),
    );

  return {
    activeBlockIds: [...active],
    exitedBlockIds: [...exited],
    updatedBlocks: renderable,
    completed: active.size === 0 && exited.size > 0,
    delays,
  };
}

function resolveEventBlock(
  blocks: ReadonlyMap<string, FlowEditorBlock>,
  blockId?: string,
  blockKey?: string,
): FlowEditorBlock | undefined {
  if (blockId) return blocks.get(blockId);
  if (blockKey) return [...blocks.values()].find((block) => block.key === blockKey);
  return undefined;
}

function groupPaths(paths: readonly FlowPath[]): Map<string, FlowPath[]> {
  const result = new Map<string, FlowPath[]>();
  for (const path of paths) {
    const values = result.get(path.sourceBlockId) ?? [];
    values.push(path);
    result.set(path.sourceBlockId, values);
  }
  return result;
}

function activatePaths(
  paths: readonly FlowPath[],
  exitNode: string,
  active: Set<string>,
): void {
  const exact = paths.filter(
    (path) => !path.triggerOnly && path.sourceExitNode === exitNode,
  );
  const matching = exact.length
    ? exact
    : paths.filter(
        (path) => !path.triggerOnly && path.sourceExitNode === "default",
      );
  for (const path of matching) active.add(path.targetBlockId);
}

function activateTriggerPaths(
  paths: readonly FlowPath[],
  exitNode: string,
  active: Set<string>,
): void {
  for (const path of paths) {
    if (
      path.triggerOnly &&
      (path.sourceExitNode === exitNode || exitNode.endsWith(`.${path.sourceExitNode}`))
    ) {
      active.add(path.targetBlockId);
    }
  }
}

function firstPath(paths: readonly FlowPath[], exitNode: string) {
  return paths.find(
    (path) => !path.triggerOnly && path.sourceExitNode === exitNode,
  );
}

function delayMilliseconds(block: FlowEditorBlock): number {
  const days = safeInteger(block.data.days, 0, 30);
  const hours = safeInteger(block.data.hours, 0, 23);
  const minutes = safeInteger(block.data.minutes, 0, 59);
  return Math.min(
    FLOW_MAX_DELAY_MS,
    (days * 24 * 60 + hours * 60 + minutes) * 60_000,
  );
}

function safeInteger(value: unknown, minimum: number, maximum: number): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : minimum;
}

export function selectTrafficVariant(userId: string, block: FlowEditorBlock): string {
  const variants = Array.isArray(block.data.variants)
    ? block.data.variants.filter(
        (entry): entry is { key: string; weight: number } =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).key === "string" &&
          typeof (entry as Record<string, unknown>).weight === "number",
      )
    : [];
  if (!variants.length) return "default";
  const assigned = typeof block.data.assignedVariantKey === "string"
    ? block.data.assignedVariantKey
    : null;
  if (
    assigned &&
    (variants.some((variant) => variant.key === assigned) ||
      (assigned === "holdout" && block.exitNodes.includes("holdout")))
  ) {
    return assigned;
  }
  const total = variants.reduce(
    (sum, variant) => sum + Math.max(0, variant.weight),
    0,
  );
  if (total <= 0) return variants[0].key;
  const bucket = fnv1a(`${userId}:${block.id}`) % total;
  let cursor = 0;
  for (const variant of variants) {
    cursor += Math.max(0, variant.weight);
    if (bucket < cursor) return variant.key;
  }
  return variants.at(-1)?.key ?? "default";
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function sdkBlock(
  block: FlowEditorBlock,
  workflowId: string,
  stateId: (blockId: string) => string,
  currentTourIndex = 0,
): FlowSdkBlock {
  return {
    id: block.id,
    blockStateId: stateId(block.id),
    workflowId,
    componentLibraryName: block.componentLibraryName ?? null,
    key: block.key,
    type:
      block.type === "survey"
        ? "survey"
        : block.type === "tour" || block.type === "tour-component"
          ? "tour"
          : "component",
    componentType: block.componentType ?? block.type,
    data: block.data,
    propertyMeta: block.propertyMeta,
    exitNodes: block.exitNodes,
    slottable: Boolean(block.slottable),
    slotId: block.slotId ?? null,
    slotIndex: block.slotIndex ?? null,
    page_targeting_operator: block.pageTargetingOperator ?? null,
    page_targeting_values: block.pageTargetingValues ?? null,
    tour_trigger: block.tourTrigger ?? null,
    ...(block.type === "tour" || block.type === "tour-component"
      ? {
          tourBlocks: tourSteps(block, workflowId),
          currentTourIndex,
        }
      : {}),
    ...(block.type === "survey"
      ? {
          survey: {
            id: block.id,
            blockStateId: stateId(block.id),
            questions: block.surveyQuestions ?? [],
          },
        }
      : {}),
  };
}

function tourSteps(
  block: FlowEditorBlock,
  workflowId: string,
): NonNullable<FlowSdkBlock["tourBlocks"]> {
  const rawSteps = Array.isArray(block.data.steps)
    ? block.data.steps
    : Array.isArray(block.data.screens)
      ? block.data.screens
      : [];
  return rawSteps.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const step = raw as Record<string, unknown>;
    const id = stringOr(step.id, `${block.id}:step:${index + 1}`);
    const wait = tourStepWait(step);
    const type = step.type === "wait" || Boolean(wait)
      ? "wait" as const
      : "tour-component" as const;
    const data = step.data && typeof step.data === "object" && !Array.isArray(step.data)
      ? step.data as Record<string, unknown>
      : { ...step };
    return [{
      id,
      workflowId,
      componentLibraryName: nullableString(
        step.componentLibraryName ?? block.componentLibraryName,
      ),
      key: nullableString(step.key ?? step.componentKey ?? step.name),
      type,
      componentType: nullableString(
        step.componentType ?? step.componentKey ?? block.componentType,
      ),
      data,
      propertyMeta: block.propertyMeta,
      slottable: Boolean(step.slottable ?? block.slottable),
      slotId: nullableString(step.slotId ?? block.slotId),
      slotIndex: typeof step.slotIndex === "number" && Number.isInteger(step.slotIndex)
        ? step.slotIndex
        : block.slotIndex ?? null,
      page_targeting_operator: nullableString(
        step.pageTargetingOperator ?? step.page_targeting_operator,
      ),
      page_targeting_values: stringList(
        step.pageTargetingValues ?? step.page_targeting_values,
      ),
      tourWait: wait,
    }];
  });
}

function tourStepWait(
  step: Record<string, unknown>,
): NonNullable<FlowSdkBlock["tourBlocks"]>[number]["tourWait"] {
  const existing = step.tourWait;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as NonNullable<FlowSdkBlock["tourBlocks"]>[number]["tourWait"];
  }
  const kind = typeof step.wait === "string" ? step.wait : null;
  if (!kind || kind === "none") return null;
  const interaction = kind === "element-present"
    ? "dom-element"
    : kind === "element-absent"
      ? "not-dom-element"
      : kind;
  if (![
    "navigation", "click", "delay", "dom-element", "not-dom-element",
  ].includes(interaction)) return null;
  return {
    interaction: interaction as NonNullable<
      NonNullable<FlowSdkBlock["tourBlocks"]>[number]["tourWait"]
    >["interaction"],
    ...(typeof step.anchor === "string" && step.anchor
      ? { element: step.anchor }
      : {}),
    ...(typeof step.waitMs === "number" ? { ms: step.waitMs } : {}),
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : null;
}
