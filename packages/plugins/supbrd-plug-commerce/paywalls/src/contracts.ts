export const PAYWALL_EVENTS = [
  "impression",
  "view",
  "cta",
  "dismiss",
  "checkout",
  "purchase",
  "cancel",
  "error",
  "restore",
] as const;
export const COMPONENT_TYPES = [
  "heading",
  "text",
  "image",
  "product",
  "button",
  "close",
  "legal",
  "spacer",
] as const;
export const EXPERIENCE_STATUSES = [
  "draft",
  "running",
  "paused",
  "completed",
  "archived",
] as const;
export type PaywallEvent = (typeof PAYWALL_EVENTS)[number];

export function parsePaywall(value: unknown) {
  const body = object(value);
  return {
    identifier: identifier(body.identifier, "identifier"),
    display_name: text(body.display_name, "display_name"),
    description: optional(body.description, 2_000),
  };
}

export function parseVersion(value: unknown) {
  const body = object(value);
  const definition = object(body.definition, "definition");
  const components = Array.isArray(definition.components)
    ? definition.components
    : [];
  if (components.length > 200)
    throw invalid(
      "components_too_many",
      "definition.components is limited to 200 items",
    );
  const ids = new Set<string>();
  const parsed = components.map((value, index) => {
    const component = object(value, `definition.components[${index}]`);
    const id = identifier(component.id, `definition.components[${index}].id`);
    if (ids.has(id))
      throw invalid(
        "component_id_duplicate",
        `Component id ${id} is duplicated`,
      );
    ids.add(id);
    const type = choice(
      component.type,
      `definition.components[${index}].type`,
      COMPONENT_TYPES,
    );
    return {
      id,
      type,
      props: object(
        component.props ?? {},
        `definition.components[${index}].props`,
      ),
    };
  });
  return {
    definition: {
      schema_version: integer(
        definition.schema_version ?? 1,
        "definition.schema_version",
        1,
        1,
      ),
      theme: object(definition.theme ?? {}, "definition.theme"),
      components: parsed,
      metadata: object(definition.metadata ?? {}, "definition.metadata"),
    },
    changelog: optional(body.changelog, 2_000),
  };
}

export function parsePlacementAdmin(value: unknown) {
  const body = object(value);
  return {
    key: identifier(body.key, "key"),
    paywall_id: text(body.paywall_id, "paywall_id"),
    active_version_id: optional(body.active_version_id),
    experience_id: optional(body.experience_id),
    targeting: parseTargeting(body.targeting ?? {}),
    priority: integer(body.priority ?? 0, "priority", -100_000, 100_000),
    active: boolean(body.active, false),
  };
}

export function parseExperience(value: unknown) {
  const body = object(value);
  const variants = Array.isArray(body.variants) ? body.variants : [];
  if (!variants.length || variants.length > 20)
    throw invalid("variants_invalid", "variants must contain 1 to 20 items");
  const parsedVariants = variants.map((value, index) => {
    const variant = object(value, `variants[${index}]`);
    return {
      id: optional(variant.id) ?? crypto.randomUUID(),
      key: identifier(variant.key, `variants[${index}].key`),
      version_id: text(variant.version_id, `variants[${index}].version_id`),
      weight: integer(variant.weight, `variants[${index}].weight`, 1, 10_000),
      active: boolean(variant.active, true),
    };
  });
  if (
    new Set(parsedVariants.map((variant) => variant.key)).size !==
    parsedVariants.length
  )
    throw invalid("variant_key_duplicate", "Variant keys must be unique");
  return {
    paywall_id: text(body.paywall_id, "paywall_id"),
    name: text(body.name, "name"),
    status: choice(body.status ?? "draft", "status", EXPERIENCE_STATUSES),
    traffic_percent: integer(
      body.traffic_percent ?? 100,
      "traffic_percent",
      0,
      100,
    ),
    starts_at: body.starts_at == null ? null : iso(body.starts_at, "starts_at"),
    ends_at: body.ends_at == null ? null : iso(body.ends_at, "ends_at"),
    variants: parsedVariants,
  };
}

export function parsePlacement(value: unknown) {
  const body = object(value);
  return {
    project_id: optional(body.project_id),
    placement: identifier(body.placement, "placement"),
    platform: optional(body.platform),
    customer_id: optional(body.customer_id),
    subject_id:
      optional(body.subject_id) ??
      optional(body.customer_id) ??
      optional(body.session_id),
    locale: optional(body.locale),
    country: optional(body.country),
    attributes: targetingAttributes(body.attributes ?? {}),
  };
}

export function parseEvents(value: unknown) {
  const body = object(value);
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length || events.length > 100)
    throw invalid("events_invalid", "events must contain 1 to 100 items");
  const parsedEvents = events.map((value, index) => {
    const event = object(value, `events[${index}]`);
    return {
      id: text(event.id, `events[${index}].id`),
      type: choice(event.type, `events[${index}].type`, PAYWALL_EVENTS),
      placement: identifier(event.placement, `events[${index}].placement`),
      occurred_at: iso(event.occurred_at, `events[${index}].occurred_at`),
      paywall_id: optional(event.paywall_id),
      version_id: optional(event.version_id),
      experience_id: optional(event.experience_id),
      variant_id: optional(event.variant_id),
      platform: optional(event.platform),
      customer_id: optional(event.customer_id),
      session_id: optional(event.session_id),
      revenue_micros: integer(
        event.revenue_micros ?? 0,
        `events[${index}].revenue_micros`,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      currency: currency(event.currency),
      payload: object(event.payload ?? {}, `events[${index}].payload`),
    };
  });
  if (
    new Set(parsedEvents.map((event) => event.id)).size !== parsedEvents.length
  )
    throw invalid(
      "event_id_duplicate",
      "Event identifiers must be unique within a batch",
    );
  return {
    project_id: optional(body.project_id),
    events: parsedEvents,
  };
}

