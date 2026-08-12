export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_RESERVED_EVENT_PREFIX = "superboard.";

export const ANALYTICS_CANONICAL_EVENTS = Object.freeze({
  installationCreated: "superboard.analytics.installation.created.v1",
  purchaseVerified: "superboard.analytics.purchase.verified.v1",
  profileUpdated: "superboard.analytics.profile.updated.v1",
});

export const ANALYTICS_EVENT_SOURCES = [
  "sdk",
  "billing",
  "identity",
  "marketing",
  "system",
  "import",
] as const;

export type AnalyticsEventSource = (typeof ANALYTICS_EVENT_SOURCES)[number];

export type AnalyticsEventContextV1 = {
  platform?: string;
  app_version?: string;
  os_version?: string;
  sdk_name?: string;
  sdk_version?: string;
  locale?: string;
  timezone?: string;
};

export type AnalyticsEventV1 = {
  schema_version: typeof ANALYTICS_SCHEMA_VERSION;
  event_id: string;
  event_name: string;
  occurred_at: string;
  source: AnalyticsEventSource;
  application_id: string;
  app_instance_id?: string;
  session_id?: string;
  anonymous_id?: string;
  user_id?: string;
  properties: Record<string, unknown>;
  context?: AnalyticsEventContextV1;
};

export type AnalyticsIngestStatus = "accepted" | "duplicate" | "rejected";

export type AnalyticsIngestResultV1 = {
  event_id: string;
  status: AnalyticsIngestStatus;
  code?: string;
};

export type InstallationFactV1 = {
  event_id: string;
  application_id: string;
  app_instance_id_hash: string;
  installed_at: string;
  platform?: string;
  app_version?: string;
  attribution_id?: string;
};

export const VERIFIED_PURCHASE_EVENT_TYPES = [
  "initial_purchase",
  "renewal",
  "trial_converted",
  "refund",
  "chargeback",
  "cancellation",
] as const;

export type VerifiedPurchaseEventType =
  (typeof VERIFIED_PURCHASE_EVENT_TYPES)[number];

export type VerifiedPurchaseFactV1 = {
  event_id: string;
  store: "apple" | "google" | "stripe" | "manual";
  environment: "sandbox" | "production";
  store_transaction_id: string;
  event_type: VerifiedPurchaseEventType;
  product_id?: string;
  amount_micros?: number;
  currency?: string;
  occurred_at: string;
};

export type MarketingSignalV1 = {
  schema_version: typeof ANALYTICS_SCHEMA_VERSION;
  event_id: string;
  event_name: string;
  application_id: string;
  subject_hash: string | null;
  properties: Record<string, unknown>;
  occurred_at: string;
};

export function parseMarketingSignalV1(value: unknown): MarketingSignalV1 {
  const input = object(value, "analytics_marketing_signal_invalid");
  const schemaVersion = number(input.schema_version);
  if (schemaVersion !== ANALYTICS_SCHEMA_VERSION) {
    throw new AnalyticsContractError(
      "analytics_schema_unsupported",
      `Analytics schema version ${schemaVersion} is not supported`,
    );
  }
  const subjectHash =
    input.subject_hash === null || input.subject_hash === undefined
      ? null
      : boundedText(input.subject_hash, "subject_hash", 64);
  if (subjectHash !== null && !/^[a-f0-9]{64}$/u.test(subjectHash)) {
    throw new AnalyticsContractError(
      "analytics_subject_hash_invalid",
      "subject_hash must be a lowercase SHA-256 digest",
    );
  }
  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    event_id: identifier(input.event_id, "event_id"),
    event_name: text(input.event_name, "event_name", EVENT_NAME_PATTERN),
    application_id: identifier(input.application_id, "application_id"),
    subject_hash: subjectHash,
    properties: jsonObject(input.properties ?? {}, "properties"),
    occurred_at: timestamp(input.occurred_at, "occurred_at"),
  };
}

export type AnalyticsQueueMessageV1 = {
  schema_version: typeof ANALYTICS_SCHEMA_VERSION;
  type: "analytics.event.project";
  project_id: string;
  event_id: string;
};

export class AnalyticsContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AnalyticsContractError";
    this.code = code;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const EVENT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const CONTEXT_KEYS = new Set<keyof AnalyticsEventContextV1>([
  "platform",
  "app_version",
  "os_version",
  "sdk_name",
  "sdk_version",
  "locale",
  "timezone",
]);

export function parseAnalyticsEventsV1(
  value: unknown,
  options: {
    allowReserved?: boolean;
    defaultSource?: AnalyticsEventSource;
  } = {},
): AnalyticsEventV1[] {
  const record = object(value, "analytics_payload_invalid");
  const rawEvents = Array.isArray(record.events) ? record.events : [record];
  if (rawEvents.length === 0 || rawEvents.length > 100) {
    throw new AnalyticsContractError(
      "analytics_batch_invalid",
      "Analytics batches must contain between 1 and 100 events",
    );
  }
  return rawEvents.map((event) => parseAnalyticsEventV1(event, options));
}

