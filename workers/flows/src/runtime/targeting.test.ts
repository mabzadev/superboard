import { describe, expect, it } from "vitest";
import { matchesTargeting, personalize } from "./targeting";

describe("flow targeting", () => {
  it("ANDs conditions while ORing candidate values", () => {
    expect(
      matchesTargeting(
        [
          {
            key: "plan",
            data_type: "string",
            operator: "equals",
            value: ["pro", "custom"],
          },
          {
            key: "visits",
            data_type: "number",
            operator: "greater-than-or-equal",
            value: 3,
          },
        ],
        { plan: "pro", visits: 4 },
      ),
    ).toBe(true);
  });

  it("uses fallbacks and nested personalization", () => {
    expect(
      personalize(
        "Welcome {{ profile.name | friend }} — {{ missing | available soon }}",
        { profile: { name: "Ada" } },
      ),
    ).toBe("Welcome Ada — available soon");
  });

  it("rejects invalid regex without throwing", () => {
    expect(
      matchesTargeting(
        [{ key: "route", data_type: "string", operator: "regex", value: "[" }],
        { route: "/home" },
      ),
    ).toBe(false);
  });
});