export function parseStatistics(query: Record<string, string>) {
  const to = query.to ? new Date(query.to) : new Date();
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to))
    to.setUTCDate(to.getUTCDate() + 1);
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * 86_400_000);
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from >= to ||
    to.getTime() - from.getTime() > 366 * 86_400_000
  )
    throw invalid(
      "statistics_range_invalid",
      "Statistics range must be valid and no longer than 366 days",
    );
  const timezone = query.timezone || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(from);
  } catch {
    throw invalid("timezone_invalid", "timezone must be a valid IANA timezone");
  }
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    timezone,
    interval: choice(query.interval ?? "day", "interval", [
      "hour",
      "day",
      "week",
      "month",
    ] as const),
    platform: query.platform || null,
    placement: query.placement_id || null,
    version_id: query.version_id || null,
    experience_id: query.experience_id || null,
    variant_id: query.variant_id || null,
  };
}

export function parseTargeting(value: unknown) {
  const body = object(value, "targeting");
  return {
    platforms: textArray(body.platforms, "targeting.platforms", 20),
    locales: textArray(body.locales, "targeting.locales", 100),
    countries: textArray(body.countries, "targeting.countries", 250).map(
      (country) => country.toUpperCase(),
    ),
    attributes: targetingAttributes(body.attributes ?? {}),
  };
}

export function object(value: unknown, name = "body"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid("object_required", `${name} must be an object`);
  return value as Record<string, unknown>;
}
export function text(value: unknown, name: string, max = 255): string {
  if (typeof value !== "string")
    throw invalid(`${name}_required`, `${name} is required`);
  const result = value.trim();
  if (!result || result.length > max)
    throw invalid(
      `${name}_invalid`,
      `${name} must contain 1 to ${max} characters`,
    );
  return result;
}
export function optional(value: unknown, max = 255): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string")
    throw invalid("text_invalid", "Text value expected");
  const result = value.trim();
  if (result.length > max)
    throw invalid("text_too_long", `Text is limited to ${max} characters`);
  return result || null;
}
export function boolean(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value !== "boolean")
    throw invalid("boolean_invalid", "Boolean value expected");
  return value;
}
export function integer(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw invalid(
      `${name}_invalid`,
      `${name} must be an integer between ${min} and ${max}`,
    );
  return value;
}
export function choice<const T extends readonly string[]>(
  value: unknown,
  name: string,
  values: T,
): T[number] {
  const result = String(value ?? "");
  if (!values.includes(result))
    throw invalid(
      `${name}_invalid`,
      `${name} must be one of ${values.join(", ")}`,
    );
  return result as T[number];
}
export function invalid(code: string, message: string, status = 422): Error {
  return Object.assign(new Error(message), { code, status });
}
function identifier(value: unknown, name: string): string {
  const result = text(value, name, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result))
    throw invalid(`${name}_invalid`, `${name} contains unsupported characters`);
  return result;
}
function iso(value: unknown, name: string): string {
  const date = new Date(text(value, name));
  if (Number.isNaN(date.getTime()))
    throw invalid(`${name}_invalid`, `${name} must be an ISO-8601 date`);
  return date.toISOString();
}
function currency(value: unknown): string | null {
  if (value == null || value === "") return null;
  const result = text(value, "currency", 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(result))
    throw invalid("currency_invalid", "currency must be an ISO-4217 code");
  return result;
}
function textArray(value: unknown, name: string, max: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max)
    throw invalid(
      `${name}_invalid`,
      `${name} must be an array of at most ${max} items`,
    );
  return [...new Set(value.map((item) => text(item, name)))];
}

function targetingAttributes(
  value: unknown,
): Record<
  string,
  string | number | boolean | Array<string | number | boolean>
> {
  const attributes = object(value, "targeting.attributes");
  const parsed: Record<
    string,
    string | number | boolean | Array<string | number | boolean>
  > = {};
  for (const [key, expected] of Object.entries(attributes)) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(key))
      throw invalid(
        "targeting_attribute_invalid",
        "Targeting attribute keys are invalid",
      );
    const values = Array.isArray(expected) ? expected : [expected];
    if (
      !values.length ||
      values.length > 50 ||
      values.some(
        (item) =>
          !["string", "number", "boolean"].includes(typeof item) ||
          (typeof item === "string" && item.length > 255),
      )
    )
      throw invalid(
        "targeting_attribute_invalid",
        "Targeting attributes accept bounded scalar values or arrays",
      );
    parsed[key] = Array.isArray(expected)
      ? (values as Array<string | number | boolean>)
      : (values[0] as string | number | boolean);
  }
  return parsed;
}
