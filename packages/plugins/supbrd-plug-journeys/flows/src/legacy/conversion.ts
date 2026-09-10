import type { FlowGraph, FlowTargetCondition } from "@superboard/contracts/flows";

export function paywallDefinitionToGraph(
  workflowId: string,
  definition: Record<string, unknown>,
): FlowGraph {
  const startId = `${workflowId}:legacy-start`;
  const commerceId = `${workflowId}:commerce`;
  return {
    schemaVersion: 1,
    blocks: [
      startBlock(startId),
      {
        id: commerceId,
        key: "superboard-commerce",
        type: "component",
        name: "SuperBoard Commerce",
        componentType: "superboard-commerce",
        componentLibraryName: "superboard",
        data: {
          schema_version: definition.schema_version ?? 1,
          theme: record(definition.theme),
          components: array(definition.components),
          metadata: record(definition.metadata),
          authority: "products",
          purchase_events_are_verified: true,
        },
        propertyMeta: [
          { key: "checkout", type: "action" },
          { key: "purchase", type: "action" },
          { key: "restore", type: "action" },
        ],
        exitNodes: [
          "impression",
          "cta",
          "dismiss",
          "checkout",
          "purchase",
          "cancel",
          "restore",
          "error",
        ],
        position: { x: 320, y: 100 },
        slottable: true,
        slotId: "paywall",
      },
    ],
    paths: [path(`${workflowId}:legacy-path`, startId, commerceId)],
  };
}

export function onboardingDefinitionToGraph(
  workflowId: string,
  definition: Record<string, unknown>,
): FlowGraph {
  const startId = `${workflowId}:legacy-start`;
  const tourId = `${workflowId}:onboarding-tour`;
  const screens = array(definition.screens).map((screen, index) => ({
    ...record(screen),
    id: stringValue(record(screen).id) || `screen-${index + 1}`,
    blocks: array(record(screen).blocks).map((block) => {
      const value = record(block);
      if (value.type !== "marketing_consent") return value;
      return {
        ...value,
        props: {
          ...record(value.props),
          default: false,
          required: false,
          explicit_action_required: true,
          destination: "marketing",
        },
      };
    }),
  }));
  return {
    schemaVersion: 1,
    blocks: [
      startBlock(startId),
      {
        id: tourId,
        key: "onboarding-tour",
        type: "tour",
        name: "Migrated onboarding",
        componentType: "superboard-onboarding",
        componentLibraryName: "superboard",
        data: {
          screens,
          theme: record(definition.theme),
          preload_all_steps: true,
        },
        propertyMeta: [],
        exitNodes: ["progress", "back", "skip", "abandon", "complete", "error"],
        position: { x: 320, y: 100 },
        slottable: true,
        slotId: "onboarding",
      },
    ],
    paths: [path(`${workflowId}:legacy-path`, startId, tourId)],
  };
}

export function legacyTargetingToConditions(
  targeting: Record<string, unknown>,
): FlowTargetCondition[] {
  const result: FlowTargetCondition[] = [];
  for (const [pluralSource, singularSource, key] of [
    ["platforms", "platform", "platform"],
    ["locales", "locale", "locale"],
    ["countries", "country", "country"],
  ] as const) {
    const plural = array(targeting[pluralSource]);
    const singular = targeting[singularSource];
    const values = [
      ...plural,
      ...(typeof singular === "string" ? [singular] : []),
    ]
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => normalizeLegacyDimension(key, entry));
    if (values.length) {
      result.push({
        key,
        data_type: "string",
        operator: "equals",
        value: values,
      });
    }
  }
  for (const [key, expected] of Object.entries(record(targeting.attributes))) {
    if (["string", "number", "boolean"].includes(typeof expected)) {
      result.push({
        key,
        data_type:
          typeof expected === "number"
            ? "number"
            : typeof expected === "boolean"
              ? "boolean"
              : "string",
        operator: "equals",
        value: expected as string | number | boolean,
      });
    }
  }
  return result;
}

/**
 * The removed Workers historically accepted lower/upper-case platform,
 * locale and country values interchangeably. Normalising both the stored
 * targeting values and the resolve request preserves that wire contract
 * without weakening comparison for arbitrary customer attributes.
 */
export function normalizeLegacyDimensions(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...properties,
    ...(typeof properties.platform === "string"
      ? { platform: normalizeLegacyDimension("platform", properties.platform) }
      : {}),
    ...(typeof properties.locale === "string"
      ? { locale: normalizeLegacyDimension("locale", properties.locale) }
      : {}),
    ...(typeof properties.country === "string"
      ? { country: normalizeLegacyDimension("country", properties.country) }
      : {}),
  };
}

function normalizeLegacyDimension(
  key: "platform" | "locale" | "country",
  value: string,
): string {
  const normalized = value.trim();
  return key === "country" ? normalized.toUpperCase() : normalized.toLowerCase();
}

export function legacyEventName(
  source: "paywalls" | "onboardings",
  type: string,
): "block-activated" | "transition" | "workflow-exit" {
  if (type === "impression" || type === "view" || type === "step_view") {
    return "block-activated";
  }
  if (["complete", "abandon", "skip"].includes(type)) return "workflow-exit";
  return "transition";
}

function startBlock(id: string): FlowGraph["blocks"][number] {
  return {
    id,
    key: "start",
    type: "start",
    name: "Start",
    data: {},
    propertyMeta: [],
    exitNodes: ["default"],
    position: { x: 0, y: 100 },
  };
}

function path(id: string, sourceBlockId: string, targetBlockId: string) {
  return {
    id,
    sourceBlockId,
    sourceExitNode: "default",
    targetBlockId,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
