import {
  FLOW_MAX_DELAY_MS,
  isFlowBlockType,
  isFlowEventName,
  isFlowPropertyType,
  type FlowEditorBlock,
  type FlowGraph,
  type FlowPath,
  type FlowPropertyMeta,
  type FlowSdkBlocksRequest,
  type FlowSdkEvent,
  type FlowSurveyQuestion,
  type FlowSurveySubmission,
  type FlowTargetCondition,
  type FlowTargetValue,
  type FlowTourTrigger,
  type FlowTourTriggerExpression,
  type FlowTourWait,
} from "@superboard/contracts/flows";
import { failure } from "./errors";

const MAX_JSON_BYTES = 1_048_576;
const IDENTIFIER = /^[a-z][a-z0-9_-]{0,127}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

export async function readJsonObject(
  request: Request,
  maximumBytes = MAX_JSON_BYTES,
): Promise<Record<string, unknown>> {
  const announced = Number(request.headers.get("content-length") ?? 0);
  if (announced > maximumBytes) {
    throw failure("request_too_large", "Request body is too large", 413);
  }
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("request body too large");
        throw failure("request_too_large", "Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isRecord(parsed)) throw new Error("body must be an object");
    return parsed;
  } catch {
    throw failure("json_invalid", "Request body must be a JSON object", 400);
  }
}

export function requiredString(
  value: unknown,
  field: string,
  maximum = 255,
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw failure(
      "validation_failed",
      `${field} must be a non-empty string of at most ${maximum} characters`,
      422,
      { field },
    );
  }
  return value.trim();
}

export function optionalString(
  value: unknown,
  field: string,
  maximum = 2_000,
): string | null {
  if (value == null || value === "") return null;
  return requiredString(value, field, maximum);
}

export function identifier(value: unknown, field: string): string {
  const result = requiredString(value, field, 128);
  if (!IDENTIFIER.test(result)) {
    throw failure(
      "validation_failed",
      `${field} must start with a letter and contain lowercase letters, numbers, underscores or hyphens`,
      422,
      { field },
    );
  }
  return result;
}

export function stableId(value: unknown, field: string): string {
  const result = requiredString(value, field, 192);
  if (!ID.test(result)) {
    throw failure("validation_failed", `${field} is invalid`, 422, {
      field,
    });
  }
  return result;
}

export function parseFlowGraph(value: unknown): FlowGraph {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw failure(
      "flow_graph_invalid",
      "graph.schemaVersion must equal 1",
      422,
    );
  }
  if (!Array.isArray(value.blocks) || !Array.isArray(value.paths)) {
    throw failure(
      "flow_graph_invalid",
      "graph blocks and paths must be arrays",
      422,
    );
  }
  if (value.blocks.length > 500 || value.paths.length > 2_000) {
    throw failure("flow_graph_too_large", "Workflow graph is too large", 422);
  }
  const blocks = value.blocks.map(parseBlock);
  const paths = value.paths.map(parsePath);
  const blockIds = new Set(blocks.map(({ id }) => id));
  if (blockIds.size !== blocks.length) {
    throw failure("flow_graph_invalid", "Block ids must be unique", 422);
  }
  if (new Set(blocks.map(({ key }) => key)).size !== blocks.length) {
    throw failure("flow_graph_invalid", "Block keys must be unique", 422);
  }
  if (new Set(paths.map(({ id }) => id)).size !== paths.length) {
    throw failure("flow_graph_invalid", "Path ids must be unique", 422);
  }
  for (const path of paths) {
    if (!blockIds.has(path.sourceBlockId) || !blockIds.has(path.targetBlockId)) {
      throw failure(
        "flow_graph_invalid",
        "Every path must reference existing blocks",
        422,
        { path_id: path.id },
      );
    }
  }
  return { schemaVersion: 1, blocks, paths };
}

export function assertPublishableFlowGraph(graph: FlowGraph): void {
  validateGraphTopology(graph.blocks, graph.paths);
}

