import { describe, it, expect } from "vitest";
import {
  formatStatus,
  formatUsage,
  formatCreateProject,
  formatLink,
  formatSearchLinks,
  formatAnalyticsOverview,
  formatLinkAnalytics,
  formatTopLinks,
  formatRedirects,
  formatSdkConfig,
  formatCampaign,
  formatListCampaigns,
} from "../tools/formatters.js";
import { slugify, extractPath } from "../tools/utils.js";
import {
  statusWithProjects,
  statusEmpty,
  statusWithUsageWarning,
  statusWithSubscription,
  createdProject,
  createdLink,
  minimalLink,
  searchLinksPage,
  searchLinksEmpty,
  analyticsOverview,
  linkAnalytics,
  topLinks,
  redirectConfig,
  sdkConfig,
  sdkConfigWithSensitive,
  createdCampaign,
  archivedCampaign,
  campaignListSingle,
  campaignListEmpty,
  usageWithinLimits,
  usageExceededNoSubscription,
  usageExceededWithSubscription,
} from "./fixtures.js";

// ── slugify ──

describe("slugify", () => {
  it("converts name to lowercase slug", () => {
    expect(slugify("Summer Sale")).toBe("summer-sale");
  });

  it("replaces multiple special chars with single dash", () => {
    expect(slugify("Hello!!!World")).toBe("hello-world");
  });

  it("strips leading and trailing dashes", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("returns 'link' for empty string", () => {
    expect(slugify("")).toBe("link");
  });

  it("returns 'link' for unicode-only input", () => {
    expect(slugify("...")).toBe("link");
  });

  it("truncates to 128 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(128);
  });
});

// ── extractPath ──

describe("extractPath", () => {
  it("extracts path from full URL", () => {
    expect(extractPath("https://myapp.grovs.io/summer-sale")).toBe("summer-sale");
  });

  it("returns slug as-is", () => {
    expect(extractPath("summer-sale")).toBe("summer-sale");
  });

  it("strips leading slash from bare path", () => {
    expect(extractPath("/summer-sale")).toBe("summer-sale");
  });

  it("handles URL with https and subdomain", () => {
    expect(extractPath("https://test.myapp.grovs.io/promo-link")).toBe("promo-link");
  });

  it("handles URL with trailing slash", () => {
    expect(extractPath("https://myapp.grovs.io/sale/")).toBe("sale/");
  });

  it("handles URL with http", () => {
    expect(extractPath("http://localhost:3000/my-link")).toBe("my-link");
  });

  it("trims whitespace", () => {
    expect(extractPath("  summer-sale  ")).toBe("summer-sale");
  });
});

// ── formatStatus ──

describe("formatStatus", () => {
  it("renders user and instance table", () => {
    const out = formatStatus(statusWithProjects);

    expect(out).toContain("Account Overview");
    expect(out).toContain("Alice");
    expect(out).toContain("alice@test.com");
    expect(out).toContain("myapp.grovs.io");
    expect(out).toContain("inst1");
    expect(out).toContain("prod1");
    expect(out).toContain("test1");
  });

  it("handles no instances", () => {
    const out = formatStatus(statusEmpty);
    expect(out).toContain("No projects found");
  });

  it("handles missing user gracefully", () => {
    const out = formatStatus({ instances: [] });
    expect(out).toContain("Account Overview");
    // val() produces em-dash for missing fields
  });

  it("shows usage warning when quota_exceeded and no subscription", () => {
    const out = formatStatus(statusWithUsageWarning);

    expect(out).toContain("WARNING: Usage exceeded (12000/10000 MAU)");
    expect(out).toContain("deep links are not working");
    expect(out).toContain("Subscribe to a paid plan");
  });

  it("does not show usage warning when has_subscription is true", () => {
    const out = formatStatus(statusWithSubscription);

    expect(out).not.toContain("WARNING");
  });

  it("does not show usage warning when quota is not exceeded", () => {
    const out = formatStatus(statusWithProjects);

    expect(out).not.toContain("WARNING");
  });
});

// ── formatUsage ──

