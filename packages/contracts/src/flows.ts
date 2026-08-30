export const FLOW_BLOCK_TYPES = [
  "component",
  "tour-component",
  "survey",
  "tour",
  "filter",
  "start",
  "manual-start",
  "end",
  "workflow-trigger",
  "delay",
  "note",
  "traffic-split",
] as const;

export type FlowBlockType = (typeof FLOW_BLOCK_TYPES)[number];

export const FLOW_PROPERTY_TYPES = [
  "string",
  "number",
  "boolean",
  "select",
  "array",
  "state-memory",
  "block-trigger",
  "block-state",
  "action",
] as const;

export type FlowPropertyType = (typeof FLOW_PROPERTY_TYPES)[number];

export const FLOW_EVENT_NAMES = [
  "transition",
  "tour-update",
  "reset-progress",
  "workflow-start",
  "enter",
  "workflow-exit",
  "identify",
  "set-state-memory",
  "block-activated",
  "survey-submit",
] as const;

export type FlowEventName = (typeof FLOW_EVENT_NAMES)[number];
export type FlowWorkflowFrequency = "once" | "every-time";
export type FlowWorkflowMigrationStrategy =
  | "finish-current"
  | "restart-current"
  | "restart-all";
export type FlowUserState =
  | "not-started"
  | "in-progress"
  | "completed"
  | "stopped";
export type FlowWorkflowExitReason = "completed" | "stopped";
export type FlowQuestionType =
  | "freeform"
  | "rating"
  | "single-choice"
  | "multiple-choice"
  | "link"
  | "end-screen";
export type FlowEnvironmentKind = "production" | "test" | "development";
export type FlowWorkflowStatus = "draft" | "active" | "paused" | "archived";

export type FlowAction = {
  label: string;
  url?: string | null;
  openInNew?: boolean;
  exitNode?: string | null;
  targetBlockId?: string | null;
};

export type FlowPropertyMeta = {
  key: string;
  type: FlowPropertyType;
  value?: unknown;
  triggers?: ReadonlyArray<{
    type: "manual" | "transition";
    blockId?: string | null;
    blockKey?: string | null;
  }> | null;
};

export type FlowTargetValue = string | number | boolean;

export type FlowTargetCondition = {
  key: string;
  data_type: "string" | "number" | "boolean" | "array";
  operator:
    | "equals"
    | "not-equals"
    | "greater-than"
    | "greater-than-or-equal"
    | "less-than"
    | "less-than-or-equal"
    | "contains"
    | "not-contains"
    | "starts-with"
    | "ends-with"
    | "regex";
  value: FlowTargetValue | ReadonlyArray<FlowTargetValue>;
};

export type FlowDelayValue = {
  days: number;
  hours: number;
  minutes: number;
};

export const FLOW_MAX_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;

export type FlowSurveyQuestionOption = {
  id: string;
  label: string;
};

export type FlowSurveyQuestion = {
  id: string;
  type: FlowQuestionType;
  title: string;
  description?: string;
  optional?: boolean;
  shuffleOptions?: boolean;
  otherOption?: boolean;
  otherLabel?: string | null;
  displayType?: "number" | "stars" | "emoji" | null;
  minValue?: number | null;
  maxValue?: number | null;
  lowerBoundLabel?: string | null;
  upperBoundLabel?: string | null;
  textPlaceholder?: string | null;
  linkLabel?: string | null;
  url?: string | null;
  openInNew?: boolean | null;
  options?: ReadonlyArray<FlowSurveyQuestionOption> | null;
};

export type FlowTourWait = {
  interaction?:
    | "navigation"
    | "click"
    | "delay"
    | "dom-element"
    | "not-dom-element";
  page?: { operator: string; value: string[] };
  element?: string;
  ms?: number;
};

export type FlowTourTriggerExpression = {
  type: "navigation" | "click" | "dom-element" | "not-dom-element";
  value?: string;
  values?: string[];
  operator?: string;
};

export type FlowTourTrigger = {
  $and: FlowTourTriggerExpression[];
};

export type FlowEditorBlock = {
  id: string;
  key: string;
  type: FlowBlockType;
  name: string;
  description?: string;
  componentType?: string | null;
  componentLibraryName?: string | null;
  data: Record<string, unknown>;
  propertyMeta: FlowPropertyMeta[];
  exitNodes: string[];
  position: { x: number; y: number };
  conditions?: FlowTargetCondition[];
  slottable?: boolean;
  slotId?: string | null;
  slotIndex?: number | null;
  pageTargetingOperator?: string | null;
  pageTargetingValues?: string[] | null;
  tourWait?: FlowTourWait | null;
  tourTrigger?: FlowTourTrigger | null;
  surveyQuestions?: FlowSurveyQuestion[];
  notes?: string | null;
};

