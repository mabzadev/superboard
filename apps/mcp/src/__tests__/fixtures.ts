/**
 * Test fixtures for API responses.
 * Each fixture includes ONLY the fields the formatter actually reads.
 */

// --- Status ---

export const statusWithProjects = {
  user: { name: "Alice", email: "alice@test.com" },
  instances: [
    {
      id: "inst1",
      name: "My App",
      production: { id: "prod1", name: "My App", domain: "myapp.grovs.io", hash_id: "prod1" },
      test: { id: "test1", name: "My App (test)", domain: "test.myapp.grovs.io", hash_id: "test1" },
    },
  ],
};

export const statusEmpty = {
  user: { name: "Bob", email: "bob@test.com" },
  instances: [],
};

// --- Projects ---

export const createdProject = {
  instance: {
    hash_id: "abc123",
    uri_scheme: "myapp",
    production: { name: "Prod", hash_id: "prod1" },
    test: { name: "Test", hash_id: "test1" },
  },
};

// --- Links ---

export const createdLink = {
  link: {
    id: 42,
    name: "Summer Sale",
    path: "summer-sale",
    access_path: "https://myapp.grovs.io/summer-sale",
    title: "Summer Sale",
    tags: ["promo"],
    data: { screen: "sale" },
  },
};

export const minimalLink = {
  link: { id: 1, name: "Basic", path: "basic" },
};

export const archivedLink = {
  link: {
    id: 55,
    name: "Old Promo",
    path: "old-promo",
    access_path: "https://myapp.grovs.io/old-promo",
  },
};

export const searchLinksPage = {
  links: [
    { id: 1, name: "Link A", path: "a", total_views: 100, total_opens: 50, total_installs: 10, active: true },
    { id: 2, name: "Link B", path: "b", total_views: 200, total_opens: 80, total_installs: 20, active: false },
  ],
  meta: { page: 1, total_pages: 3, per_page: 20, total_entries: 42 },
};

export const searchLinksEmpty = {
  links: [],
  meta: { page: 1, total_pages: 0, per_page: 20, total_entries: 0 },
};

// --- Analytics ---

export const analyticsOverview = {
  metrics: {
    current: {
      views: 500, opens: 200, installs: 50, app_opens: 180,
      new_users: 40, returning_users: 160, returning_rate: 0.8,
      reinstalls: 5, referred_users: 10,
      revenue: 0, units_sold: 0, cancellations: 0, arpu: 0, arppu: 0,
    },
    previous: {
      views: 400, opens: 150, installs: 30, app_opens: 120,
      new_users: 25, returning_users: 95, returning_rate: 0.633,
      reinstalls: 2, referred_users: 8,
      revenue: 0, units_sold: 0, cancellations: 0, arpu: 0, arppu: 0,
    },
  },
};

export const linkAnalytics = {
  link_path: "summer-sale",
  metrics: {
    "2026-04-01": {
      view: 100, open: 50, install: 10, reinstall: 1,
      reactivation: 2, app_open: 48, user_referred: 5, avg_engagement_time: 120,
    },
  },
};

export const topLinks = {
  links: [
    { name: "Top Link", path: "top", views: 999, opens: 500, installs: 100 },
  ],
};

// --- Campaigns ---

export const createdCampaign = {
  campaign: {
    id: 42,
    name: "Summer Sale",
    archived: false,
    created_at: "2026-03-01T08:00:00.000Z",
  },
};

export const archivedCampaign = {
  campaign: {
    id: 7,
    name: "Old Campaign",
    archived: true,
    created_at: "2026-01-15T12:00:00.000Z",
  },
};

export const campaignListPage = {
  campaigns: [
    {
      id: 1, name: "Campaign A", archived: false, created_at: "2026-03-01",
      total_views: 1500, total_opens: 700, total_installs: 150, total_revenue: 250000,
    },
    {
      id: 2, name: "Empty Campaign", archived: true, created_at: "2026-01-15",
      total_views: 0, total_opens: 0, total_installs: 0, total_revenue: 0,
    },
  ],
  meta: { page: 2, total_pages: 3, per_page: 10, total_entries: 25 },
};

export const campaignListEmpty = {
  campaigns: [],
  meta: { page: 1, total_pages: 0, per_page: 20, total_entries: 0 },
};

// --- Usage ---

export const usageWithinLimits = {
  usage: {
    current_mau: 5000,
    mau_limit: 10000,
    quota_exceeded: false,
    has_subscription: true,
  },
};

export const usageExceededNoSubscription = {
  usage: {
    current_mau: 12000,
    mau_limit: 10000,
    quota_exceeded: true,
    has_subscription: false,
  },
};

export const usageExceededWithSubscription = {
  usage: {
    current_mau: 12000,
    mau_limit: 10000,
    quota_exceeded: true,
    has_subscription: true,
  },
};

export const statusWithUsageWarning = {
  user: { name: "Alice", email: "alice@test.com" },
  instances: [
    {
      id: "inst1",
      name: "My App",
      production: { name: "My App", domain: "myapp.grovs.io", hash_id: "prod1" },
      test: { name: "My App (test)", domain: "test.myapp.grovs.io", hash_id: "test1" },
      usage: {
        current_mau: 12000,
        mau_limit: 10000,
        quota_exceeded: true,
        has_subscription: false,
      },
    },
  ],
};

export const statusWithSubscription = {
  user: { name: "Alice", email: "alice@test.com" },
  instances: [
    {
      id: "inst1",
      name: "My App",
      production: { name: "My App", domain: "myapp.grovs.io", hash_id: "prod1" },
      test: { name: "My App (test)", domain: "test.myapp.grovs.io", hash_id: "test1" },
      usage: {
        current_mau: 12000,
        mau_limit: 10000,
        quota_exceeded: true,
        has_subscription: true,
      },
    },
  ],
};

// --- Configuration ---

export const redirectConfig = {
  redirect_config: {
    default_fallback: "https://example.com",
    show_preview_ios: true,
    show_preview_android: false,
    ios: {
      default: { enabled: true, fallback_url: "https://example.com", appstore: "https://apps.apple.com/app/123" },
    },
    android: {
      default: { enabled: true, fallback_url: null, appstore: "https://play.google.com/store/apps/details?id=com.test" },
    },
  },
};

export const sdkConfig = {
  configurations: {
    ios: {
      enabled: true,
      configuration: {
        bundle_id: "com.test.app",
        team_id: "ABC123",
      },
    },
  },
};

export const sdkConfigWithSensitive = {
  configurations: {
    ios: {
      enabled: true,
      configuration: {
        bundle_id: "com.test.app",
        team_id: "ABC123",
        push_configuration: "SENSITIVE",
        server_api_key: "SENSITIVE",
      },
    },
  },
};

// --- Campaigns (formatter-specific) ---

export const campaignListSingle = {
  campaigns: [
    { id: 1, name: "Camp A", total_views: 100, total_opens: 50, total_installs: 10, total_revenue: 5000, archived: false },
  ],
  meta: { page: 1, total_pages: 1, per_page: 20, total_entries: 1 },
};