describe("formatUsage", () => {
  it("renders usage within limits", () => {
    const out = formatUsage(usageWithinLimits);

    expect(out).toContain("Usage");
    expect(out).toContain("Current MAU: 5000 / 10000");
    expect(out).toContain("Quota exceeded: No");
    expect(out).toContain("Has subscription: Yes");
    expect(out).not.toContain("WARNING");
  });

  it("renders usage exceeded without subscription and shows warning", () => {
    const out = formatUsage(usageExceededNoSubscription);

    expect(out).toContain("Current MAU: 12000 / 10000");
    expect(out).toContain("Quota exceeded: Yes");
    expect(out).toContain("Has subscription: No");
    expect(out).toContain("WARNING: Usage exceeded");
    expect(out).toContain("Subscribe to a paid plan");
  });

  it("renders usage exceeded with subscription and no warning", () => {
    const out = formatUsage(usageExceededWithSubscription);

    expect(out).toContain("Current MAU: 12000 / 10000");
    expect(out).toContain("Quota exceeded: Yes");
    expect(out).toContain("Has subscription: Yes");
    expect(out).not.toContain("WARNING");
  });

  it("handles missing usage key gracefully", () => {
    const out = formatUsage({});
    expect(out).toContain("No usage data returned");
    expect(out).toContain("⚠ Unexpected API response");
  });
});

// ── formatCreateProject ──

describe("formatCreateProject", () => {
  it("renders instance and project IDs", () => {
    const out = formatCreateProject(createdProject);

    expect(out).toContain("Project Created");
    expect(out).toContain("abc123");
    expect(out).toContain("myapp");
    expect(out).toContain("prod1");
    expect(out).toContain("test1");
  });

  it("handles missing instance gracefully", () => {
    const out = formatCreateProject({});
    expect(out).toContain("Project Created");
  });
});

// ── formatLink ──

describe("formatLink", () => {
  it("renders link details with action label", () => {
    const out = formatLink(
      {
        link: {
          id: 42,
          name: "Sale Link",
          path: "summer-sale",
          access_path: "https://myapp.grovs.io/summer-sale",
          title: "Summer Sale",
          tags: ["promo"],
          data: { screen: "sale" },
        },
      },
      "Created",
    );

    expect(out).toContain("Link Created");
    expect(out).toContain("Sale Link");
    expect(out).toContain("summer-sale");
    expect(out).toContain("Summer Sale");
    expect(out).toContain("promo");
    expect(out).toContain('"screen"');
    expect(out).toContain("get_link_analytics");
  });

  it("renders minimal link without optional fields", () => {
    const out = formatLink(
      { link: { id: 1, name: "Basic", path: "basic", tags: [], data: {} } },
      "Details",
    );

    expect(out).toContain("Link Details");
    expect(out).toContain("Basic");
    expect(out).not.toContain("Title:");
    expect(out).not.toContain("Tags:");
    expect(out).not.toContain("Data:");
  });

  it("omits next-steps when path is missing", () => {
    const out = formatLink({ link: { id: 1, name: "No Path" } }, "Created");
    expect(out).not.toContain("get_link_analytics");
  });

  it("handles missing link gracefully", () => {
    const out = formatLink({}, "Created");
    expect(out).toContain("Link Created");
  });

  it("renders custom redirects with val() guarding .url", () => {
    const out = formatLink(
      {
        link: {
          id: 1,
          name: "Redirected",
          path: "r",
          ios_custom_redirect: { url: "https://ios.test" },
          android_custom_redirect: { url: undefined },
        },
      },
      "Details",
    );

    expect(out).toContain("iOS → https://ios.test");
    expect(out).toContain("Android →");
    expect(out).not.toContain("undefined");
  });
});

// ── formatSearchLinks ──

describe("formatSearchLinks", () => {
  it("renders links table with pagination", () => {
    const out = formatSearchLinks(searchLinksPage);

    expect(out).toContain("42 total");
    expect(out).toContain("page 1/3");
    expect(out).toContain("Link A");
    expect(out).toContain("Link B");
    expect(out).toContain("100");
    expect(out).toContain("Yes");
    expect(out).toContain("No");
  });

  it("handles empty results", () => {
    const out = formatSearchLinks(searchLinksEmpty);
    expect(out).toContain("No links found");
  });
});

// ── formatAnalyticsOverview ──

