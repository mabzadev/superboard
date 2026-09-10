import type {
  FlowGraph,
  FlowSdkBlock,
} from "@superboard/contracts/flows";

export function transitionMemoryUpdates(
  graph: FlowGraph,
  exitedBlockIds: readonly string[],
): ReadonlyMap<string, true> {
  const exitedIds = new Set(exitedBlockIds);
  const exitedKeys = new Set(
    graph.blocks
      .filter((block) => exitedIds.has(block.id))
      .map((block) => block.key)
      .filter((key): key is string => Boolean(key)),
  );
  const updates = new Map<string, true>();
  for (const block of graph.blocks) {
    for (const property of block.propertyMeta) {
      if (property.type !== "state-memory") continue;
      if (
        property.triggers?.some(
          (trigger) =>
            trigger.type === "transition" &&
            ((trigger.blockId != null && exitedIds.has(trigger.blockId)) ||
              (trigger.blockKey != null && exitedKeys.has(trigger.blockKey))),
        )
      ) {
        updates.set(property.key, true);
      }
    }
  }
  return updates;
}

export function applyMemoryUpdates(
  blocks: readonly FlowSdkBlock[],
  updates: ReadonlyMap<string, true>,
): FlowSdkBlock[] {
  if (!updates.size) return [...blocks];
  return blocks.map((block) => ({
    ...block,
    propertyMeta: block.propertyMeta.map((property) =>
      property.type === "state-memory" && updates.has(property.key)
        ? { ...property, value: true }
        : property,
    ),
  }));
}
