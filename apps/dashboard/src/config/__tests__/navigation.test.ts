import { describe, expect, it } from "vitest";
import { DASHBOARD_SECTIONS, pageForPath, sectionForPath } from "../navigation";

describe("dashboard navigation", () => {
  it("defines Dashboard followed by the product sections with one unified Flows domain", () => {
    expect(DASHBOARD_SECTIONS.map(({ label }) => label)).toEqual([
      "Dashboard",
      "App",
      "Identity",
      "Products",
      "Flows",
      "Dynamic Links",
      "Support",
      "Marketing",
      "Analytics",
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
      [
        "Identity",
        [
          "Overview",
          "Users",
          "User Attributes",
          "Roles",
          "Applications",
          "Scopes",
          "Organizations",
          "Logs",
          "SAML SSO",
          "Account Policies",
        ],
      ],
      ["Products", ["Purchases", "Customers", "Offerings", "Entitlements"]],
      [
        "Flows",
        [
          "Overview",
          "Workflows",
          "Launchpad",
          "Users",
          "Components",
          "Environments",
          "Localization",
          "SDK",
        ],
      ],
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
      [
        "Support",
        [
          "Inbox",
          "Contacts",
          "Workforce",
          "Channels",
          "Automations",
          "Proactive Support",
          "Help Center",
          "Captain",
          "Integrations",
          "Reports",
          "Settings",
        ],
      ],
      [
        "Marketing",
        [
          "In-app Messages",
          "Email",
          "Campaigns",
          "Journeys",
          "Channels",
          "Statistics",
          "Settings",
        ],
      ],
      [
        "Analytics",
        [
          "Overview",
          "Dashboards",
          "Users & Sessions",
          "Events",
          "Technology & Location",
          "Views",
          "Installations",
          "Verified Purchases",
          "Funnels & Retention",
          "Cohorts",
          "Crashes",
          "Feedback",
          "Remote Config",
          "Alerts",
          "Reports & Exports",
          "Settings",
        ],
      ],
    ]);
  });

  it("uses canonical kebab-case routes and resolves nested detail pages", () => {
    for (const section of DASHBOARD_SECTIONS) {
      expect(section.href).toBe(section.pages[0]?.href);
      for (const page of section.pages) {
        expect(
          page.href === `/${section.slug}` ||
            new RegExp(`^/${section.slug}/[a-z0-9-]+(?:/[a-z0-9-]+)?$`).test(
              page.href
            )
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
    expect(pageForPath("/flows/workflows/flow-1")?.label).toBe("Workflows");
    expect(pageForPath("/flows/settings/environments")?.label).toBe(
      "Environments"
    );
    expect(pageForPath("/identity/en/apps/42")?.label).toBe("Applications");
    expect(pageForPath("/identity/fr/users/abc")?.label).toBe("Users");
  });

  it("defines Dashboard and exactly 71 physical module pages", () => {
    expect(DASHBOARD_SECTIONS.flatMap((section) => section.pages)).toHaveLength(
      71
    );
  });

  it("contains no menu badges or obsolete sidebar group labels", () => {
    expect(JSON.stringify(DASHBOARD_SECTIONS)).not.toMatch(
      /beta|new|platform/i
    );
  });

  it("removes Paywalls and Onboardings from active navigation", () => {
    expect(DASHBOARD_SECTIONS.map(({ slug }) => slug)).not.toContain(
      "paywalls"
    );
    expect(DASHBOARD_SECTIONS.map(({ slug }) => slug)).not.toContain(
      "onboardings"
    );
    expect(
      DASHBOARD_SECTIONS.filter(({ slug }) => slug === "flows")
    ).toHaveLength(1);
  });

  it("keeps Flows navigation strictly project-scoped", () => {
    const flows = DASHBOARD_SECTIONS.find(({ slug }) => slug === "flows");
    expect(JSON.stringify(flows)).not.toMatch(
      /organization|organisation|members|invitations|billing|facturation/i
    );
    expect(flows?.pages.map(({ href }) => href)).not.toEqual(
      expect.arrayContaining([
        "/flows/settings/organization",
        "/flows/settings/members",
        "/flows/settings/billing",
      ])
    );
  });

  it("publishes only the native Support navigation surface", () => {
    const support = DASHBOARD_SECTIONS.find(({ slug }) => slug === "support");
    expect(support?.pages.map(({ href }) => href)).toEqual([
      "/support/inbox",
      "/support/contacts",
      "/support/workforce",
      "/support/channels",
      "/support/automations",
      "/support/proactive-support",
      "/support/help-center",
      "/support/captain",
      "/support/integrations",
      "/support/reports",
      "/support/settings",
    ]);
    expect(pageForPath("/support/quality")).toBeUndefined();
    expect(pageForPath("/support/configuration")).toBeUndefined();
  });
});