describe("formatAnalyticsOverview", () => {
  it("renders current and previous periods", () => {
    const out = formatAnalyticsOverview(analyticsOverview);

    expect(out).toContain("Analytics Overview");
    expect(out).toContain("Current period");
    expect(out).toContain("Previous period");
    expect(out).toContain("500");
    expect(out).toContain("80.0%");
  });

  it("handles missing metrics entirely", () => {
    const out = formatAnalyticsOverview({});
    expect(out).toContain("No analytics data available");
  });

  it("handles missing current/previous", () => {
    const out = formatAnalyticsOverview({ metrics: {} });
    expect(out).toContain("No data for this period");
  });
});

// ── formatLinkAnalytics ──

describe("formatLinkAnalytics", () => {
  it("renders per-link metrics", () => {
    const out = formatLinkAnalytics(linkAnalytics);

    expect(out).toContain("Analytics for /summer-sale");
    expect(out).toContain("100");
    expect(out).toContain("120s");
  });

  it("handles null metrics", () => {
    const out = formatLinkAnalytics({ link_path: "x", metrics: null } as Record<string, unknown>);
    expect(out).toContain("No data for this period");
  });

  it("handles empty metrics object", () => {
    const out = formatLinkAnalytics({ link_path: "x", metrics: {} });
    expect(out).toContain("No data for this period");
  });
});

// ── formatTopLinks ──

describe("formatTopLinks", () => {
  it("renders ranked table", () => {
    const out = formatTopLinks(topLinks);

    expect(out).toContain("Top Links");
    expect(out).toContain("Top Link");
    expect(out).toContain("999");
  });

  it("handles empty links", () => {
    const out = formatTopLinks({ links: [] });
    expect(out).toContain("No data for this period");
  });

  it("handles null links", () => {
    const out = formatTopLinks({});
    expect(out).toContain("No data for this period");
  });
});

// ── formatRedirects ──

describe("formatRedirects", () => {
  it("renders redirect config with multiple platforms", () => {
    const out = formatRedirects(redirectConfig);

    expect(out).toContain("Redirect Configuration Updated");
    expect(out).toContain("https://example.com");
    expect(out).toContain("IOS/default:");
    expect(out).toContain("ANDROID/default:");
    expect(out).toContain("Enabled: Yes");
  });

  it("handles missing redirect_config", () => {
    const out = formatRedirects({});
    expect(out).toContain("No redirect configuration returned");
  });
});

// ── formatSdkConfig ──

describe("formatSdkConfig", () => {
  it("renders platform configs and hides sensitive fields", () => {
    const out = formatSdkConfig(sdkConfigWithSensitive);

    expect(out).toContain("SDK Configuration Updated");
    expect(out).toContain("com.test.app");
    expect(out).toContain("ABC123");
    expect(out).not.toContain("SENSITIVE");
  });

  it("uses exact match for hidden fields, not substring", () => {
    const out = formatSdkConfig({
      configurations: {
        ios: {
          enabled: true,
          configuration: {
            bundle_id: "com.test.app",
            my_push_configuration_v2: "should-show",
            server_api_key_hash: "should-show",
          },
        },
      },
    });

    expect(out).toContain("should-show");
    expect(out).toContain("my_push_configuration_v2");
    expect(out).toContain("server_api_key_hash");
  });

  it("renders multiple platforms", () => {
    const out = formatSdkConfig({
      configurations: {
        ios: { enabled: true, configuration: { bundle_id: "com.ios" } },
        android: { enabled: false, configuration: { package_name: "com.android" } },
      },
    });

    expect(out).toContain("IOS:");
    expect(out).toContain("ANDROID:");
    expect(out).toContain("com.ios");
    expect(out).toContain("com.android");
  });

  it("handles missing configurations", () => {
    const out = formatSdkConfig({});
    expect(out).toContain("No configuration data returned");
  });

  it("handles platform with no inner configuration", () => {
    const out = formatSdkConfig({
      configurations: { ios: { enabled: true } },
    });
    expect(out).toContain("IOS:");
  });
});

// ── formatCampaign ──

describe("formatCampaign", () => {
  it("renders created campaign with add-link hint", () => {
    const out = formatCampaign(createdCampaign, "Created");

    expect(out).toContain("Campaign Created");
    expect(out).toContain("Summer Sale");
    expect(out).toContain("ID: 42");
    expect(out).toContain("create_link with campaign_id");
  });

  it("renders archived campaign without add-link hint", () => {
    const out = formatCampaign(archivedCampaign, "Archived");

    expect(out).toContain("Campaign Archived");
    expect(out).toContain("Archived: Yes");
    expect(out).not.toContain("create_link with campaign_id");
    expect(out).toContain("list_campaigns to view remaining");
  });

  it("handles missing campaign gracefully", () => {
    const out = formatCampaign({}, "Created");
    expect(out).toContain("Campaign Created");
  });
});

