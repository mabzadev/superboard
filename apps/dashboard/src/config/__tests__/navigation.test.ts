import { describe, expect, it } from "vitest";
import { DASHBOARD_SECTIONS, pageForPath, sectionForPath } from "../navigation";

describe("dashboard navigation", () => {
  it("defines Dashboard followed by the seven product sections", () => {
    expect(DASHBOARD_SECTIONS.map(({ label }) => label)).toEqual([
      "Dashboard",
      "App",
      "Products",
      "Paywalls",
      "Dynamic Links",
      "Support",
      "Marketing",
      "Onboardings",
    ]);
  });

  it("defines the complete section page navigation", () => {
    expect(
      DASHBOARD_SECTIONS.map((section) => [
        section.label,
        section.pages.map(({ label }) => label),
      ])
    ).toEqual([
      ["Dashboard", ["Dashboard"]],
      [
        "App",
        [
          "Customers",
          "Users",
          "Referrals",
          "Access Key",
          "Libraries",
          "Android Setup",
          "iOS Setup",
          "Web Setup",
        ],
      ],
      ["Products", ["Purchases", "Customers", "Offerings", "Entitlements"]],
      ["Paywalls", ["Paywalls", "Statistics"]],
      [
        "Dynamic Links",
        [
          "Links",
          "Campaigns",
          "Redirect Rules",
          "Domain",
          "Social Media Preview",
          "Tracking",
        ],
      ],
      ["Support", ["Inbox", "Configuration", "Contacts", "Quality"]],
      [
        "Marketing",
        ["In-app Messages", "Email", "Campaigns", "Statistics", "Settings"],
      ],
      ["Onboardings", ["Onboardings", "Statistics"]],
    ]);
  });

  it("uses canonical kebab-case routes and resolves nested detail pages", () => {
    for (const section of DASHBOARD_SECTIONS) {
      expect(section.href).toBe(section.pages[0]?.href);
      for (const page of section.pages) {
        expect(
          page.href === `/${section.slug}` ||
            new RegExp(`^/${section.slug}/[a-z0-9-]+$`).test(page.href)
        ).toBe(true);
      }
    }
    expect(sectionForPath("/dynamic-links/links/123")?.label).toBe(
      "Dynamic Links"
    );
    expect(sectionForPath("/dashboard")?.label).toBe("Dashboard");
    expect(pageForPath("/dashboard")?.label).toBe("Dashboard");
    expect(pageForPath("/dynamic-links/links/123")?.label).toBe("Links");
    expect(pageForPath("/dynamic-links/campaigns/123")?.label).toBe(
      "Campaigns"
    );
    expect(pageForPath("/paywalls/statistics")?.label).toBe("Statistics");
    expect(pageForPath("/onboardings/statistics")?.label).toBe("Statistics");
  });

  it("defines Dashboard and exactly 31 physical module pages", () => {
    expect(DASHBOARD_SECTIONS.flatMap((section) => section.pages)).toHaveLength(
      32
    );
  });

  it("contains no menu badges or obsolete sidebar group labels", () => {
    expect(JSON.stringify(DASHBOARD_SECTIONS)).not.toMatch(
      /beta|new|platform/i
    );
  });
});
