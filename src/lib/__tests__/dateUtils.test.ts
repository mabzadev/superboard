import { describe, it, expect } from "vitest";
import {
  formatApiDate,
  formatApiStartOfDay,
  formatApiEndOfDay,
  formatShortDate,
  formatMediumDate,
  formatSlashDate,
  formatDayMonthYear,
  formatTime,
} from "../dateUtils";

describe("formatApiDate", () => {
  it("formats date with full timestamp", () => {
    const result = formatApiDate(new Date(2026, 2, 17, 14, 30, 45));
    expect(result).toBe("2026-03-17 14:30:45");
  });

  it("accepts string input", () => {
    const result = formatApiDate("2026-03-17T10:00:00");
    expect(result).toContain("2026-03-17");
  });
});

describe("formatApiStartOfDay", () => {
  it("formats to start of day", () => {
    const result = formatApiStartOfDay(new Date(2026, 2, 17, 14, 30, 45));
    expect(result).toBe("2026-03-17 00:00:00");
  });
});

describe("formatApiEndOfDay", () => {
  it("formats to end of day", () => {
    const result = formatApiEndOfDay(new Date(2026, 2, 17, 14, 30, 45));
    expect(result).toBe("2026-03-17 23:59:59");
  });
});

describe("formatShortDate", () => {
  it('formats as "MMM dd,yyyy"', () => {
    const result = formatShortDate(new Date(2026, 2, 17));
    expect(result).toBe("Mar 17,2026");
  });
});

describe("formatMediumDate", () => {
  it('formats as "MMM dd, yyyy"', () => {
    const result = formatMediumDate(new Date(2026, 2, 17));
    expect(result).toBe("Mar 17, 2026");
  });
});

describe("formatSlashDate", () => {
  it('formats as "yyyy/MM/dd"', () => {
    const result = formatSlashDate(new Date(2026, 2, 17));
    expect(result).toBe("2026/03/17");
  });
});

describe("formatDayMonthYear", () => {
  it('formats as "dd MMM yyyy"', () => {
    const result = formatDayMonthYear(new Date(2026, 2, 17));
    expect(result).toBe("17 Mar 2026");
  });
});

describe("formatTime", () => {
  it('formats as "HH:mm:ss"', () => {
    const result = formatTime(new Date(2026, 2, 17, 9, 5, 3));
    expect(result).toBe("09:05:03");
  });
});