function validateGraphTopology(
  blocks: readonly FlowEditorBlock[],
  paths: readonly FlowPath[],
): void {
  if (!blocks.some((block) => block.type === "start" || block.type === "manual-start")) {
    throw failure(
      "flow_graph_start_missing",
      "A workflow needs at least one Start or Manual Start block",
      422,
    );
  }
  const byId = new Map(blocks.map((block) => [block.id, block]));
  for (const block of blocks) {
    if (new Set(block.exitNodes).size !== block.exitNodes.length) {
      throw failure(
        "flow_graph_exit_node_duplicate",
        `Block ${block.key} has duplicate exit nodes`,
        422,
      );
    }
    if (block.type === "survey") {
      const questions = block.surveyQuestions ?? [];
      if (!questions.length) {
        throw failure(
          "flow_graph_survey_empty",
          `Survey ${block.key} needs at least one question`,
          422,
        );
      }
      if (new Set(questions.map((question) => question.id)).size !== questions.length) {
        throw failure(
          "flow_graph_survey_question_duplicate",
          `Survey ${block.key} has duplicate question ids`,
          422,
        );
      }
      validateSurveyQuestions(questions);
    }
    if (block.type === "tour") {
      const steps = Array.isArray(block.data.steps)
        ? block.data.steps
        : Array.isArray(block.data.screens)
          ? block.data.screens
          : [];
      if (!steps.length) {
        throw failure(
          "flow_graph_tour_empty",
          `Tour ${block.key} needs at least one step`,
          422,
        );
      }
    }
    if (
      block.type === "workflow-trigger" &&
      (
        typeof block.data.workflowId !== "string" ||
        !block.data.workflowId.trim() ||
        typeof block.data.blockKey !== "string" ||
        !block.data.blockKey.trim()
      )
    ) {
      throw failure(
        "flow_graph_workflow_trigger_invalid",
        `Workflow trigger ${block.key} needs a target workflow and Manual Start block key`,
        422,
      );
    }
    if (block.type === "traffic-split") {
      const variants = Array.isArray(block.data.variants)
        ? block.data.variants
        : [];
      const parsed = variants.filter(
        (variant): variant is { key: string; weight: number } =>
          isRecord(variant) &&
          typeof variant.key === "string" &&
          typeof variant.weight === "number" &&
          Number.isFinite(variant.weight) &&
          variant.weight >= 0,
      );
      if (
        parsed.length !== variants.length ||
        parsed.length < 2 ||
        new Set(parsed.map(({ key }) => key)).size !== parsed.length ||
        parsed.some(({ key }) => !block.exitNodes.includes(key)) ||
        parsed.reduce((sum, { weight }) => sum + weight, 0) <= 0
      ) {
        throw failure(
          "flow_graph_traffic_split_invalid",
          `Traffic split ${block.key} has invalid variants`,
          422,
        );
      }
    }
  }
  for (const path of paths) {
    const source = byId.get(path.sourceBlockId)!;
    if (path.triggerOnly) {
      const triggers = source.propertyMeta.filter(
        (property) => property.type === "block-trigger",
      );
      if (!triggers.some((property) => property.key === path.sourceExitNode)) {
        throw failure(
          "flow_graph_trigger_path_invalid",
          `Trigger path ${path.id} does not reference a block-trigger property`,
          422,
        );
      }
      continue;
    }
    const implicitDefault = new Set([
      "start",
      "manual-start",
      "note",
      "delay",
      "workflow-trigger",
    ]).has(source.type) && path.sourceExitNode === "default";
    if (!source.exitNodes.includes(path.sourceExitNode) && !implicitDefault) {
      throw failure(
        "flow_graph_exit_path_invalid",
        `Path ${path.id} references an unknown exit node`,
        422,
      );
    }
    if (source.type === "end") {
      throw failure(
        "flow_graph_end_path_invalid",
        "End blocks cannot have outgoing paths",
        422,
      );
    }
  }
  for (const block of blocks.filter((entry) => entry.type === "delay")) {
    const outgoing = paths.filter(
      (path) => path.sourceBlockId === block.id && !path.triggerOnly,
    );
    if (outgoing.length !== 1 || outgoing[0]?.sourceExitNode !== "default") {
      throw failure(
        "flow_graph_delay_path_invalid",
        `Delay ${block.key} must have exactly one default path`,
        422,
      );
    }
  }
  assertAcyclic(blocks, paths.filter((path) => !path.triggerOnly));
}