export function parseAnalyticsEventV1(
  value: unknown,
  options: {
    allowReserved?: boolean;
    defaultSource?: AnalyticsEventSource;
  } = {},
): AnalyticsEventV1 {
  const input = object(value, "analytics_event_invalid");
  const schemaVersion = number(
    input.schema_version ?? ANALYTICS_SCHEMA_VERSION,
  );
  if (schemaVersion !== ANALYTICS_SCHEMA_VERSION) {
    throw new AnalyticsContractError(
      "analytics_schema_unsupported",
      `Analytics schema version ${schemaVersion} is not supported`,
    );
  }
  const eventId = identifier(input.event_id, "event_id");
  const eventName = text(input.event_name, "event_name", EVENT_NAME_PATTERN);
  const source = text(
    input.source ?? options.defaultSource ?? "sdk",
    "source",
  ) as AnalyticsEventSource;
  if (!ANALYTICS_EVENT_SOURCES.includes(source)) {
    throw new AnalyticsContractError(
      "analytics_source_invalid",
      "Analytics event source is invalid",
    );
  }
  if (
    eventName.startsWith(ANALYTICS_RESERVED_EVENT_PREFIX) &&
    !options.allowReserved
  ) {
    throw new AnalyticsContractError(
      "analytics_event_reserved",
      `Event names beginning with ${ANALYTICS_RESERVED_EVENT_PREFIX} are reserved`,
    );
  }
  const occurredAt = timestamp(input.occurred_at, "occurred_at");
  const applicationId = identifier(input.application_id, "application_id");
  const properties = jsonObject(input.properties ?? {}, "properties");
  const context = parseContext(input.context);
  return {
    schema_version: ANALYTICS_SCHEMA_VERSION,
    event_id: eventId,
    event_name: eventName,
    occurred_at: occurredAt,
    source,
    application_id: applicationId,
    ...optionalIdentifier("app_instance_id", input.app_instance_id),
    ...optionalIdentifier("session_id", input.session_id),
    ...optionalIdentifier("anonymous_id", input.anonymous_id),
    ...optionalIdentifier("user_id", input.user_id),
    properties,
    ...(context ? { context } : {}),
  };
}

export function stableAnalyticsJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function parseContext(value: unknown): AnalyticsEventContextV1 | undefined {
  if (value === undefined || value === null) return undefined;
  const input = object(value, "analytics_context_invalid");
  const unknownKeys = Object.keys(input).filter(
    (key) => !CONTEXT_KEYS.has(key as keyof AnalyticsEventContextV1),
  );
  if (unknownKeys.length > 0) {
    throw new AnalyticsContractError(
      "analytics_context_invalid",
      `Unknown analytics context field: ${unknownKeys[0]}`,
    );
  }
  const result: AnalyticsEventContextV1 = {};
  for (const key of CONTEXT_KEYS) {
    const candidate = input[key];
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }
    result[key] = boundedText(candidate, key, 255);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function optionalIdentifier<K extends string>(
  key: K,
  value: unknown,
): Partial<Record<K, string>> {
  if (value === undefined || value === null || value === "") return {};
  return { [key]: identifier(value, key) } as Partial<Record<K, string>>;
}

function identifier(value: unknown, field: string): string {
  return text(value, field, IDENTIFIER_PATTERN);
}

function text(value: unknown, field: string, pattern?: RegExp): string {
  const result = boundedText(value, field, 128);
  if (pattern && !pattern.test(result)) {
    throw new AnalyticsContractError(
      "analytics_field_invalid",
      `${field} has an invalid format`,
    );
  }
  return result;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new AnalyticsContractError(
      "analytics_field_invalid",
      `${field} must be a string`,
    );
  }
  const result = value.trim();
  if (!result || result.length > maximum) {
    throw new AnalyticsContractError(
      "analytics_field_invalid",
      `${field} must contain between 1 and ${maximum} characters`,
    );
  }
  return result;
}

function timestamp(value: unknown, field: string): string {
  const raw = boundedText(value, field, 64);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new AnalyticsContractError(
      "analytics_timestamp_invalid",
      `${field} must be a valid ISO 8601 timestamp`,
    );
  }
  return new Date(parsed).toISOString();
}

function number(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnalyticsContractError(code, "Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function jsonObject(value: unknown, field: string): Record<string, unknown> {
  const result = object(value, "analytics_properties_invalid");
  let keys = 0;
  validateJson(result, field, 0, () => {
    keys += 1;
    if (keys > 200) {
      throw new AnalyticsContractError(
        "analytics_properties_invalid",
        "Analytics properties may contain at most 200 keys",
      );
    }
  });
  return result;
}

function validateJson(
  value: unknown,
  path: string,
  depth: number,
  onKey: () => void,
): void {
  if (depth > 8) {
    throw new AnalyticsContractError(
      "analytics_properties_invalid",
      `${path} exceeds the maximum nesting depth`,
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (value.length > 8_192) {
      throw new AnalyticsContractError(
        "analytics_properties_invalid",
        `${path} contains a string larger than 8192 characters`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) {
      throw new AnalyticsContractError(
        "analytics_properties_invalid",
        `${path} contains an array larger than 100 items`,
      );
    }
    value.forEach((item, index) =>
      validateJson(item, `${path}[${index}]`, depth + 1, onKey),
    );
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      onKey();
      if (!key || key.length > 128) {
        throw new AnalyticsContractError(
          "analytics_properties_invalid",
          `${path} contains an invalid property name`,
        );
      }
      validateJson(child, `${path}.${key}`, depth + 1, onKey);
    }
    return;
  }
  throw new AnalyticsContractError(
    "analytics_properties_invalid",
    `${path} contains a non-JSON value`,
  );
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
