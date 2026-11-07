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
	saveSocialPreview: vi.fn(),
	saveTracking: vi.fn(),
	deleteDomain: vi.fn(),
	verifyDomain: vi.fn(),
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

const campaignAnalytics = {
	id: "campaign-1",
	name: "Summer launch",
	slug: "summer-launch",
	status: "active",
	metadata: {},
	created_at: "2026-07-20T00:00:00.000Z",
	total_views: 42,
	total_opens: 30,
	total_installs: 20,
	total_reinstalls: 4,
	total_reactivations: 3,
	total_app_opens: 25,
	total_user_referred: 11,
	total_revenue: 9900,
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
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
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
		mocks.saveSocialPreview.mockResolvedValue({ saved: true });
		mocks.saveTracking.mockResolvedValue({ saved: true });
		mocks.deleteDomain.mockResolvedValue({ deleted: true });
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
			await screen.findByRole("switch", { name: "Collect link analytics" }),
		).toBeInTheDocument();
		expect(await screen.findByRole("textbox", { name: "Title" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("opens legacy settings routes on the matching settings section", async () => {
		render(<DynamicLinksWorkspace tab="settings" section="tracking" />);
		expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		expect(
			await screen.findByRole("switch", { name: "Collect link analytics" }),
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

	it("asks before removing a domain and shows its verification state", async () => {
		const user = userEvent.setup();
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
		await user.click(await screen.findByRole("button", { name: /go\.example\.test/ }));
		expect(screen.getByText("Pending verification")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Remove" }));
		expect(mocks.deleteDomain).not.toHaveBeenCalled();
		const confirmation = await screen.findByRole("alertdialog");
		await user.click(within(confirmation).getByRole("button", { name: "Remove" }));
		await waitFor(() => expect(mocks.deleteDomain).toHaveBeenCalledWith("10-test", "domain-1"));
	});

	it("shows the exact DNS record and explains why a verification failed", async () => {
		const user = userEvent.setup();
		const record = { type: "TXT", name: "_superboard.go.example.test", value: "token-1" };
		mocks.getDomains.mockResolvedValue([
			{
				id: "domain-1",
				hostname: "go.example.test",
				status: "pending",
				verification_token: "token-1",
				verification_record: record,
				is_default: 1,
			},
		]);
		mocks.verifyDomain
			.mockResolvedValueOnce({
				id: "domain-1",
				verified: false,
				status: "pending",
				check: { result: "not_found", record, found: [] },
			})
			.mockResolvedValueOnce({
				id: "domain-1",
				verified: false,
				status: "pending",
				check: { result: "mismatch", record, found: ["old-token"] },
			});
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=settings");
		render(<DynamicLinksWorkspace />);
		await user.click(await screen.findByRole("button", { name: /go\.example\.test/ }));
		expect(screen.getByText("_superboard.go.example.test")).toBeInTheDocument();
		expect(screen.getByText("token-1")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Verify DNS" }));
		expect(
			await screen.findByText(
				"No TXT record was found at _superboard.go.example.test yet. DNS changes can take several minutes to propagate.",
			),
		).toBeInTheDocument();
		expect(screen.getByText("Pending verification")).toBeInTheDocument();
		expect(screen.queryByText("Verified")).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Verify DNS" }));
		expect(
			await screen.findByText(
				"A TXT record exists at _superboard.go.example.test, but its value does not match. Value found: old-token",
			),
		).toBeInTheDocument();
		expect(mocks.verifyDomain).toHaveBeenCalledWith("10-test", "domain-1");
	});

	it("keeps the tracking provider hidden until collection is on and saves the switch by itself", async () => {
		const user = userEvent.setup();
		mocks.getTracking.mockResolvedValue({
			enabled: false,
			provider: "superboard",
			configuration: {},
		});
		render(<DynamicLinksWorkspace tab="settings" section="tracking" />);
		const collect = await screen.findByRole("switch", { name: "Collect link analytics" });
		await waitFor(() => expect(collect).not.toBeChecked());
		expect(screen.queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
		await user.click(collect);
		expect(screen.getByRole("combobox", { name: "Provider" })).toBeInTheDocument();
		await waitFor(
			() =>
				expect(mocks.saveTracking).toHaveBeenCalledWith(
					"10-test",
					expect.objectContaining({ enabled: true, provider: "superboard" }),
				),
			{ timeout: 3000 },
		);
		expect(mocks.saveTracking).toHaveBeenCalledTimes(1);
	});

	it("saves social preview edits by itself, and only once the preview has a title", async () => {
		const user = userEvent.setup();
		mocks.getSocialPreview.mockResolvedValue({
			title: "Launch",
			description: "",
			image_url: "",
			site_name: "",
		});
		render(<DynamicLinksWorkspace tab="settings" section="preview" />);
		const title = await screen.findByDisplayValue("Launch");
		await new Promise((resolve) => {
			setTimeout(resolve, 800);
		});
		expect(mocks.saveSocialPreview).not.toHaveBeenCalled();
		await user.clear(title);
		expect(await screen.findByText("Add a title to save the social preview.")).toBeInTheDocument();
		await new Promise((resolve) => {
			setTimeout(resolve, 800);
		});
		expect(mocks.saveSocialPreview).not.toHaveBeenCalled();
		await user.type(title, "Spring launch");
		await waitFor(
			() =>
				expect(mocks.saveSocialPreview).toHaveBeenCalledWith("10-test", {
					title: "Spring launch",
					description: "",
					image_url: "",
					site_name: "",
				}),
			{ timeout: 3000 },
		);
		expect(mocks.saveSocialPreview).toHaveBeenCalledTimes(1);
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

	it("shows the essential campaign columns by default and keeps the others in the column picker", async () => {
		window.history.replaceState(null, "", "/acquisition/dynamic-links?tab=campaigns");
		mocks.getLinkCampaignAnalytics.mockResolvedValue([campaignAnalytics]);
		render(<DynamicLinksWorkspace />);
		const table = await screen.findByRole("table", { name: "Acquisition campaigns" });
		await within(table).findByText("Summer launch");
		expect(columnHeaders(table)).toEqual(["Title", "Views", "Installs", "Revenue", "Date"]);
		await userEvent.click(screen.getByRole("combobox", { name: "Columns" }));
		const picker = within(await screen.findByRole("dialog"));
		expect(
			picker
				.getAllByRole("checkbox")
				.map((option) => [
					option.closest("label")?.textContent,
					option.getAttribute("aria-checked"),
				]),
		).toEqual([
			["Views", "true"],
			["Opens", "false"],
			["Installs", "true"],
			["Reinstalls", "false"],
			["Reactivations", "false"],
			["App opens", "false"],
			["Users referred", "false"],
			["Revenue", "true"],
			["Date", "true"],
		]);
		await userEvent.click(picker.getByRole("checkbox", { name: "Users referred" }));
		expect(columnHeaders(table)).toEqual([
			"Title",
			"Views",
			"Installs",
			"Users referred",
			"Revenue",
			"Date",
		]);
		expect(within(table).getByText("11")).toBeInTheDocument();
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
		expect(columnHeaders(campaigns)).toEqual(["Titre", "Vues", "Installations", "Revenu", "Date"]);
		await userEvent.click(screen.getByRole("combobox", { name: "Colonnes" }));
		expect(screen.getByRole("checkbox", { name: "Utilisateurs recommandés" })).not.toBeChecked();
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
