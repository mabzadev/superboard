import type { Page, Route } from "@playwright/test";

const pageBody = {
  data: [],
  pagination: { limit: 50, has_more: false, next_cursor: null },
};

export async function setupSupportMocks(page: Page) {
  await page.route("**/api/v1/support/projects/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/settings/operations")) {
      return json(route, {
        data: {
          queues: [],
          dead_letters: [],
          providers: [],
          knowledge: [],
          imports: [],
          exports: [],
        },
      });
    }
    if (path.endsWith("/settings")) {
      return json(route, {
        data: {
          settings: {
            business_name: "SuperBoard Support",
            locale: "en",
            timezone: "UTC",
            date_format: "YYYY-MM-DD",
            auto_resolve_minutes: null,
            attachment_max_bytes: 10 * 1024 * 1024,
            allowed_content_types: ["image/png"],
            features: {},
          },
          entities: [],
          catalog: {},
        },
      });
    }
    if (path.endsWith("/items")) {
      return json(route, { data: [], degraded_sources: [] });
    }
    if (path.endsWith("/contacts") || path.endsWith("/companies")) {
      return json(route, { data: [] });
    }
    if (path.endsWith("/workforce")) {
      return json(route, {
        data: {
          memberships: [],
          active_teams: 0,
          active_inboxes: 0,
          assignments: [],
          active_leaves: 0,
        },
      });
    }
    if (path.endsWith("/channels")) {
      return json(route, { data: [] });
    }
    if (path.endsWith("/reports")) {
      return json(route, {
        data: {
          period: { from: null, to: null },
          totals: {},
          dimensions: { inbox: [], agent: [] },
          sla: [],
          csat: { responses: 0, average: null },
          proactive_support: [],
        },
      });
    }
    return json(route, pageBody);
  });
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
