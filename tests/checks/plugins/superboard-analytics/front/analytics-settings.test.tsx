import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

if (!("PointerEvent" in window))
	Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });

vi.mock(
	"../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({
			selectedProject: { id: "project-1", name: "Production" },
			selectedInstance: { role: "owner" },
		}),
	}),
);

const mockAnalytics = vi.hoisted(() => ({
	getSettings: vi.fn(),
	getApplications: vi.fn(),
	getHooks: vi.fn(),
	getAnnotations: vi.fn(),
	updateSettings: vi.fn(),
	updateApplication: vi.fn(),
	createHook: vi.fn(),
}));

vi.mock(
	"../../../../../packages/plugins/superboard-analytics/src/front/api/analytics/analyticsService.js",
	() => ({
		getAnalyticsSettings: mockAnalytics.getSettings,
		getAnalyticsApplications: mockAnalytics.getApplications,
		getAnalyticsHooks: mockAnalytics.getHooks,
		getAnalyticsAnnotations: mockAnalytics.getAnnotations,
		updateAnalyticsSettings: mockAnalytics.updateSettings,
		updateAnalyticsApplication: mockAnalytics.updateApplication,
		createAnalyticsHook: mockAnalytics.createHook,
		createAnalyticsAnnotation: vi.fn().mockResolvedValue({}),
		deleteAnalyticsAnnotation: vi.fn().mockResolvedValue({}),
		deleteAnalyticsHook: vi.fn().mockResolvedValue({}),
	}),
);

import { FrontContextProvider } from "@superboard/front-ui/context";

import { AnalyticsSettingsPage } from "../../../../../packages/plugins/superboard-analytics/src/front/components/analytics/AnalyticsFeaturePages.js";
import AnalyticsSettingsView from "../../../../../packages/plugins/superboard-analytics/src/front/views/superboard.analytics_settings.js";

const autosaveWait = { timeout: 3_000 };

function openTab(tab: string) {
	window.history.replaceState(null, "", `/analytics/settings?tab=${tab}`);
	return render(<AnalyticsSettingsPage />);
}

