import { FrontContextProvider } from "@superboard/front-ui/context";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "../../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	getLinks: vi.fn(),
	getLinkCampaigns: vi.fn(),
	getDomains: vi.fn(),
	getLinkStatistics: vi.fn(),
	getLinkCampaignAnalytics: vi.fn(),
	getTracking: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "10-test" } }),
	}),
);

vi.mock(
	"../../../../../../../../packages/plugins/superboard-acquisition/src/front/dynamic-links/api/dynamic-links/dynamicLinksService.js",
	async (importOriginal) => ({
		...(await importOriginal<object>()),
		...mocks,
	}),
);

import DynamicLinksWorkspace from "../../../../../../../../packages/plugins/superboard-acquisition/src/front/dynamic-links/components/dynamic_links/DynamicLinksWorkspace.js";

const statistics = {
	totals: {
		views: 12,
		clicks: 3,
		opens: 4,
		installs: 2,
		app_opens: 1,
		user_referred: 1,
		revenue: 2500,
	},
	series: [
		{ date: "2026-10-01", event_type: "view", platform: "ios", count: 12, revenue_cents: 0 },
	],
};
const link = {
	id: "link-1",
	slug: "launch",
	name: "Launch link",
	destination_url: "https://example.test",
	destinations: {},
	utm: { source: "tiktok" },
	active: true,
	created_at: new Date().toISOString(),
	total_views: 12,
	total_installs: 2,
};

const search = () => new URLSearchParams(window.location.search);

describe("DynamicLinksWorkspace", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/acquisition/dynamic-links");
		mocks.getLinks.mockResolvedValue([link]);
		mocks.getLinkCampaigns.mockResolvedValue([]);
		mocks.getDomains.mockResolvedValue([]);
		mocks.getLinkStatistics.mockResolvedValue(statistics);
		mocks.getLinkCampaignAnalytics.mockResolvedValue([]);
		mocks.getTracking.mockResolvedValue({
			enabled: true,
			provider: "superboard",
			configuration: {},
		});
	});

	it("keeps the page identity and offers the four workspace tabs", async () => {
		render(<DynamicLinksWorkspace />);
		expect(screen.getByRole("heading", { level: 1, name: "Dynamic links" })).toBeInTheDocument();
		expect(
			screen.getByText(
				"Create, route and measure links across every platform and acquisition source.",
			),
		).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Links",
			"Campaigns",
			"Analytics",
			"Settings",
		]);
		expect(screen.getByRole("tab", { name: "Links" })).toHaveAttribute("aria-selected", "true");
		await waitFor(() => expect(screen.getByText("Launch link")).toBeInTheDocument());
	});

	it("opens the Create link dialog from ?create=1 and drops the parameter", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?create=1");
		render(<DynamicLinksWorkspace />);
		expect(await screen.findByRole("dialog", { name: "Create link" })).toBeInTheDocument();
		await waitFor(() => expect(search().has("create")).toBe(false));
	});

	it("invites the operator to configure a domain from the links tab", async () => {
		render(<DynamicLinksWorkspace />);
		await userEvent.click(await screen.findByRole("button", { name: "Configure domain" }));
		expect(search().get("tab")).toBe("settings");
		expect(search().get("section")).toBe("domain");
		expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "Domain" })).toHaveAttribute("aria-selected", "true");
	});

	it("hides the domain notice once a branded domain is verified", async () => {
		mocks.getDomains.mockResolvedValue([
			{ id: "d", hostname: "go.example.test", status: "verified" },
		]);
		render(<DynamicLinksWorkspace />);
		await screen.findByText("Launch link");
		await waitFor(() => expect(mocks.getDomains).toHaveBeenCalled());
		expect(screen.queryByText("No branded domain yet")).not.toBeInTheDocument();
	});

	it("opens legacy settings routes on the matching settings section", async () => {
		render(<DynamicLinksWorkspace tab="settings" section="tracking" />);
		expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getByRole("tab", { name: "Tracking" })).toHaveAttribute("aria-selected", "true");
		expect(
			await screen.findByRole("button", { name: "Save tracking settings" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("switch")).toHaveLength(1);
	});

	it("measures links by source and platform in the analytics tab", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=analytics");
		render(<DynamicLinksWorkspace />);
		expect(await screen.findByText("Daily traffic")).toBeInTheDocument();
		await waitFor(() =>
			expect(mocks.getLinks).toHaveBeenCalledWith(
				"10-test",
				"",
				undefined,
				expect.objectContaining({ limit: 100, sort_by: "views" }),
			),
		);
		expect(mocks.getLinkStatistics).toHaveBeenCalledWith(
			"10-test",
			expect.objectContaining({ interval: "day" }),
		);
		expect(await screen.findByText("Launch link")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("tab", { name: "By source" }));
		expect(await screen.findByText("tiktok")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("tab", { name: "By platform" }));
		expect(await screen.findByText("iOS")).toBeInTheDocument();
	});

	it("shows an empty analytics state with a create-link action", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=analytics");
		mocks.getLinks.mockResolvedValue([]);
		mocks.getLinkStatistics.mockResolvedValue({ totals: {}, series: [] });
		render(<DynamicLinksWorkspace />);
		expect(await screen.findByText("No link activity for this period")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Create link" }));
		expect(search().get("tab")).toBeNull();
		expect(screen.getByRole("tab", { name: "Links" })).toHaveAttribute("aria-selected", "true");
	});

	it("renders a campaign detail inside the campaigns tab", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links/campaigns/campaign-1");
		mocks.getLinkCampaigns.mockResolvedValue([
			{
				id: "campaign-1",
				name: "Autumn launch",
				slug: "autumn",
				status: "active",
				metadata: {},
				created_at: "2026-10-01",
			},
		]);
		render(<DynamicLinksWorkspace campaignId="campaign-1" />);
		expect(screen.getByRole("tab", { name: "Campaigns" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByRole("heading", { name: "Autumn launch" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Back to campaigns" })).toBeInTheDocument();
		await waitFor(() =>
			expect(mocks.getLinkStatistics).toHaveBeenCalledWith(
				"10-test",
				expect.objectContaining({ campaign_id: "campaign-1" }),
			),
		);
	});

	it("renders the workspace in French", () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-dynamic-links",
					path: "/acquisition/dynamic-links",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-dynamic-links"],
				}}
			>
				<DynamicLinksWorkspace />
			</FrontContextProvider>,
		);
		expect(screen.getByRole("heading", { level: 1, name: "Liens dynamiques" })).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Liens",
			"Campagnes",
			"Analyses",
			"Paramètres",
		]);
	});
});
