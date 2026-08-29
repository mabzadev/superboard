import { describe, expect, it } from "vitest";
import {
  addBusinessMinutes,
  matchesSlaConditions,
} from "./service-levels";

const weekdaySchedule = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [{ start: "09:00", end: "17:00" }],
  wednesday: [{ start: "09:00", end: "17:00" }],
  thursday: [{ start: "09:00", end: "17:00" }],
  friday: [{ start: "09:00", end: "17:00" }],
  saturday: [],
  sunday: [],
};

describe("Support service-level calendar", () => {
  it("carries business minutes over a weekend and a DST transition", () => {
    // 15:30 Friday in Zurich (UTC+2), followed by the UTC+1 Monday.
    const result = addBusinessMinutes(
      new Date("2026-10-23T13:30:00.000Z"),
      120,
      "Europe/Zurich",
      weekdaySchedule,
    );
    expect(result?.toISOString()).toBe("2026-10-26T08:30:00.000Z");
  });

  it("skips closed dates and starts at the next open interval", () => {
    const result = addBusinessMinutes(
      new Date("2026-10-23T16:00:00.000Z"),
      60,
      "Europe/Zurich",
      weekdaySchedule,
      ["2026-10-26"],
    );
    expect(result?.toISOString()).toBe("2026-10-27T09:00:00.000Z");
  });

  it("fails closed for invalid timezones, empty schedules, overlaps, and invalid clocks", () => {
    expect(addBusinessMinutes(new Date(), 60, "Invalid/Zone", weekdaySchedule)).toBeNull();
    expect(addBusinessMinutes(new Date(), 60, "UTC", {})).toBeNull();
    expect(addBusinessMinutes(new Date(), 60, "UTC", {
      monday: [
        { start: "09:00", end: "12:00" },
        { start: "11:00", end: "13:00" },
      ],
    })).toBeNull();
    expect(addBusinessMinutes(new Date(), 60, "UTC", {
      monday: [{ start: "25:00", end: "26:00" }],
    })).toBeNull();
  });
});

describe("Support SLA conditions", () => {
  const conversation = {
    inbox_id: "inbox-priority",
    priority: "urgent",
    status: "open",
    channel_type: "email_google",
    labels_json: JSON.stringify(["vip", "refund"]),
  };

  it("supports empty, all, any, and label conditions", () => {
    expect(matchesSlaConditions("[]", conversation)).toBe(true);
    expect(matchesSlaConditions("{}", conversation)).toBe(true);
    expect(matchesSlaConditions(JSON.stringify({
      mode: "all",
      conditions: [
        { field: "inbox_id", operator: "equals", value: "inbox-priority" },
        { field: "labels", operator: "includes_all", value: ["vip", "refund"] },
      ],
    }), conversation)).toBe(true);
    expect(matchesSlaConditions(JSON.stringify({
      mode: "any",
      conditions: [
        { field: "priority", operator: "equals", value: "low" },
        { field: "channel_type", operator: "equals", value: "email_google" },
      ],
    }), conversation)).toBe(true);
  });

  it("rejects malformed or unsupported conditions", () => {
    expect(matchesSlaConditions("not-json", conversation)).toBe(false);
    expect(matchesSlaConditions(JSON.stringify([
      { field: "project_id", operator: "equals", value: 12 },
    ]), conversation)).toBe(false);
    expect(matchesSlaConditions(JSON.stringify([
      { field: "priority", operator: "equals", value: "low" },
    ]), conversation)).toBe(false);
  });
});
