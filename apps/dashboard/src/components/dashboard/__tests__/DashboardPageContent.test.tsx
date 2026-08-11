import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appOverview: vi.fn(),
  accessKey: vi.fn(),
  links: vi.fn(),
  campaigns: vi.fn(),
  domains: vi.fn(),
  rules: vi.fn(),
  linkStatistics: vi.fn(),
  products: vi.fn(),
  productStatistics: vi.fn(),
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => ({ selectedProject: { id: "10-test" } }),
}));

vi.mock("@/hooks/useTableParams", () => ({
  useTableParams: () => ({
    dateRange: {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-01T00:00:00.000Z"),
    },
    setDateRange: vi.fn(),
    platform: "ios",
    setPlatform: vi.fn(),
  }),
}));

vi.mock("@/api/app/appService", () => ({
  getAppOverview: mocks.appOverview,
  getAccessKey: mocks.accessKey,
}));

vi.mock("@/api/dynamic-links/dynamicLinksService", () => ({
  getLinks: mocks.links,
  getLinkCampaigns: mocks.campaigns,
  getDomains: mocks.domains,
  getRedirectRules: mocks.rules,
  getLinkStatistics: mocks.linkStatistics,
}));

vi.mock("@/api/products/productsService", () => ({
  getProducts: mocks.products,
  getProductStatistics: mocks.productStatistics,
}));

vi.mock("@/components/modules/ModulePage", () => ({
  ModulePage: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main><h1>{title}</h1>{children}</main>
  ),
  EmptyProject: () => <p>Select project</p>,
  moduleErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

vi.mock("@/components/dateRangePicker/DateRangePicker", () => ({
  DateRangePicker: () => <button>Date range</button>,
}));

vi.mock("@/components/common/ads-platform", () => ({
  default: () => <button>Platforms</button>,
}));

vi.mock("@/components/layout/section-cards", () => ({
  SectionCards: ({ cards }: { cards: Array<{ title: string; value: number }> }) => (
    <section aria-label="Metrics">
      {cards.map((card) => <p key={card.title}>{card.title}: {card.value}</p>)}
    </section>
  ),
}));

import DashboardPageContent from "../DashboardPageContent";

describe("DashboardPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appOverview.mockResolvedValue({
      project_id: 10,
      customers: 120,
      referrals: 12,
      configured_platforms: 2,
    });
    mocks.accessKey.mockResolvedValue({ id: "key-1", prefix: "og_app_test", created_at: "2026-07-01" });
    mocks.links.mockResolvedValue([
      {
        id: "link-1",
        slug: "summer",
        name: "Summer",
        destination_url: "https://example.com",
        destinations: { ios: "https://example.com/ios" },
        utm: {},
        active: true,
        created_at: "2026-07-01",
        total_views: 30,
        total_opens: 20,
        total_installs: 10,
        total_revenue: 2999,
      },
    ]);
    mocks.campaigns.mockResolvedValue([{ id: "campaign-1" }]);
    mocks.domains.mockResolvedValue([{ id: "domain-1", status: "verified" }]);
    mocks.rules.mockResolvedValue([{ id: "rule-1", active: true }]);
    mocks.linkStatistics.mockResolvedValue({
      totals: { views: 44, installs: 10, app_opens: 18, user_referred: 7 },
      series: [
        { date: "2026-07-10", event_type: "view", count: 20 },
        { date: "2026-07-10", event_type: "click", count: 4 },
      ],
    });
    mocks.products.mockResolvedValue([{ id: "product-1" }]);
    mocks.productStatistics.mockResolvedValue({
      totals: {
        purchases: 8,
        gross_revenue_micros: 12_000_000,
        refunds: 1,
        refunded_micros: 2_000_000,
        net_revenue_micros: 10_000_000,
        active_subscriptions: 5,
      },
      by_status: [],
      series: [],
      by_product_platform: [],
    });
  });

  it("aggregates the canonical App, Dynamic Links and Products services", async () => {
    render(<DashboardPageContent />);

    expect(await screen.findByText("Customers: 120")).toBeInTheDocument();
    expect(screen.getByText("Link views: 44")).toBeInTheDocument();
    expect(screen.getByText("Purchases: 8")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Summer/i })).toHaveAttribute(
      "href",
      "/dynamic-links/links?q=summer",
    );
    expect(screen.getByText("100%")).toBeInTheDocument();

    expect(mocks.links).toHaveBeenCalledWith("10-test", "", true, {
      from: "2026-07-01",
      to: "2026-08-01",
      platform: "ios",
    });
    expect(mocks.productStatistics).toHaveBeenCalledWith("10-test", {
      from: "2026-07-01",
      to: "2026-08-01",
      platform: "ios",
    });
  });

  it("keeps available modules visible when one module fails", async () => {
    mocks.productStatistics.mockRejectedValue(new Error("Products unavailable"));
    render(<DashboardPageContent />);

    expect(await screen.findByText("Customers: 120")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText(/purchase analytics: Products unavailable/i),
      ).toBeInTheDocument(),
    );
  });
});