describe("AnalyticsSettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState(null, "", "/analytics/settings");
		mockAnalytics.getSettings.mockResolvedValue({
			data_collection_enabled: true,
			hot_retention_days: 30,
			timezone: "UTC",
		});
		mockAnalytics.getApplications.mockResolvedValue({ items: [] });
		mockAnalytics.getHooks.mockResolvedValue({ items: [] });
		mockAnalytics.getAnnotations.mockResolvedValue({ items: [] });
		mockAnalytics.updateSettings.mockResolvedValue({});
		mockAnalytics.updateApplication.mockResolvedValue({});
		mockAnalytics.createHook.mockResolvedValue({});
	});

	it("opens a linked settings tab and keeps the selected tab on reload", async () => {
		window.history.replaceState(null, "", "/analytics/settings?lang=en&tab=collection");
		const user = userEvent.setup();
		const view = render(<AnalyticsSettingsPage />);
		expect(screen.getByRole("tab", { name: "Reports" })).toHaveAttribute("aria-selected", "true");
		await user.click(screen.getByRole("tab", { name: "Webhooks" }));
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("hooks");
		expect(new URLSearchParams(window.location.search).get("lang")).toBe("en");
		view.unmount();
		render(<AnalyticsSettingsPage />);
		expect(screen.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("aria-selected", "true");
	});

	it("renders settings tabs and points diagnostics to Plugins", async () => {
		render(<AnalyticsSettingsPage />);

		expect(screen.getByText("Analytics settings")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Applications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Reports" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Webhooks" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Annotations" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);
	});

	it("opens legacy configuration links on the default tab", () => {
		window.history.replaceState(null, "", "/analytics/settings?tab=configuration");
		render(<AnalyticsSettingsPage />);

		expect(screen.getByRole("tab", { name: "Applications" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("renders settings in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-analytics",
					path: "/analytics/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-analytics"],
				}}
			>
				<AnalyticsSettingsPage />
			</FrontContextProvider>,
		);

		expect(screen.getByText("Paramètres des statistiques")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Applications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Avancé" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ouvrir dans Plugins" })).toBeInTheDocument();
	});

	it("renders from analytics_settings view", async () => {
		render(<AnalyticsSettingsView />);

		expect(screen.getByRole("tab", { name: "Applications" })).toBeInTheDocument();
	});

	it("saves a report time zone change on its own, without a save button", async () => {
		const user = userEvent.setup();
		openTab("collection");
		const timezone = await screen.findByRole("combobox", { name: "Reporting timezone" });
		expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("switch")).not.toBeInTheDocument();

		await user.clear(timezone);
		await user.type(timezone, "Europe/Paris");

		await waitFor(
			() =>
				expect(mockAnalytics.updateSettings).toHaveBeenCalledWith("project-1", {
					hot_retention_days: 30,
					timezone: "Europe/Paris",
				}),
			autosaveWait,
		);
		expect(mockAnalytics.updateSettings).toHaveBeenCalledTimes(1);
		expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
	});

	it("does not save a retention outside 1 to 366 days", async () => {
		const user = userEvent.setup();
		openTab("advanced");
		const retention = await screen.findByRole("textbox", {
			name: "Detailed event retention (days)",
		});

		await user.clear(retention);
		await user.type(retention, "400");
		expect(screen.getByText("Enter a number of days between 1 and 366.")).toBeInTheDocument();
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(mockAnalytics.updateSettings).not.toHaveBeenCalled();

		await user.clear(retention);
		await user.type(retention, "90");
		await waitFor(
			() =>
				expect(mockAnalytics.updateSettings).toHaveBeenCalledWith(
					"project-1",
					expect.objectContaining({ hot_retention_days: 90 }),
				),
			autosaveWait,
		);
	});

	it("keeps an invalid reporting time zone unsaved", async () => {
		const user = userEvent.setup();
		openTab("collection");
		const timezone = await screen.findByRole("combobox", { name: "Reporting timezone" });

		await user.clear(timezone);
		await user.type(timezone, "Europe/Nowhere");
		expect(screen.getByText("Enter a valid time zone, such as Europe/Paris.")).toBeInTheDocument();
		await new Promise((resolve) => {
			setTimeout(resolve, 900);
		});
		expect(mockAnalytics.updateSettings).not.toHaveBeenCalled();
	});

	it("saves an application switch on its own and shows its new state", async () => {
		mockAnalytics.getApplications.mockResolvedValue({
			items: [
				{
					application_id: "app-ios",
					name: "Reference iOS",
					platform: "ios",
					timezone: "UTC",
					active: true,
					first_seen_at: "2026-09-01T12:00:00Z",
					last_seen_at: "2026-09-08T12:00:00Z",
					settings: {},
				},
			],
		});
		const user = userEvent.setup();
		openTab("applications");
		const application = await screen.findByRole("switch", { name: "Reference iOS" });
		expect(screen.queryByText("app-ios")).not.toBeInTheDocument();

		await user.click(application);

		expect(screen.getByText("Off")).toBeInTheDocument();
		await waitFor(
			() =>
				expect(mockAnalytics.updateApplication).toHaveBeenCalledWith("project-1", "app-ios", {
					active: false,
				}),
			autosaveWait,
		);
		await user.click(screen.getByRole("tab", { name: "Advanced" }));
		expect(screen.getByText("app-ios")).toBeInTheDocument();
	});

	it("shows webhook event names only when some events are chosen", async () => {
		const user = userEvent.setup();
		openTab("hooks");
		const collected = await screen.findByRole("switch", { name: "Send collected events" });
		expect(screen.queryByRole("textbox", { name: "Event names" })).not.toBeInTheDocument();

		await user.click(screen.getByRole("switch", { name: "Only some events" }));
		expect(screen.getByRole("textbox", { name: "Event names" })).toBeInTheDocument();

		await user.click(collected);
		expect(screen.queryByRole("switch", { name: "Only some events" })).not.toBeInTheDocument();
		expect(screen.queryByRole("textbox", { name: "Event names" })).not.toBeInTheDocument();
	});

	it("creates a webhook from the chosen event switches", async () => {
		const user = userEvent.setup();
		openTab("hooks");
		await user.type(await screen.findByRole("textbox", { name: "Name" }), "Warehouse");
		await user.type(
			screen.getByRole("textbox", { name: "Endpoint" }),
			"https://hooks.example.com/analytics",
		);
		await user.click(screen.getByRole("switch", { name: "Only some events" }));
		await user.type(
			screen.getByRole("textbox", { name: "Event names" }),
			"checkout.completed, app.opened",
		);
		await user.click(screen.getByRole("switch", { name: "Send triggered alerts" }));
		await user.click(screen.getByRole("button", { name: "Add webhook" }));

		await waitFor(() =>
			expect(mockAnalytics.createHook).toHaveBeenCalledWith("project-1", {
				name: "Warehouse",
				endpoint_url: "https://hooks.example.com/analytics",
				event_types: ["checkout.completed", "app.opened", "alert.triggered"],
				secret: undefined,
				enabled: true,
			}),
		);
	});

	it("asks for a signing secret only once signing is on", async () => {
		const user = userEvent.setup();
		openTab("hooks");
		await user.type(await screen.findByRole("textbox", { name: "Name" }), "Warehouse");
		await user.type(
			screen.getByRole("textbox", { name: "Endpoint" }),
			"https://hooks.example.com/analytics",
		);
		expect(screen.queryByLabelText("Signing secret")).not.toBeInTheDocument();

		await user.click(screen.getByRole("switch", { name: "Sign deliveries" }));
		expect(screen.getByRole("button", { name: "Add webhook" })).toBeDisabled();
		await user.type(screen.getByLabelText("Signing secret"), "shared-secret");
		await user.click(screen.getByRole("button", { name: "Add webhook" }));

		await waitFor(() =>
			expect(mockAnalytics.createHook).toHaveBeenCalledWith(
				"project-1",
				expect.objectContaining({ event_types: ["*"], secret: "shared-secret" }),
			),
		);
	});
});