function assertAcyclic(
  blocks: readonly FlowEditorBlock[],
  paths: readonly FlowPath[],
): void {
  const outgoing = new Map<string, string[]>();
  for (const path of paths) {
    const targets = outgoing.get(path.sourceBlockId) ?? [];
    targets.push(path.targetBlockId);
    outgoing.set(path.sourceBlockId, targets);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!visit(target)) return false;
    }
    active.delete(id);
    visited.add(id);
    return true;
  };
  if (blocks.some((block) => !visit(block.id))) {
    throw failure(
      "flow_graph_cycle_invalid",
      "Workflow paths must not contain a cycle",
      422,
    );
  }
}

function parseBlock(value: unknown): FlowEditorBlock {
  if (!isRecord(value) || !isFlowBlockType(value.type)) {
    throw failure("flow_graph_invalid", "Block type is invalid", 422);
  }
  const position = isRecord(value.position) ? value.position : {};
  const propertyMeta = Array.isArray(value.propertyMeta)
    ? value.propertyMeta.map((property): FlowPropertyMeta => {
        if (!isRecord(property) || !isFlowPropertyType(property.type)) {
          throw failure(
            "flow_graph_invalid",
            "Block property type is invalid",
            422,
          );
        }
        const triggers = property.triggers == null
          ? property.triggers
          : parsePropertyTriggers(property.triggers);
        return {
          key: identifier(property.key, "property.key"),
          type: property.type,
          ...(Object.hasOwn(property, "value") ? { value: property.value } : {}),
          ...(triggers !== undefined ? { triggers } : {}),
        };
      })
    : [];
  const block: FlowEditorBlock = {
    id: stableId(value.id, "block.id"),
    key: identifier(value.key, "block.key"),
    type: value.type,
    name: requiredString(value.name ?? value.key, "block.name"),
    description: optionalString(value.description, "block.description") ?? undefined,
    componentType:
      optionalString(value.componentType, "block.componentType", 128) ?? null,
    componentLibraryName:
      optionalString(
        value.componentLibraryName,
        "block.componentLibraryName",
        128,
      ) ?? null,
    data: isRecord(value.data) ? value.data : {},
    propertyMeta,
    exitNodes: Array.isArray(value.exitNodes)
      ? value.exitNodes.map((entry) => identifier(entry, "block.exitNode"))
      : [],
    position: {
      x: finiteNumber(position.x, "block.position.x"),
      y: finiteNumber(position.y, "block.position.y"),
    },
    conditions: value.conditions == null
      ? undefined
      : parseTargetConditions(value.conditions),
    slottable: Boolean(value.slottable),
    slotId: optionalString(value.slotId, "block.slotId", 128),
    slotIndex:
      value.slotIndex == null
        ? null
        : integer(value.slotIndex, "block.slotIndex", 0, 10_000),
    pageTargetingOperator: optionalString(
      value.pageTargetingOperator,
      "block.pageTargetingOperator",
      64,
    ),
    pageTargetingValues: Array.isArray(value.pageTargetingValues)
      ? value.pageTargetingValues.map((entry) =>
          requiredString(entry, "block.pageTargetingValue", 512),
        )
      : null,
    notes: optionalString(value.notes, "block.notes", 10_000),
  };
  if (value.tourWait !== undefined) {
    block.tourWait = value.tourWait === null
      ? null
      : parseTourWait(value.tourWait);
  }
  if (value.tourTrigger !== undefined) {
    block.tourTrigger = value.tourTrigger === null
      ? null
      : parseTourTrigger(value.tourTrigger);
  }
  if (value.type === "delay") validateDelay(block.data);
  if (Array.isArray(value.surveyQuestions)) {
    if (value.surveyQuestions.length > 100) {
      throw failure("flow_graph_invalid", "A survey is limited to 100 questions", 422);
    }
    block.surveyQuestions = value.surveyQuestions.map(parseSurveyQuestion);
  }
  return block;
}

