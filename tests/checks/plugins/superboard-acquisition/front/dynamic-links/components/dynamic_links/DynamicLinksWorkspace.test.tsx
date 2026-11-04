import { FrontContextProvider } from "@superboard/front-ui/context";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	render,
	screen,
	waitFor,
	within,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const project = vi.hoisted(() => ({ id: "10-test" }));
const mocks = vi.hoisted(() => ({
	getLinks: vi.fn(),
	getLinkCampaigns: vi.fn(),
	getDomains: vi.fn(),
	getLinkStatistics: vi.fn(),
	getLinkCampaignAnalytics: vi.fn(),
	getTracking: vi.fn(),
	getRedirectRules: vi.fn(),
	getSocialPreview: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: project }),
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
const scrollIntoView = vi.fn();
const settingsHeadings = ["Domain", "Redirect rules", "Social preview", "Tracking"];
const columnHeaders = (table: HTMLElement) =>
	within(table)
		.getAllByRole("columnheader")
		.map((header) => header.textContent?.trim());

function renderInFrench(ui: ReactElement) {
	return render(
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
			{ui}
		</FrontContextProvider>,
	);
}

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
		mocks.getRedirectRules.mockResolvedValue([]);
		mocks.getSocialPreview.mockResolvedValue(null);
		Object.defineProperties(Element.prototype, {
			hasPointerCapture: { configurable: true, value: () => false },
			setPointerCapture: { configurable: true, value: () => undefined },
			releasePointerCapture: { configurable: true, value: () => undefined },
			scrollIntoView: { configurable: true, value: scrollIntoView },
		});
		scrollIntoView.mockClear();
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
		const domain = screen.getByRole("heading", { level: 2, name: "Domain" });
		expect(scrollIntoView.mock.contexts).toContainEqual(domain.closest("[id]"));
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

	it("stacks every settings section under the single settings tab", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=settings");
		render(<DynamicLinksWorkspace />);
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		expect(
			screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
		).toEqual(settingsHeadings);
		expect(
			await screen.findByRole("button", { name: "Save tracking settings" }),
		).toBeInTheDocument();
		expect(await screen.findByRole("button", { name: "Save preview" })).toBeInTheDocument();
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("opens legacy settings routes on the matching settings section", async () => {
		render(<DynamicLinksWorkspace tab="settings" section="tracking" />);
		expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		expect(
			await screen.findByRole("button", { name: "Save tracking settings" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("switch")).toHaveLength(1);
		const tracking = screen.getByRole("heading", { level: 2, name: "Tracking" });
		expect(scrollIntoView.mock.contexts).toEqual([tracking.closest("[id]")]);
	});

	it("scrolls legacy section bookmarks to the matching settings section", () => {
		window.history.replaceState(
			null,
			"",
			"/acquisition/dynamic-links?tab=settings&section=preview",
		);
		render(<DynamicLinksWorkspace />);
		const preview = screen.getByRole("heading", { level: 2, name: "Social preview" });
		expect(scrollIntoView.mock.contexts).toEqual([preview.closest("[id]")]);
	});

	it("shows a domain in place of the domain list and returns to it", async () => {
		mocks.getDomains.mockResolvedValue([
			{
				id: "domain-1",
				hostname: "go.example.test",
				status: "pending",
				verification_token: "token-1",
				is_default: 1,
			},
		]);
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=settings");
		render(<DynamicLinksWorkspace />);
		await userEvent.click(await screen.findByRole("button", { name: /go\.example\.test/ }));
		expect(search().get("domain")).toBe("domain-1");
		expect(screen.getByRole("heading", { level: 3, name: "go.example.test" })).toBeInTheDocument();
		expect(screen.getByText("token-1")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Add domain" })).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "All domains" }));
		expect(search().has("domain")).toBe(false);
		expect(screen.getByRole("button", { name: "Add domain" })).toBeInTheDocument();
		expect(screen.queryByText("token-1")).not.toBeInTheDocument();
	});

	it("stacks a link's details in sections instead of internal tabs", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?item=link-1");
		render(<DynamicLinksWorkspace />);
		expect(
			await screen.findByRole("heading", { level: 2, name: "Launch link" }),
		).toBeInTheDocument();
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(
			screen.getAllByText(
				"Create, route and measure links across every platform and acquisition source.",
			),
		).toHaveLength(1);
		expect(
			screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent),
		).toEqual(["Link details", "Platform routing", "Social preview", "UTM tracking"]);
		expect(screen.getByDisplayValue("tiktok")).toBeVisible();
		expect(screen.queryByRole("button", { name: "Destinations" })).not.toBeInTheDocument();
		await userEvent.click(screen.getByRole("button", { name: "Back to list" }));
		expect(search().has("item")).toBe(false);
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
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		await userEvent.click(screen.getByRole("combobox", { name: "Breakdown dimension" }));
		await userEvent.click(await screen.findByRole("option", { name: "By source" }));
		expect(await screen.findByText("tiktok")).toBeInTheDocument();
		expect(search().get("by")).toBe("source");
		await userEvent.click(screen.getByRole("combobox", { name: "Breakdown dimension" }));
		await userEvent.click(await screen.findByRole("option", { name: "By platform" }));
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

	it("shows the essential link columns by default and keeps the others in the column picker", async () => {
		render(<DynamicLinksWorkspace />);
		const table = await screen.findByRole("table", { name: "Links" });
		await within(table).findByText("Launch link");
		expect(columnHeaders(table)).toEqual(["", "Title", "Destination", "Views", "Installs", "Date"]);
		expect(within(table).getByText("/launch")).toBeInTheDocument();
		expect(within(table).getByText("https://example.test")).toBeInTheDocument();
		await userEvent.click(screen.getByRole("combobox", { name: "Columns" }));
		await userEvent.click(screen.getByRole("checkbox", { name: "Opens" }));
		expect(columnHeaders(table)).toEqual([
			"",
			"Title",
			"Destination",
			"Views",
			"Opens",
			"Installs",
			"Date",
		]);
	});

	it("renders the links and campaigns tables in French", async () => {
		renderInFrench(<DynamicLinksWorkspace />);
		const links = await screen.findByRole("table", { name: "Liens" });
		await within(links).findByText("Launch link");
		expect(columnHeaders(links)).toEqual([
			"",
			"Titre",
			"Destination",
			"Vues",
			"Installations",
			"Date",
		]);
		await userEvent.click(screen.getByRole("combobox", { name: "Colonnes" }));
		expect(screen.getByRole("checkbox", { name: "Temps passé" })).not.toBeChecked();
		await userEvent.keyboard("{Escape}");
		await userEvent.click(screen.getByRole("tab", { name: "Campagnes" }));
		const campaigns = await screen.findByRole("table", { name: "Campagnes d’acquisition" });
		expect(columnHeaders(campaigns)).toEqual([
			"Titre",
			"Vues",
			"Ouvertures",
			"Installations",
			"Réinstallations",
			"Réactivations",
			"Ouvertures de l’application",
			"Utilisateurs recommandés",
			"Revenu",
			"Date",
		]);
	});

	it("explains an empty link list in French", async () => {
		mocks.getLinks.mockResolvedValue([]);
		renderInFrench(<DynamicLinksWorkspace />);
		expect(await screen.findByText("Aucun lien pour le moment")).toBeInTheDocument();
	});

	it("renders the workspace in French", () => {
		renderInFrench(<DynamicLinksWorkspace />);
		expect(screen.getByRole("heading", { level: 1, name: "Liens dynamiques" })).toBeInTheDocument();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"Liens",
			"Campagnes",
			"Analyses",
			"Paramètres",
		]);
	});
});
