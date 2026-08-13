import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  POST: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}));

vi.mock("@/lib/api", () => api);
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  createAnalyticsDashboard,
  createAnalyticsOperation,
  createAnalyticsReport,
  getAnalyticsEvents,
  getAnalyticsOverview,
  queryAnalyticsFunnel,
  upsertAnalyticsRemoteConfig,
} from "../analyticsService";

describe("Analytics dashboard service contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the project-scoped module gateway and unwraps responses", async () => {
    api.GET.mockResolvedValueOnce({
      data: {
        data: {
          events: 12,
          net_revenue_by_currency: [
            { currency: "CHF", net_revenue_micros: 9_900_000 },
          ],
        },
      },
    });
    api.GET.mockResolvedValueOnce({ data: { data: { items: [] } } });

    await expect(
      getAnalyticsOverview("10-test", {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T00:00:00.000Z",
      })
    ).resolves.toMatchObject({ events: 12 });
    await expect(
      getAnalyticsEvents("10-test", {
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T00:00:00.000Z",
        event_name: "checkout.completed",
        limit: "100",
      })
    ).resolves.toEqual({ items: [] });

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/analytics/projects/10-test/overview?from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-31T00%3A00%3A00.000Z"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/analytics/projects/10-test/events?from=2026-01-01T00%3A00%3A00.000Z&to=2026-01-31T00%3A00%3A00.000Z&event_name=checkout.completed&limit=100"
    );
  });

  it("maps analysis, reports and durable operations without legacy routes", async () => {
    api.POST.mockResolvedValue({ data: { data: { id: "result-1" } } });

    await queryAnalyticsFunnel("10-test", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T00:00:00.000Z",
      steps: ["app.opened", "purchase.completed"],
    });
    await createAnalyticsReport("10-test", {
      name: "Activation",
      report_type: "funnel",
      definition: { steps: ["app.opened", "purchase.completed"] },
      enabled: true,
    });
    await createAnalyticsOperation("10-test", {
      operation_type: "export",
      input: {},
    });

    expect(api.POST).toHaveBeenNthCalledWith(
      1,
      "/api/v1/analytics/projects/10-test/funnels/query",
      expect.objectContaining({ steps: ["app.opened", "purchase.completed"] })
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      2,
      "/api/v1/analytics/projects/10-test/reports",
      expect.objectContaining({ name: "Activation" })
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      3,
      "/api/v1/analytics/projects/10-test/operations",
      { operation_type: "export", input: {} }
    );
  });

  it("maps dashboards and remote configuration through the native module", async () => {
    api.POST.mockResolvedValueOnce({ data: { data: { id: "dashboard-1" } } });
    api.PUT.mockResolvedValueOnce({
      data: { data: { id: "config-1", version: 1 } },
    });

    await createAnalyticsDashboard("10-test", {
      name: "Product health",
      visibility: "project",
      layout: { columns: 12 },
    });
    await upsertAnalyticsRemoteConfig("10-test", "checkout_banner", {
      environment: "test",
      value: { enabled: true },
      conditions: [{ rollout_percentage: 50 }],
    });

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/analytics/projects/10-test/dashboards",
      expect.objectContaining({ name: "Product health" })
    );
    expect(api.PUT).toHaveBeenCalledWith(
      "/api/v1/analytics/projects/10-test/remote-config/checkout_banner",
      expect.objectContaining({ environment: "test" })
    );
  });
});
