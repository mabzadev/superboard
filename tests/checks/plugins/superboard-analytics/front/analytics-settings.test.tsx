import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/plugin-configuration-tab", () => ({
	PluginConfigurationTab: () => <div data-testid="plugin-config-tab">Plugin configuration</div>,
}));

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
}));

vi.mock(
	"../../../../../packages/plugins/superboard-analytics/src/front/api/analytics/analyticsService.js",
	() => ({
		getAnalyticsSettings: mockAnalytics.getSettings,
		getAnalyticsApplications: mockAnalytics.getApplications,
		getAnalyticsHooks: mockAnalytics.getHooks,
		getAnalyticsAnnotations: mockAnalytics.getAnnotations,
		updateAnalyticsSettings: vi.fn().mockResolvedValue({}),
		updateAnalyticsApplication: vi.fn().mockResolvedValue({}),
		createAnalyticsHook: vi.fn().mockResolvedValue({}),
		createAnalyticsAnnotation: vi.fn().mockResolvedValue({}),
		deleteAnalyticsAnnotation: vi.fn().mockResolvedValue({}),
	}),
);

import { FrontContextProvider } from "@superboard/front-ui/context";

import { AnalyticsSettingsPage } from "../../../../../packages/plugins/superboard-analytics/src/front/components/analytics/AnalyticsFeaturePages.js";
import AnalyticsSettingsView from "../../../../../packages/plugins/superboard-analytics/src/front/views/superboard.analytics_settings.js";

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
	});

	it("opens a linked settings tab and keeps the selected tab on reload", async () => {
		window.history.replaceState(null, "", "/analytics/settings?lang=en&tab=collection");
		const user = userEvent.setup();
		const view = render(<AnalyticsSettingsPage />);
		expect(screen.getByRole("tab", { name: "Data collection" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await user.click(screen.getByRole("tab", { name: "Webhooks" }));
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("hooks");
		expect(new URLSearchParams(window.location.search).get("lang")).toBe("en");
		view.unmount();
		render(<AnalyticsSettingsPage />);
		expect(screen.getByRole("tab", { name: "Webhooks" })).toHaveAttribute("aria-selected", "true");
	});

	it("renders settings with all tabs including Configuration", async () => {
		render(<AnalyticsSettingsPage />);

		expect(screen.getByText("Analytics settings")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Applications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Data collection" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Webhooks" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Annotations" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();
	});

	it("switches to configuration tab and opens the active View configuration", async () => {
		const user = userEvent.setup();
		render(<AnalyticsSettingsPage />);

		const configBtn = screen.getByRole("tab", { name: "Configuration" });
		await user.click(configBtn);

		await waitFor(() => {
			expect(screen.getByTestId("plugin-config-tab")).toHaveTextContent("Plugin configuration");
		});
	});

	it("renders settings in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "supbrd-plugmod-analytics",
					path: "/analytics/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["supbrd-plugmod-analytics"],
				}}
			>
				<AnalyticsSettingsPage />
			</FrontContextProvider>,
		);

		expect(screen.getByText("Paramètres des statistiques")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Applications" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();
	});

	it("renders from analytics_settings view", async () => {
		render(<AnalyticsSettingsView />);

		expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();
	});
});
