import { createHash } from "node:crypto";

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value === undefined ? null : value;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