export type FlowPath = {
  id: string;
  sourceBlockId: string;
  sourceExitNode: string;
  targetBlockId: string;
  label?: string | null;
  triggerOnly?: boolean;
};

export type FlowGraph = {
  schemaVersion: 1;
  blocks: FlowEditorBlock[];
  paths: FlowPath[];
};

export type FlowSdkBlock = {
  id: string;
  blockStateId?: string | null;
  workflowId: string;
  componentLibraryName?: string | null;
  key?: string | null;
  type: "component" | "tour" | "survey";
  componentType?: string | null;
  data: Record<string, unknown>;
  propertyMeta: FlowPropertyMeta[];
  exitNodes: string[];
  slottable: boolean;
  slotId?: string | null;
  slotIndex?: number | null;
  page_targeting_operator?: string | null;
  page_targeting_values?: string[] | null;
  tour_trigger?: FlowTourTrigger | null;
  tourBlocks?: FlowSdkTourBlock[];
  currentTourIndex?: number | null;
  survey?: FlowSdkSurvey | null;
};

export type FlowSdkTourBlock = {
  id: string;
  workflowId: string;
  componentLibraryName?: string | null;
  key?: string | null;
  type: "tour-component" | "wait";
  componentType?: string | null;
  data: Record<string, unknown>;
  propertyMeta: FlowPropertyMeta[];
  slottable: boolean;
  slotId?: string | null;
  slotIndex?: number | null;
  page_targeting_operator?: string | null;
  page_targeting_values?: string[] | null;
  tourWait?: FlowTourWait | null;
};

export type FlowSdkSurvey = {
  id: string;
  blockStateId: string | null;
  questions: FlowSurveyQuestion[];
};

export type FlowWebSocketMessage = {
  exitedBlockIds: string[];
  updatedBlocks: FlowSdkBlock[];
};

export type FlowSdkRequestContext = {
  /** Canonical SuperBoard project reference, for example `42-test`. */
  projectId: string;
  environment: string;
  userId: string;
};

export type FlowSdkBlocksRequest = FlowSdkRequestContext & {
  userProperties?: Record<string, unknown>;
  language?: string;
};

export type FlowSdkEvent = FlowSdkRequestContext & {
  eventId?: string;
  name: FlowEventName;
  workflowId?: string;
  workflowVersionId?: string;
  blockId?: string;
  blockStateId?: string;
  blockKey?: string;
  propertyKey?: string;
  properties?: Record<string, unknown>;
  locale?: string;
};

export type FlowSurveyQuestionResponse = {
  questionId: string;
  textResponse?: string;
  optionIds?: string[];
  otherSelected?: boolean;
  clickedLink?: boolean;
};

export type FlowSurveySubmission = FlowSdkRequestContext & {
  eventId?: string;
  surveyId: string;
  blockStateId: string;
  workflowId?: string;
  blockId?: string;
  url: string;
  questions: FlowSurveyQuestionResponse[];
};

export type FlowQueueEvent = {
  schemaVersion: 1;
  eventId: string;
  projectId: number;
  projectRef: string;
  environmentId: string;
  /** HMAC-SHA256 pseudonym. Plain SDK user identifiers never enter the event queue. */
  userIdHash: string;
  name: FlowEventName;
  occurredAt: string;
  workflowId?: string;
  workflowVersionId?: string;
  blockId?: string;
  blockStateId?: string;
  blockKey?: string;
  propertyKey?: string;
  properties?: Record<string, unknown>;
  surveyResponse?: Omit<FlowSurveySubmission, keyof FlowSdkRequestContext>;
  legacyEventType?: string;
  /** Raw event identifier used by a legacy client before canonical namespacing. */
  sourceEventId?: string;
  legacySourceModule?: "paywalls" | "onboardings";
};

export type FlowApiError = {
  message: string;
  error: {
    code: string;
    message: string;
    request_id: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
};

export function isFlowBlockType(value: unknown): value is FlowBlockType {
  return (
    typeof value === "string" &&
    (FLOW_BLOCK_TYPES as readonly string[]).includes(value)
  );
}

export function isFlowPropertyType(value: unknown): value is FlowPropertyType {
  return (
    typeof value === "string" &&
    (FLOW_PROPERTY_TYPES as readonly string[]).includes(value)
  );
}

export function isFlowEventName(value: unknown): value is FlowEventName {
  return (
    typeof value === "string" &&
    (FLOW_EVENT_NAMES as readonly string[]).includes(value)
  );
}
