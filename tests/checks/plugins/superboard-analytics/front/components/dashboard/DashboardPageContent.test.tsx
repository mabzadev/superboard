import { FrontContextProvider, useFrontContext } from "@superboard/front-ui/context";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	project: { id: "10-test" },
	analyticsOverview: vi.fn(),
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

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: mocks.project }),
	}),
);

vi.mock("../../../../../../../packages/supbrd-front-ui/src/shared/hooks/useTableParams.js", () => {
	const parameters = {
		dateRange: {
			from: new Date("2026-07-01T00:00:00.000Z"),
			to: new Date("2026-08-01T00:00:00.000Z"),
		},
		setDateRange: vi.fn(),
		platform: "ios",
		setPlatform: vi.fn(),
	};
	return { useTableParams: () => parameters };
});

vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/api/analytics/analyticsService.js",
	() => ({ getAnalyticsOverview: mocks.analyticsOverview }),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/api/app/appService.js",
	() => ({
		getAppOverview: mocks.appOverview,
		getAccessKey: mocks.accessKey,
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/api/dynamic-links/dynamicLinksService.js",
	() => ({
		getLinks: mocks.links,
		getLinkCampaigns: mocks.campaigns,
		getDomains: mocks.domains,
		getRedirectRules: mocks.rules,
		getLinkStatistics: mocks.linkStatistics,
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/api/products/productsService.js",
	() => ({
		getProducts: mocks.products,
		getProductStatistics: mocks.productStatistics,
	}),
);

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/components/modules/ModulePage.js",
	() => ({
		ModulePage: ({ title, children }: { title: string; children: React.ReactNode }) => (
			<main>
				<h1>{title}</h1>
				{children}
			</main>
		),
		EmptyProject: () => <p>Select project</p>,
		moduleErrorMessage: (error: unknown) =>
			error instanceof Error ? error.message : String(error),
	}),
);

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/components/dateRangePicker/DateRangePicker.js",
	() => ({
		DateRangePicker: () => <button>Date range</button>,
	}),
);

vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/components/common/ads-platform.js",
	() => ({
		default: () => <button>Platforms</button>,
	}),
);

vi.mock(
	"../../../../../../../packages/plugins/superboard-analytics/src/front/components/layout/section-cards.js",
	() => ({
		SectionCards: ({ cards }: { cards: Array<{ title: string; value: number }> }) => (
			<section aria-label="Metrics">
				{cards.map((card) => (
					<p key={card.title}>
						{card.title}: {card.value}
					</p>
				))}
			</section>
		),
	}),
);

import DashboardPageContent from "../../../../../../../packages/plugins/superboard-analytics/src/front/components/dashboard/DashboardPageContent.js";

describe("DashboardPageContent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.analyticsOverview.mockResolvedValue({
			events: 1234,
			unique_subjects: 56,
			sessions: 78,
			installations: 9,
			successful_purchases: 3,
			series: [],
		});
		mocks.appOverview.mockResolvedValue({
			project_id: 10,
			customers: 120,
			referrals: 12,
			configured_platforms: 2,
		});
		mocks.accessKey.mockResolvedValue({
			id: "key-1",
			prefix: "og_app_test",
			created_at: "2026-07-01",
		});
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

	it("aggregates Analytics with the optional Dynamic Links and Products services", async () => {
		render(<DashboardPageContent />);

		expect(await screen.findByText("Events: 1234")).toBeInTheDocument();
		const metrics = screen.getByRole("region", { name: "Metrics" });
		expect([...metrics.querySelectorAll("p")].map((card) => card.textContent)).toEqual([
			"Events: 1234",
			"Unique people: 56",
			"Installations: 9",
			"Verified purchases: 3",
			"Link views: 44",
			"Net revenue: 1000",
		]);
		expect(screen.getByRole("link", { name: /Summer/i })).toHaveAttribute(
			"href",
			"/acquisition/dynamic-links?q=summer",
		);
		expect(screen.getByText("100%")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();

		expect(mocks.analyticsOverview).toHaveBeenCalledWith("10-test", {
			from: "2026-07-01T00:00:00.000Z",
			to: "2026-08-01T00:00:00.000Z",
		});

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

	it("links the quick start and link analytics to canonical routes", async () => {
		render(<DashboardPageContent />);

		const hrefOf = async (name: RegExp) =>
			(await screen.findByRole("link", { name })).getAttribute("href");
		expect(await hrefOf(/Create an API key/i)).toBe("/auth/settings?tab=security&section=keys");
		expect(await hrefOf(/Install an SDK/i)).toBe("/core/libraries");
		expect(await hrefOf(/Configure link routing/i)).toBe(
			"/acquisition/dynamic-links?tab=settings&section=routing",
		);
		expect(await hrefOf(/Publish the first link/i)).toBe("/acquisition/dynamic-links");
		expect(await hrefOf(/Build the product catalog/i)).toBe("/monetization/products");
		expect(await hrefOf(/See Dynamic links analytics/i)).toBe(
			"/acquisition/dynamic-links?tab=analytics",
		);
		for (const link of screen.getAllByRole("link")) {
			expect(link.getAttribute("href")).not.toMatch(
				/^\/(app|dynamic-links|products|flows|marketing)\//,
			);
		}
	});

	it("renders the overview in French", async () => {
		render(<DashboardPageContent />, { wrapper: French });

		expect(await screen.findByText("Événements: 1234")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 1, name: "Vue d’ensemble" })).toBeInTheDocument();
		expect(screen.getByText("5 étapes essentielles sur 5 terminées.")).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: /Voir l’analyse des liens dynamiques/ }),
		).toHaveAttribute("href", "/acquisition/dynamic-links?tab=analytics");
	});

	it("keeps available modules visible when one module fails", async () => {
		mocks.productStatistics.mockRejectedValue(new Error("Products unavailable"));
		render(<DashboardPageContent />);

		expect(await screen.findByText("Events: 1234")).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByText(/purchase analytics: Products unavailable/i)).toBeInTheDocument(),
		);
	});
});

function French({ children }: { children: ReactNode }) {
	const context = useFrontContext();
	return (
		<FrontContextProvider value={{ ...context, locale: "fr" }}>{children}</FrontContextProvider>
	);
}