function validateSurveyQuestions(
  questions: readonly FlowSurveyQuestion[],
): void {
  for (const question of questions) {
    if (
      (question.type === "single-choice" ||
        question.type === "multiple-choice") &&
      !(question.options?.length || question.otherOption)
    ) {
      throw failure(
        "flow_graph_survey_options_missing",
        `Survey question ${question.id} needs at least one choice`,
        422,
      );
    }
    if (
      question.type === "rating" &&
      (question.minValue == null ||
        question.maxValue == null ||
        !Number.isInteger(question.minValue) ||
        !Number.isInteger(question.maxValue) ||
        question.minValue >= question.maxValue)
    ) {
      throw failure(
        "flow_graph_survey_rating_invalid",
        `Survey rating ${question.id} needs a valid integer range`,
        422,
      );
    }
    if (question.type === "link" && !question.url) {
      throw failure(
        "flow_graph_survey_link_invalid",
        `Survey link ${question.id} needs a URL`,
        422,
      );
    }
  }
}

function parsePropertyTriggers(value: unknown): FlowPropertyMeta["triggers"] {
  if (!Array.isArray(value) || value.length > 100) {
    throw failure("flow_graph_invalid", "Property triggers are invalid", 422);
  }
  return value.map((entry) => {
    if (!isRecord(entry) || !["manual", "transition"].includes(String(entry.type))) {
      throw failure("flow_graph_invalid", "Property trigger type is invalid", 422);
    }
    return {
      type: entry.type as "manual" | "transition",
      blockId: optionalString(entry.blockId, "property.trigger.blockId", 192),
      blockKey: optionalString(entry.blockKey, "property.trigger.blockKey", 128),
    };
  });
}

function parseTargetConditions(value: unknown): FlowTargetCondition[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw failure("flow_graph_invalid", "Block conditions are invalid", 422);
  }
  const dataTypes = new Set<FlowTargetCondition["data_type"]>([
    "string", "number", "boolean", "array",
  ]);
  const operators = new Set<FlowTargetCondition["operator"]>([
    "equals", "not-equals", "greater-than", "greater-than-or-equal",
    "less-than", "less-than-or-equal", "contains", "not-contains",
    "starts-with", "ends-with", "regex",
  ]);
  return value.map((entry) => {
    if (!isRecord(entry) ||
      !dataTypes.has(entry.data_type as FlowTargetCondition["data_type"]) ||
      !operators.has(entry.operator as FlowTargetCondition["operator"])) {
      throw failure("flow_graph_invalid", "Block condition is invalid", 422);
    }
    return {
      key: requiredString(entry.key, "condition.key", 192),
      data_type: entry.data_type as FlowTargetCondition["data_type"],
      operator: entry.operator as FlowTargetCondition["operator"],
      value: parseTargetValue(entry.value),
    };
  });
}

