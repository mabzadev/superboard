export const ONBOARDING_EVENTS = ["impression","step_view","progress","back","skip","abandon","error","complete"] as const;
export type OnboardingEventType = (typeof ONBOARDING_EVENTS)[number];

export function parsePlacement(value: unknown) {
  const body = object(value);
  return {
    project_id: optional(body.project_id),
    placement: text(body.placement, "placement"),
    platform: enumValue(body.platform, ["ios", "android", "web"], "web"),
    customer_id: optional(body.customer_id),
    anonymous_id: optional(body.anonymous_id),
    app_version: optional(body.app_version),
    locale: optional(body.locale),
    attributes: record(body.attributes),
  };
}

export function parseEvents(value: unknown) {
  const body = object(value);
  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length || events.length > 100) throw new Error("events must contain 1 to 100 items");
  return {
    project_id: optional(body.project_id),
    events: events.map((value) => {
      const event = object(value);
      const type = text(event.type, "type");
      if (!(ONBOARDING_EVENTS as readonly string[]).includes(type)) throw new Error("unsupported event type");
      return {
        id: text(event.id, "id"),
        type: type as OnboardingEventType,
        placement: text(event.placement, "placement"),
        occurred_at: isoDate(event.occurred_at),
        platform: enumValue(event.platform, ["ios", "android", "web"], "web"),
        onboarding_id: optional(event.onboarding_id),
        version_id: optional(event.version_id),
        experience_id: optional(event.experience_id),
        variant_id: optional(event.variant_id),
        step_id: optional(event.step_id),
        customer_id: optional(event.customer_id),
        payload: record(event.payload),
      };
    }),
  };
}

export function validateDefinition(value: unknown) {
  const definition = object(value);
  const screens = Array.isArray(definition.screens) ? definition.screens : [];
  if (!screens.length || screens.length > 100) throw new Error("definition must contain 1 to 100 screens");
  const ids = new Set<string>();
  const normalized = screens.map((value, index) => {
    const screen = object(value);
    const id = text(screen.id, `screens[${index}].id`);
    if (ids.has(id)) throw new Error("screen ids must be unique");
    ids.add(id);
    const blocks = Array.isArray(screen.blocks) ? screen.blocks : [];
    if (blocks.length > 100) throw new Error("a screen cannot contain more than 100 blocks");
    const normalizedBlocks = blocks.map((value, blockIndex) => {
      const block = object(value);
      if (block.type !== "marketing_consent") return block;
      const props = object(block.props);
      if (props.default === true || props.required === true) {
        throw new Error("marketing consent must be optional and unchecked by default");
      }
      for (const field of ["title", "body"] as const) {
        if (props[field] !== undefined && (typeof props[field] !== "string" || props[field].length > 2000)) {
          throw new Error(`screens[${index}].blocks[${blockIndex}].props.${field} is invalid`);
        }
      }
      const listIds = props.list_ids === undefined ? [] : props.list_ids;
      if (!Array.isArray(listIds) || listIds.length > 50 || listIds.some((item) => typeof item !== "string" || !item.trim() || item.length > 255)) {
        throw new Error(`screens[${index}].blocks[${blockIndex}].props.list_ids is invalid`);
      }
      if (new Set(listIds).size !== listIds.length) {
        throw new Error("marketing consent list IDs must be unique");
      }
      if (props.attributes !== undefined) record(props.attributes);
      return { ...block, props: { ...props, list_ids: listIds } };
    });
    return { ...screen, id, blocks: normalizedBlocks };
  });
  return { ...definition, screens: normalized, theme: record(definition.theme) };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("value must be an object");
  return value as Record<string, unknown>;
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown, name: string) {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 255) throw new Error(`${name} is required`);
  return result;
}
function optional(value: unknown) { const result = typeof value === "string" ? value.trim() : ""; return result || undefined; }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("unsupported value");
  return value as T;
}
function isoDate(value: unknown) { const result = text(value, "occurred_at"); if (Number.isNaN(Date.parse(result))) throw new Error("occurred_at must be an ISO date"); return result; }
