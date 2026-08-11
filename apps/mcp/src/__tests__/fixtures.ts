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
      uri_scheme: "myapp",
      projects_count: 2,
      links_count: 17,
      projects: [
        { id: "inst1-prod", name: "My App", environment: "production" },
        { id: "inst1-test", name: "My App Test", environment: "test" },
      ],
    },
  ],
};

export const statusEmpty = {
  user: { name: "Bob", email: "bob@test.com" },
  instances: [],
};

export const platformStatus = {
  status: "degraded",
  environment: "development",
  generatedAt: "2026-08-09T10:00:00.000Z",
  responseTimeMs: 42,
  deployment: { target: "reference", release: "abc123" },
  endpoints: { api: "https://api.example.test", dashboard: null },
  publicSurfaces: [
    {
      id: "api",
      status: "ok",
      httpStatus: 200,
      responseTimeMs: 18,
      description: "SuperBoard API",
    },
  ],
  services: [
    {
      id: "email",
      status: "ok",
      responseTimeMs: 4,
      description: "Transactional email",
    },
  ],
  runtime: {
    rows: [
      {
        service: "email",
        eventType: "queue",
        outcome: "ok",
        invocations: 12,
        exceptions: 0,
        averageCpuMs: 1.5,
      },
    ],
  },
  dataStores: [{ id: "email", kind: "D1", owner: "email", status: "ok" }],
  metrics: { users: 12, projects: 2 },
  jobs: { email: { queued: 1, failed: 0 } },
  api: {
    status: "ok",
    capabilities: [
      {
        id: "identity",
        description: "Authentication",
        access: "Application or administrator",
        entrypoints: ["/api/v1/auth/*"],
      },
    ],
  },
  custom: {
    status: "ok",
    manifest: {
      service: "reference-custom",
      version: "2.0.0",
      description: "Reference jobs",
      capabilities: [
        {
          id: "reference.echo",
          mode: "queue",
          description: "Durable echo acceptance",
        },
      ],
    },
  },
};

// --- Projects ---

export const createdProject = {
  instance: {
    id: "abc123",
    uri_scheme: "myapp",
    production: { name: "Prod", id: "abc123-prod" },
    test: { name: "Test", id: "abc123-test" },
  },
};

// --- Links ---

export const createdLink = {
  link: {
    id: 42,
    name: "Summer Sale",
    path: "summer-sale",
    access_path: "https://links.example.test/summer-sale",
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
    access_path: "https://links.example.test/old-promo",
  },
};

export const searchLinksPage = {
  links: [
    {
      id: 1,
      name: "Link A",
      path: "a",
      total_views: 100,
      total_opens: 50,
      total_installs: 10,
      active: true,
    },
    {
      id: 2,
      name: "Link B",
      path: "b",
      total_views: 200,
      total_opens: 80,
      total_installs: 20,
      active: false,
    },
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
      views: 500,
      opens: 200,
      installs: 50,
      app_opens: 180,
      new_users: 40,
      returning_users: 160,
      returning_rate: 0.8,
      reinstalls: 5,
      referred_users: 10,
      revenue: 0,
      units_sold: 0,
      cancellations: 0,
      arpu: 0,
      arppu: 0,
    },
    previous: {
      views: 400,
      opens: 150,
      installs: 30,
      app_opens: 120,
      new_users: 25,
      returning_users: 95,
      returning_rate: 0.633,
      reinstalls: 2,
      referred_users: 8,
      revenue: 0,
      units_sold: 0,
      cancellations: 0,
      arpu: 0,
      arppu: 0,
    },
  },
};

export const linkAnalytics = {
  link_path: "summer-sale",
  metrics: {
    "2026-04-01": {
      view: 100,
      open: 50,
      install: 10,
      reinstall: 1,
      reactivation: 2,
      app_open: 48,
      user_referred: 5,
      avg_engagement_time: 120,
    },
  },
};

export const topLinks = {
  links: [{ name: "Top Link", path: "top", views: 999, opens: 500, installs: 100 }],
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
      id: 1,
      name: "Campaign A",
      archived: false,
      created_at: "2026-03-01",
      total_views: 1500,
      total_opens: 700,
      total_installs: 150,
      total_revenue: 250000,
    },
    {
      id: 2,
      name: "Empty Campaign",
      archived: true,
      created_at: "2026-01-15",
      total_views: 0,
      total_opens: 0,
      total_installs: 0,
      total_revenue: 0,
    },
  ],
  meta: { page: 2, total_pages: 3, per_page: 10, total_entries: 25 },
};

export const campaignListEmpty = {
  campaigns: [],
  meta: { page: 1, total_pages: 0, per_page: 20, total_entries: 0 },
};

// --- Usage ---

export const usageActivity = {
  usage: {
    instance_id: "inst1",
    mau: 5000,
  },
};

// --- Configuration ---

export const redirectConfig = {
  redirect_config: {
    default_fallback: "https://example.com",
    show_preview_ios: true,
    show_preview_android: false,
    ios: {
      default: {
        enabled: true,
        fallback_url: "https://example.com",
        appstore: "https://apps.apple.com/app/123",
      },
    },
    android: {
      default: {
        enabled: true,
        fallback_url: null,
        appstore: "https://play.google.com/store/apps/details?id=com.test",
      },
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
    {
      id: 1,
      name: "Camp A",
      total_views: 100,
      total_opens: 50,
      total_installs: 10,
      total_revenue: 5000,
      archived: false,
    },
  ],
  meta: { page: 1, total_pages: 1, per_page: 20, total_entries: 1 },
};