function parseTargetValue(value: unknown): FlowTargetValue | FlowTargetValue[] {
  const parseScalar = (entry: unknown): FlowTargetValue => {
    if (typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    throw failure("flow_graph_invalid", "Condition value is invalid", 422);
  };
  if (Array.isArray(value)) {
    if (!value.length || value.length > 100) {
      throw failure("flow_graph_invalid", "Condition values are invalid", 422);
    }
    return value.map(parseScalar);
  }
  return parseScalar(value);
}

function parseTourWait(value: unknown): FlowTourWait {
  const wait = record(value, "Tour wait");
  const interaction = wait.interaction == null
    ? undefined
    : requiredString(wait.interaction, "tourWait.interaction", 32);
  if (interaction && ![
    "navigation", "click", "delay", "dom-element", "not-dom-element",
  ].includes(interaction)) {
    throw failure("flow_graph_invalid", "Tour wait interaction is invalid", 422);
  }
  const page = wait.page == null ? undefined : record(wait.page, "Tour wait page");
  return {
    ...(interaction
      ? { interaction: interaction as NonNullable<FlowTourWait["interaction"]> }
      : {}),
    ...(page
      ? {
          page: {
            operator: requiredString(page.operator, "tourWait.page.operator", 64),
            value: stringArray(page.value, "tourWait.page.value", 100, 2_048),
          },
        }
      : {}),
    ...(wait.element == null
      ? {}
      : { element: requiredString(wait.element, "tourWait.element", 2_048) }),
    ...(wait.ms == null
      ? {}
      : { ms: integer(wait.ms, "tourWait.ms", 0, FLOW_MAX_DELAY_MS) }),
  };
}

function parseTourTrigger(value: unknown): FlowTourTrigger {
  const trigger = record(value, "Tour trigger");
  if (!Array.isArray(trigger.$and) || trigger.$and.length > 100) {
    throw failure("flow_graph_invalid", "Tour trigger expressions are invalid", 422);
  }
  return { $and: trigger.$and.map(parseTourTriggerExpression) };
}

function parseTourTriggerExpression(value: unknown): FlowTourTriggerExpression {
  const expression = record(value, "Tour trigger expression");
  const type = requiredString(expression.type, "tourTrigger.type", 32);
  if (!["navigation", "click", "dom-element", "not-dom-element"].includes(type)) {
    throw failure("flow_graph_invalid", "Tour trigger type is invalid", 422);
  }
  return {
    type: type as FlowTourTriggerExpression["type"],
    ...(expression.value == null
      ? {}
      : { value: requiredString(expression.value, "tourTrigger.value", 2_048) }),
    ...(expression.values == null
      ? {}
      : { values: stringArray(expression.values, "tourTrigger.values", 100, 2_048) }),
    ...(expression.operator == null
      ? {}
      : { operator: requiredString(expression.operator, "tourTrigger.operator", 64) }),
  };
}

function parseSurveyQuestion(value: unknown): FlowSurveyQuestion {
  const question = record(value, "Survey question");
  const type = requiredString(question.type, "survey.type", 64);
  if (![
    "freeform", "rating", "single-choice", "multiple-choice", "link", "end-screen",
  ].includes(type)) {
    throw failure("flow_graph_invalid", "Survey question type is invalid", 422);
  }
  const displayType = question.displayType == null
    ? null
    : requiredString(question.displayType, "survey.displayType", 16);
  if (displayType && !["number", "stars", "emoji"].includes(displayType)) {
    throw failure("flow_graph_invalid", "Survey rating display type is invalid", 422);
  }
  const options = question.options == null
    ? null
    : parseSurveyOptions(question.options);
  return {
    id: stableId(question.id, "survey.id"),
    type: type as FlowSurveyQuestion["type"],
    title: requiredString(question.title, "survey.title", 500),
    description: optionalString(question.description, "survey.description", 2_000) ?? undefined,
    optional: Boolean(question.optional),
    shuffleOptions: Boolean(question.shuffleOptions),
    otherOption: Boolean(question.otherOption),
    otherLabel: optionalString(question.otherLabel, "survey.otherLabel", 500),
    displayType: displayType as FlowSurveyQuestion["displayType"],
    minValue: optionalFiniteNumber(question.minValue, "survey.minValue"),
    maxValue: optionalFiniteNumber(question.maxValue, "survey.maxValue"),
    lowerBoundLabel: optionalString(question.lowerBoundLabel, "survey.lowerBoundLabel", 500),
    upperBoundLabel: optionalString(question.upperBoundLabel, "survey.upperBoundLabel", 500),
    textPlaceholder: optionalString(question.textPlaceholder, "survey.textPlaceholder", 500),
    linkLabel: optionalString(question.linkLabel, "survey.linkLabel", 500),
    url: optionalString(question.url, "survey.url", 2_048),
    openInNew: question.openInNew == null ? null : Boolean(question.openInNew),
    options,
  };
}

function parseSurveyOptions(value: unknown): FlowSurveyQuestion["options"] {
  if (!Array.isArray(value) || value.length > 100) {
    throw failure("flow_graph_invalid", "Survey options are invalid", 422);
  }
  const options = value.map((entry) => {
    const option = record(entry, "Survey option");
    return {
      id: stableId(option.id, "survey.option.id"),
      label: requiredString(option.label, "survey.option.label", 500),
    };
  });
  if (new Set(options.map(({ id }) => id)).size !== options.length) {
    throw failure("flow_graph_invalid", "Survey option ids must be unique", 422);
  }
  return options;
}

function parsePath(value: unknown): FlowPath {
  if (!isRecord(value)) {
    throw failure("flow_graph_invalid", "Path is invalid", 422);
  }
  return {
    id: stableId(value.id, "path.id"),
    sourceBlockId: stableId(value.sourceBlockId, "path.sourceBlockId"),
    sourceExitNode: identifier(
      value.sourceExitNode ?? "default",
      "path.sourceExitNode",
    ),
    targetBlockId: stableId(value.targetBlockId, "path.targetBlockId"),
    label: optionalString(value.label, "path.label", 255),
    triggerOnly: Boolean(value.triggerOnly),
  };
}

function validateDelay(data: Record<string, unknown>): void {
  const days = integer(data.days ?? 0, "delay.days", 0, 30);
  const hours = integer(data.hours ?? 0, "delay.hours", 0, 23);
  const minutes = integer(data.minutes ?? 0, "delay.minutes", 0, 59);
  if ((days * 24 * 60 + hours * 60 + minutes) * 60_000 > FLOW_MAX_DELAY_MS) {
    throw failure("delay_too_long", "Delay cannot exceed 30 days", 422);
  }
}

export function parseSdkBlocksRequest(value: unknown): FlowSdkBlocksRequest {
  const body = record(value, "SDK blocks request");
  return {
    ...sdkContext(body),
    userProperties: isRecord(body.userProperties) ? body.userProperties : {},
    language:
      optionalString(body.language, "language", 64) ?? undefined,
  };
}

export function parseSdkEvent(value: unknown): FlowSdkEvent {
  const body = record(value, "SDK event");
  if (!isFlowEventName(body.name)) {
    throw failure("flow_event_invalid", "Event name is invalid", 422);
  }
  return {
    ...sdkContext(body),
    eventId: optionalString(body.eventId, "eventId", 192) ?? undefined,
    name: body.name,
    workflowId: optionalString(body.workflowId, "workflowId", 192) ?? undefined,
    workflowVersionId:
      optionalString(body.workflowVersionId, "workflowVersionId", 192) ??
      undefined,
    blockId: optionalString(body.blockId, "blockId", 192) ?? undefined,
    blockStateId:
      optionalString(body.blockStateId, "blockStateId", 512) ?? undefined,
    blockKey: optionalString(body.blockKey, "blockKey", 128) ?? undefined,
    propertyKey:
      optionalString(body.propertyKey, "propertyKey", 128) ?? undefined,
    properties: isRecord(body.properties) ? body.properties : undefined,
    locale: optionalString(body.locale, "locale", 64) ?? undefined,
  };
}

export function parseSurveySubmission(value: unknown): FlowSurveySubmission {
  const body = record(value, "Survey submission");
  if (!Array.isArray(body.questions) || body.questions.length > 100) {
    throw failure("survey_response_invalid", "Survey questions are invalid", 422);
  }
  return {
    ...sdkContext(body),
    eventId: optionalString(body.eventId, "eventId", 192) ?? undefined,
    surveyId: stableId(body.surveyId, "surveyId"),
    blockStateId: stableId(body.blockStateId, "blockStateId"),
    workflowId:
      optionalString(body.workflowId, "workflowId", 192) ?? undefined,
    blockId: optionalString(body.blockId, "blockId", 192) ?? undefined,
    url: requiredString(body.url, "url", 2_048),
    questions: body.questions.map((entry) => {
      const question = record(entry, "Survey question response");
      return {
        questionId: stableId(question.questionId, "questionId"),
        textResponse:
          optionalString(question.textResponse, "textResponse", 20_000) ??
          undefined,
        optionIds: Array.isArray(question.optionIds)
          ? question.optionIds.map((id) => stableId(id, "optionId"))
          : undefined,
        otherSelected: Boolean(question.otherSelected),
        clickedLink: Boolean(question.clickedLink),
      };
    }),
  };
}

function sdkContext(body: Record<string, unknown>) {
  return {
    projectId: stableId(body.projectId, "projectId"),
    environment: identifier(body.environment, "environment"),
    userId: requiredString(body.userId, "userId", 512),
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw failure("validation_failed", `${label} must be an object`, 422);
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw failure("validation_failed", `${field} must be a finite number`, 422);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, field: string): number | null {
  if (value == null) return null;
  return finiteNumber(value, field);
}

function stringArray(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw failure("validation_failed", `${field} must be an array`, 422, { field });
  }
  return value.map((entry) => requiredString(entry, field, maximumLength));
}

function integer(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw failure(
      "validation_failed",
      `${field} must be an integer between ${minimum} and ${maximum}`,
      422,
    );
  }
  return value;
}