// ── formatListCampaigns ──

describe("formatListCampaigns", () => {
  it("renders campaigns table with revenue formatting", () => {
    const out = formatListCampaigns(campaignListSingle);

    expect(out).toContain("Campaigns");
    expect(out).toContain("Camp A");
    expect(out).toContain("$50.00");
  });

  it("handles empty campaigns", () => {
    const out = formatListCampaigns(campaignListEmpty);
    expect(out).toContain("No campaigns found");
  });
});

// ── Helper edge cases ──

describe("helper edge cases", () => {
  it("pct handles NaN input", () => {
    // pct is exercised through formatAnalyticsOverview
    const out = formatAnalyticsOverview({
      metrics: {
        current: { views: 1, opens: 0, installs: 0, app_opens: 0, new_users: 0, returning_users: 0, returning_rate: "abc", reinstalls: 0, referred_users: 0, revenue: 0, units_sold: 0, cancellations: 0, arpu: 0, arppu: 0 },
      },
    });
    expect(out).toContain("0%");
    expect(out).not.toContain("NaN");
  });

  it("cents handles NaN input", () => {
    const out = formatListCampaigns({
      campaigns: [
        { id: 1, name: "X", total_views: 0, total_opens: 0, total_installs: 0, total_revenue: "not-a-number", archived: false },
      ],
      meta: { page: 1, total_pages: 1, per_page: 20, total_entries: 1 },
    });
    expect(out).toContain("$0.00");
    expect(out).not.toContain("NaN");
  });

  it("date handles invalid date string", () => {
    const out = formatCampaign(
      { campaign: { id: 1, name: "X", archived: false, created_at: "not-a-date" } },
      "Created",
    );
    // Should not contain "Invalid Date" — falls back to raw string
    expect(out).not.toContain("Invalid Date");
    expect(out).toContain("not-a-date");
  });
});

// ── API shape warnings ──

describe("API shape warnings", () => {
  it("formatStatus warns when user key is missing", () => {
    const out = formatStatus({ instances: [] });
    expect(out).toContain('⚠ Unexpected API response: missing "user" key');
  });

  it("formatStatus warns when instances is wrong type", () => {
    const out = formatStatus({ user: { name: "A", email: "a@b" }, instances: "bad" });
    expect(out).toContain('⚠ Unexpected API response: "instances" is string, expected array');
  });

  it("formatLink warns when link key is missing", () => {
    const out = formatLink({}, "Created");
    expect(out).toContain('⚠ Unexpected API response: missing "link" key');
  });

  it("formatCreateProject warns when instance key is missing", () => {
    const out = formatCreateProject({});
    expect(out).toContain('⚠ Unexpected API response: missing "instance" key');
  });

  it("formatSearchLinks warns when meta is missing", () => {
    const out = formatSearchLinks({});
    expect(out).toContain('⚠ Unexpected API response: missing "meta" key');
  });

  it("formatListCampaigns warns when campaigns is wrong type", () => {
    const out = formatListCampaigns({ campaigns: "bad", meta: {} });
    expect(out).toContain('⚠ Unexpected API response: "campaigns" is string, expected array');
  });

  it("formatCampaign warns when campaign key is missing", () => {
    const out = formatCampaign({}, "Created");
    expect(out).toContain('⚠ Unexpected API response: missing "campaign" key');
  });

  it("formatUsage warns when usage key is missing", () => {
    const out = formatUsage({});
    expect(out).toContain('⚠ Unexpected API response: missing "usage" key');
  });

  it("formatUsage warns when usage is wrong type", () => {
    const out = formatUsage({ usage: "not-an-object" });
    expect(out).toContain('⚠ Unexpected API response: "usage" is string, expected object');
  });

  it("no warning when key exists with correct type", () => {
    const out = formatLink({ link: { id: 1, name: "OK", path: "ok" } }, "Details");
    expect(out).not.toContain("⚠");
  });
});
