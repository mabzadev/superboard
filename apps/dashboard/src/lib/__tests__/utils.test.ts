import { describe, it, expect } from "vitest";
import {
  cn,
  deepEqual,
  mapKeyPairValues,
  parseSecondsInDaysHoursMinutesSeconds,
  formatPlatformName,
} from "../utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("handles conflicting tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("handles conditional classes", () => {
    expect(cn("base", false && "hidden", "visible")).toBe("base visible");
  });
});

describe("deepEqual", () => {
  it("returns true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("handles NaN equality", () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(NaN, 1)).toBe(false);
  });

  it("compares objects regardless of key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("handles undefined values in objects", () => {
    expect(deepEqual({ a: undefined }, { a: undefined })).toBe(true);
    expect(deepEqual({ a: undefined }, {})).toBe(false);
  });

  it("handles nested objects", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("handles arrays", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("distinguishes arrays from plain objects", () => {
    expect(deepEqual([1, 2], { "0": 1, "1": 2 })).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });

  it("distinguishes objects from null", () => {
    expect(deepEqual({}, null)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe("mapKeyPairValues", () => {
  it("converts object to key-value pairs", () => {
    const result = mapKeyPairValues({ name: "test", value: "123" });
    expect(result).toEqual([
      { key: "name", value: "test" },
      { key: "value", value: "123" },
    ]);
  });

  it("returns empty array for null/undefined", () => {
    expect(mapKeyPairValues(null)).toEqual([]);
    expect(mapKeyPairValues(undefined)).toEqual([]);
  });

  it("returns empty array for empty object", () => {
    expect(mapKeyPairValues({})).toEqual([]);
  });
});

describe("parseSecondsInDaysHoursMinutesSeconds", () => {
  it("returns 00:00:00 for falsy values", () => {
    expect(parseSecondsInDaysHoursMinutesSeconds(0)).toBe("00:00:00");
    expect(parseSecondsInDaysHoursMinutesSeconds(null)).toBe("00:00:00");
    expect(parseSecondsInDaysHoursMinutesSeconds(undefined)).toBe("00:00:00");
  });

  it("formats seconds correctly", () => {
    expect(parseSecondsInDaysHoursMinutesSeconds(3661)).toBe("01:01:01");
    expect(parseSecondsInDaysHoursMinutesSeconds(60)).toBe("00:01:00");
    expect(parseSecondsInDaysHoursMinutesSeconds(3600)).toBe("01:00:00");
  });

  it("handles days", () => {
    expect(parseSecondsInDaysHoursMinutesSeconds(86400)).toBe(
      "1 day and 0 hours"
    );
    expect(parseSecondsInDaysHoursMinutesSeconds(172800 + 7200)).toBe(
      "2 days and 2 hours"
    );
  });
});

describe("formatPlatformName", () => {
  it("formats iOS correctly", () => {
    expect(formatPlatformName("ios")).toBe("iOS");
    expect(formatPlatformName("IOS")).toBe("iOS");
  });

  it("capitalizes first letter of other platforms", () => {
    expect(formatPlatformName("android")).toBe("Android");
    expect(formatPlatformName("web")).toBe("Web");
  });

  it("returns empty string for falsy input", () => {
    expect(formatPlatformName("")).toBe("");
  });
});
