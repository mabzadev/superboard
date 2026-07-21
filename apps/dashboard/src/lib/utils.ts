import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const mapKeyPairValues = (
  keyPairValue: Record<string, string> | null | undefined
): { key: string; value: string }[] => {
  if (!keyPairValue) {
    return [];
  }
  const newData = Object.entries(keyPairValue).map(([key, value]) => ({
    key,
    value,
  }));
  return newData;
};

export const parseSecondsInDaysHoursMinutesSeconds = (
  value: number | null | undefined
) => {
  if (!value) return "00:00:00";

  const totalSeconds = Number(value);

  const days = Math.floor(totalSeconds / 86400); // 24 * 3600
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (days > 1) {
    return `${days} days and ${hours} hours`;
  } else if (days === 1) {
    return `${days} day and ${hours} hours`;
  }

  const formattedTime = `${String(hours).padStart(2, "0")}:${String(
    minutes
  ).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return formattedTime;
};

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    // Handle NaN === NaN (Object.is already covers this, but be explicit)
    if (typeof a === "number" && typeof b === "number") {
      return Number.isNaN(a) && Number.isNaN(b);
    }
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }

  return true;
}

/**
 * Deep clone a JSON-serializable value. Non-serializable values (File, Date, Map, etc.)
 * will be lost — only use on plain objects/arrays with primitive values.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function formatPlatformName(platform: string) {
  if (!platform) return "";

  if (platform.toLowerCase() === "ios") {
    return "iOS";
  }

  return platform.charAt(0).toUpperCase() + platform.slice(1);
}
