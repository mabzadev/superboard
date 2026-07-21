import type { Page } from "@playwright/test";
import {
  TEST_USER,
  TEST_INSTANCE,
  TEST_PROJECT,
  TEST_LINK,
  TEST_CAMPAIGN,
  TEST_SUBSCRIPTION,
  MOCK_TOKENS,
} from "./test-data";

/**
 * Sets up route-level API mocking for all /api/v1/** endpoints.
 * Call this in beforeEach or in a fixture to mock the API layer.
 */
export async function setupApiMocks(page: Page) {
  // Auth endpoints
  await page.route("**/oauth/token", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_TOKENS),
      });
    }
  });

  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: TEST_USER.id,
          email: TEST_USER.email,
          name: TEST_USER.name,
          roles: [{ instance_id: TEST_INSTANCE.id, role: "admin" }],
          otp_required_for_login: false,
        },
      }),
    });
  });

  // Instances
  await page.route("**/api/v1/instances", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          instances: [
            {
              ...TEST_INSTANCE,
              projects: [TEST_PROJECT],
            },
          ],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          instance: TEST_INSTANCE,
        }),
      });
    }
  });

  // Instance details
  await page.route(`**/api/v1/instances/${TEST_INSTANCE.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...TEST_INSTANCE,
        projects: [TEST_PROJECT],
        get_started_setup: null,
      }),
    });
  });

  // Instance members
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/members`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          members: [
            {
              user: {
                id: TEST_USER.id,
                name: TEST_USER.name,
                email: TEST_USER.email,
              },
              role: "admin",
            },
          ],
        }),
      });
    }
  );

  // Instance role
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/role`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ role: "admin" }),
      });
    }
  );

  // Project configuration
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/configurations`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          configurations: [
            {
              platform: "ios",
              app_id: null,
              bundle_id: null,
              team_id: null,
            },
            {
              platform: "android",
              package_name: null,
              sha256: null,
            },
          ],
        }),
      });
    }
  );

  // Links
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/links*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          links: [TEST_LINK],
          total_pages: 1,
          total_entries: 1,
        }),
      });
    }
  );

  // Campaigns
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/campaigns*`,
    async (route) => {
      const campaigns = Object.assign([TEST_CAMPAIGN], {
        total_pages: 1,
        total_entries: 1,
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(campaigns),
      });
    }
  );

  // Dashboard metrics
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/events/overview*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metrics_values: {
            link_views: 150,
            link_driven_installs: 45,
            organic_users: 80,
            installs: 55,
            app_opens: 200,
          },
        }),
      });
    }
  );

  // Top links
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/events/top_links*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          top_links: [{ link: TEST_LINK, views: 42 }],
        }),
      });
    }
  );

  // Links views (chart data)
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/events/search*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      });
    }
  );

  // Subscription
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/subscription`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ subscription: TEST_SUBSCRIPTION }),
      });
    }
  );

  // MAU
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/mau`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          current_quantity: 500,
          total_available: 10000,
        }),
      });
    }
  );

  // Notifications
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/notifications*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          notifications: [],
          total_pages: 0,
          total_entries: 0,
        }),
      });
    }
  );

  // Visitors
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/visitors*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          visitors: [],
          total_pages: 0,
          total_entries: 0,
        }),
      });
    }
  );

  // Redirect config
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/redirect_config`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          redirect_config: {
            default_fallback: "",
            show_preview_android: false,
            show_preview_ios: false,
          },
        }),
      });
    }
  );

  // Domain config
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/domain`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          domain: {
            id: "domain-001",
            subdomain: "test",
            domain: "opengrow.io",
          },
        }),
      });
    }
  );

  // Events for payment screen
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/events*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          metrics_values: {
            active_users: 100,
          },
        }),
      });
    }
  );

  // Purchases/revenue
  await page.route(
    `**/api/v1/projects/${TEST_PROJECT.id}/purchases*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          purchases: [],
          total_pages: 0,
          total_entries: 0,
        }),
      });
    }
  );

  // Setup progress
  await page.route(
    `**/api/v1/instances/${TEST_INSTANCE.id}/setup_progress*`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          steps: [],
        }),
      });
    }
  );

  // Catch-all for unhandled API routes
  await page.route("**/api/v1/**", async (route) => {
    console.warn(
      `Unhandled API route: ${route.request().method()} ${route.request().url()}`
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}
