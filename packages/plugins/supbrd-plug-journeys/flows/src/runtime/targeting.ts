import type {
  FlowTargetCondition,
  FlowTargetValue,
} from "@superboard/contracts/flows";

export function matchesTargeting(
  conditions: readonly FlowTargetCondition[] | undefined,
  properties: Readonly<Record<string, unknown>>,
): boolean {
  if (!conditions?.length) return true;
  return conditions.every((condition) => {
    const candidates = Array.isArray(condition.value)
      ? condition.value
      : [condition.value];
    return candidates.some((candidate) =>
      compare(properties[condition.key], condition.operator, candidate),
    );
  });
}

function compare(
  actual: unknown,
  operator: FlowTargetCondition["operator"],
  expected: FlowTargetValue,
): boolean {
  switch (operator) {
    case "equals":
      return actual === expected;
    case "not-equals":
      return actual !== expected;
    case "greater-than":
      return numbers(actual, expected, (left, right) => left > right);
    case "greater-than-or-equal":
      return numbers(actual, expected, (left, right) => left >= right);
    case "less-than":
      return numbers(actual, expected, (left, right) => left < right);
    case "less-than-or-equal":
      return numbers(actual, expected, (left, right) => left <= right);
    case "contains":
      return Array.isArray(actual)
        ? actual.includes(expected)
        : String(actual ?? "").includes(String(expected));
    case "not-contains":
      return Array.isArray(actual)
        ? !actual.includes(expected)
        : !String(actual ?? "").includes(String(expected));
    case "starts-with":
      return String(actual ?? "").startsWith(String(expected));
    case "ends-with":
      return String(actual ?? "").endsWith(String(expected));
    case "regex":
      return safeRegex(String(expected)).test(String(actual ?? ""));
  }
}

function numbers(
  actual: unknown,
  expected: FlowTargetValue,
  operation: (left: number, right: number) => boolean,
): boolean {
  return (
    typeof actual === "number" &&
    typeof expected === "number" &&
    Number.isFinite(actual) &&
    Number.isFinite(expected) &&
    operation(actual, expected)
  );
}

function safeRegex(pattern: string): RegExp {
  if (pattern.length > 256) return /$a/u;
  try {
    return new RegExp(pattern, "u");
  } catch {
    return /$a/u;
  }
}

export function personalize(
  value: string,
  properties: Readonly<Record<string, unknown>>,
): string {
  return value.replace(
    /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/gu,
    (_match, key: string, fallback?: string) => {
      const resolved = key.split(".").reduce<unknown>((current, part) => {
        if (
          typeof current !== "object" ||
          current === null ||
          Array.isArray(current)
        ) {
          return undefined;
        }
        return (current as Record<string, unknown>)[part];
      }, properties);
      return resolved == null || resolved === ""
        ? (fallback?.trim() ?? "")
        : String(resolved);
    },
  );
}

export function personalizeValue(
  value: unknown,
  properties: Readonly<Record<string, unknown>>,
): unknown {
  if (typeof value === "string") return personalize(value, properties);
  if (Array.isArray(value)) {
    return value.map((entry) => personalizeValue(entry, properties));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        personalizeValue(entry, properties),
      ]),
    );
  }
  return value;
}
