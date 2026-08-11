import { describe, expect, it } from "vitest";
import {
  parseEvents,
  parsePlacement,
  parseStatistics,
  parseTargeting,
  parseVersion,
} from "./contracts";

describe("paywalls contracts v1", () => {
  it("validates versioned visual definitions", () => {
    const parsed = parseVersion({
      definition: {
        schema_version: 1,
        theme: { color: "#fff" },
        components: [
          { id: "title", type: "heading", props: { text: "Upgrade" } },
        ],
      },
    });
    expect(parsed.definition.components[0]).toMatchObject({
      id: "title",
      type: "heading",
    });
    expect(() =>
      parseVersion({
        definition: {
          components: [
            { id: "same", type: "text" },
            { id: "same", type: "text" },
          ],
        },
      }),
    ).toThrow("duplicated");
  });
  it("accepts targeting and a resolve context", () => {
    expect(
      parseTargeting({ platforms: ["ios"], countries: ["ch"] }).countries,
    ).toEqual(["CH"]);
    expect(
      parsePlacement({
        placement: "main",
        platform: "ios",
        attributes: { plan: "free" },
      }),
    ).toMatchObject({ placement: "main", platform: "ios" });
  });
  it("accepts supported events and rejects unknown types", () => {
    expect(
      parseEvents({
        events: [
          {
            id: "e1",
            type: "purchase",
            placement: "main",
            occurred_at: "2026-01-01T00:00:00Z",
          },
        ],
      }).events[0].type,
    ).toBe("purchase");
    expect(() =>
      parseEvents({
        events: [
          {
            id: "e1",
            type: "other",
            placement: "main",
            occurred_at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    ).toThrow("events[0].type");
  });
  it("validates bounded statistics ranges and IANA timezones", () => {
    const filters = parseStatistics({
      from: "2026-01-01",
      to: "2026-02-01",
      timezone: "Europe/Zurich",
      interval: "day",
    });
    expect(filters.timezone).toBe("Europe/Zurich");
    expect(filters.from).toBe("2026-01-01T00:00:00.000Z");
    expect(filters.to).toBe("2026-02-02T00:00:00.000Z");
    expect(() => parseStatistics({ timezone: "Mars/Olympus" })).toThrow(
      "timezone",
    );
  });
});
