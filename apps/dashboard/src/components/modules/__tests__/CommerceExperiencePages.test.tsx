import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getPurchases: vi.fn(),
  getProducts: vi.fn(),
  getProductStatistics: vi.fn(),
  getSubscriptions: vi.fn(),
  getPaywallStatistics: vi.fn(),
  getOnboardingStatistics: vi.fn(),
}));

vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: () => ({
    selectedProject: { id: "10-test", name: "Test" },
  }),
}));
vi.mock("@/components/layout/app-header", () => ({
  default: () => <header>SuperBoard</header>,
}));
vi.mock("@/api/products/productsService", () => ({
  archiveEntitlement: vi.fn(),
  archiveOffering: vi.fn(),
  archivePackage: vi.fn(),
  archiveProduct: vi.fn(),
  createEntitlement: vi.fn(),
  createOffering: vi.fn(),
  createPackage: vi.fn(),
  createProduct: vi.fn(),
  createPurchase: vi.fn(),
  createRefund: vi.fn(),
  getEntitlements: vi.fn(),
  getOfferings: vi.fn(),
  getPackages: vi.fn(),
  getPurchase: vi.fn(),
  getStoreSyncRuns: vi.fn(),
  syncStoreCatalog: vi.fn(),
  updateEntitlement: vi.fn(),
  updateOffering: vi.fn(),
  updatePackage: vi.fn(),
  updateProduct: vi.fn(),
  updateSubscription: vi.fn(),
  getPurchases: api.getPurchases,
  getProducts: api.getProducts,
  getProductStatistics: api.getProductStatistics,
  getSubscriptions: api.getSubscriptions,
}));
vi.mock("@/api/paywalls/paywallsService", () => ({
  archivePaywall: vi.fn(),
  archivePaywallExperience: vi.fn(),
  archivePaywallVersion: vi.fn(),
  createPaywall: vi.fn(),
  createPaywallExperience: vi.fn(),
  createPaywallVersion: vi.fn(),
  deletePaywallPlacement: vi.fn(),
  getPaywallExperiences: vi.fn(),
  getPaywallPlacements: vi.fn(),
  getPaywallVersions: vi.fn(),
  getPaywalls: vi.fn(),
  publishPaywallVersion: vi.fn(),
  savePaywallPlacement: vi.fn(),
  updatePaywall: vi.fn(),
  updatePaywallExperience: vi.fn(),
  getPaywallStatistics: api.getPaywallStatistics,
}));
vi.mock("@/api/onboardings/onboardingsService", () => ({
  createOnboarding: vi.fn(),
  createOnboardingExperience: vi.fn(),
  createOnboardingTargetingRule: vi.fn(),
  createOnboardingVersion: vi.fn(),
  deleteOnboarding: vi.fn(),
  deleteOnboardingPlacement: vi.fn(),
  deleteOnboardingTargetingRule: vi.fn(),
  getOnboardingExperiences: vi.fn(),
  getOnboardingPlacements: vi.fn(),
  getOnboardings: vi.fn(),
  getOnboardingTargetingRules: vi.fn(),
  getOnboardingVersions: vi.fn(),
  publishOnboarding: vi.fn(),
  saveOnboardingPlacement: vi.fn(),
  setOnboardingExperienceStatus: vi.fn(),
  updateOnboarding: vi.fn(),
  getOnboardingStatistics: api.getOnboardingStatistics,
}));

import { PurchasesPage } from "../ProductsPages";
import { PaywallStatisticsPage } from "../PaywallsPage";
import { OnboardingStatisticsPage } from "../OnboardingPages";

describe("commerce and experience module parity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPurchases.mockResolvedValue([]);
    api.getProducts.mockResolvedValue([
      {
        id: "product-1",
        identifier: "pro",
        display_name: "Pro",
        description: null,
        product_type: "subscription",
        status: "active",
      },
    ]);
    api.getSubscriptions.mockResolvedValue([]);
    api.getProductStatistics.mockResolvedValue({
      totals: {
        purchases: 2,
        gross_revenue_micros: 1_998_000,
        refunds: 0,
        refunded_micros: 0,
        net_revenue_micros: 1_998_000,
        active_subscriptions: 1,
      },
      by_status: [{ status: "active", count: 2 }],
      series: [
        { bucket: "2026-08-07", purchases: 2, revenue_micros: 1_998_000 },
      ],
      by_product_platform: [
        {
          product_id: "product-1",
          product_name: "Pro",
          platform: "ios",
          store: "apple",
          units_sold: 2,
          first_time_purchases: 1,
          revenue_micros: 1_998_000,
          currency: "USD",
          cancellations: 0,
        },
      ],
    });
    api.getPaywallStatistics.mockResolvedValue({
      filters: {},
      totals: {
        view: 10,
        purchase: 2,
        conversion_rate: 0.2,
        revenue_micros: 1_998_000,
        revenue_by_currency: { USD: 1_998_000 },
      },
      series: [
        {
          bucket: "2026-08-07",
          event_type: "purchase",
          count: 2,
          revenue_micros: 1_998_000,
          currency: "USD",
        },
      ],
    });
    api.getOnboardingStatistics.mockResolvedValue({
      filters: {},
      totals: { impression: 10, complete: 7 },
      completion_rate: 0.7,
      drop_off_rate: 0.3,
      funnel: [{ step: "welcome", count: 10 }],
      series: [
        {
          date: "2026-08-07",
          event_type: "step_view",
          platform: "ios",
          placement: "first_run",
          step_id: "welcome",
          count: 10,
        },
      ],
    });
  });

  it("keeps the legacy product/platform revenue columns in Purchases", async () => {
    render(<PurchasesPage />);
    expect(
      await screen.findByText("Revenue by product and platform")
    ).toBeInTheDocument();
    expect(screen.getByText("First-time purchases")).toBeInTheDocument();
    expect(screen.getByText("Total revenue")).toBeInTheDocument();
    expect(
      await screen.findByText("iOS", { exact: false })
    ).toBeInTheDocument();
  });

  it("reads conversion and currency revenue from the Worker totals envelope", async () => {
    render(<PaywallStatisticsPage />);
    expect(await screen.findByText("20.0%")).toBeInTheDocument();
    expect(screen.getAllByText("$2.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("purchase").length).toBeGreaterThan(0);
  });

  it("renders onboarding completion, drop-off, funnel and event dimensions", async () => {
    render(<OnboardingStatisticsPage />);
    expect(await screen.findByText("70.0%")).toBeInTheDocument();
    expect(screen.getByText("30.0%")).toBeInTheDocument();
    expect(screen.getAllByText("welcome").length).toBeGreaterThan(0);
    expect(screen.getByText("first_run")).toBeInTheDocument();
  });
});
