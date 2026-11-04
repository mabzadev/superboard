import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/section-navigation.js", () => ({
	SectionNavigation: () => <div data-testid="section-nav" />,
}));

vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/FlowsContext.js",
	() => ({
		useFlows: () => ({ projectRef: "test-project" }),
		FlowsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	}),
);

const mockFlowsApi = vi.hoisted(() => ({
	listEnvironments: vi.fn(),
	listLocalization: vi.fn(),
	rotateEnvironmentKey: vi.fn(),
	saveLocalization: vi.fn(),
}));

vi.mock(
	"../../../../../packages/plugins/superboard-acquisition/src/front/flows/api/flows/flowsService.js",
	() => ({
		flowsApi: mockFlowsApi,
	}),
);

import { FrontContextProvider } from "@superboard/front-ui/context";

import {
	AcquisitionSettingsPage,
	EnvironmentsSettingsPage,
	LocalizationSettingsPage,
	SdkSettingsPage,
} from "../../../../../packages/plugins/superboard-acquisition/src/front/flows/features/flows/SettingsPages.js";

describe("AcquisitionSettingsPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperties(Element.prototype, {
			hasPointerCapture: { configurable: true, value: () => false },
			setPointerCapture: { configurable: true, value: () => undefined },
			releasePointerCapture: { configurable: true, value: () => undefined },
			scrollIntoView: { configurable: true, value: () => undefined },
		});
		window.history.replaceState(null, "", "/acquisition/settings");
		mockFlowsApi.listEnvironments.mockResolvedValue([
			{
				id: "env-1",
				name: "Production",
				key: "production",
				kind: "production",
				allow_draft: false,
			},
		]);
		mockFlowsApi.listLocalization.mockResolvedValue([
			{
				id: "loc-1",
				name: "Global",
				default_locale: "en",
				locales: ["en", "fr"],
				fallbacks: { fr: "en" },
			},
		]);
	});

	it("opens the requested tab and retains the choice after a reload", async () => {
		window.history.replaceState(null, "", "/acquisition/settings?tab=localization&lang=fr");
		const view = render(<AcquisitionSettingsPage />);
		await waitFor(() => expect(screen.getByDisplayValue("Global")).toBeInTheDocument());
		await userEvent.click(screen.getByRole("tab", { name: "SDK" }));
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("sdk");
		expect(new URLSearchParams(window.location.search).get("lang")).toBe("fr");
		view.unmount();
		render(<AcquisitionSettingsPage />);
		expect(screen.getByRole("tab", { name: "SDK" })).toHaveAttribute("aria-selected", "true");
	});

	it("does not invent a production SDK environment when the list is empty", async () => {
		mockFlowsApi.listEnvironments.mockResolvedValue([]);
		const view = render(<AcquisitionSettingsPage defaultTab="sdk" />);
		await screen.findByRole("alert");
		expect(view.container.querySelector("pre code")).toBeNull();
	});

	it("preserves regional language codes while editing localization", async () => {
		render(<AcquisitionSettingsPage defaultTab="localization" />);
		const input = await screen.findByDisplayValue("en");
		await userEvent.clear(input);
		await userEvent.type(input, "fr-CH");
		expect(input).toHaveValue("fr-CH");
	});

	it("renders Acquisition Settings with all tabs and defaults to environments", async () => {
		render(<AcquisitionSettingsPage />);

		expect(screen.getByText("Acquisition settings")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Environments" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "SDK" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Localization" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Link defaults" })).not.toBeInTheDocument();
		expect(screen.getAllByRole("tab")).toHaveLength(3);
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);

		await waitFor(() => {
			expect(
				screen.getByText("Production", { selector: '[data-slot="card-title"]' }),
			).toBeInTheDocument();
			expect(screen.getAllByText("production").length).toBeGreaterThan(0);
		});
	});

	it("opens legacy configuration links on the default tab", () => {
		window.history.replaceState(null, "", "/acquisition/settings?tab=configuration");
		render(<AcquisitionSettingsPage />);

		expect(screen.getByRole("tab", { name: "Environments" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("switches to SDK and Localization tabs", async () => {
		render(<AcquisitionSettingsPage />);

		const sdkTab = screen.getByRole("tab", { name: "SDK" });
		await userEvent.click(sdkTab);

		await waitFor(() => {
			expect(screen.getByText("Runtime selection")).toBeInTheDocument();
		});

		const locTab = screen.getByRole("tab", { name: "Localization" });
		await userEvent.click(locTab);

		await waitFor(() => {
			expect(screen.getByRole("combobox", { name: "Language groups" })).toBeInTheDocument();
		});
	});

	it("chooses the SDK platform with a field instead of a second row of tabs", async () => {
		const user = userEvent.setup();
		render(<AcquisitionSettingsPage defaultTab="sdk" />);
		expect(
			await screen.findByText("npm install @superboard/flows-js @superboard/flows-js-components"),
		).toBeInTheDocument();
		expect(screen.getAllByRole("tablist")).toHaveLength(1);
		await user.click(screen.getByRole("combobox", { name: /^Platform/ }));
		await user.click(await screen.findByRole("option", { name: "Flutter" }));
		expect(await screen.findByText("flutter pub add superboard_flows")).toBeInTheDocument();
		expect(
			screen.queryByText("npm install @superboard/flows-js @superboard/flows-js-components"),
		).not.toBeInTheDocument();
	});

	it("switches language groups from the toolbar without a side list", async () => {
		const user = userEvent.setup();
		mockFlowsApi.listLocalization.mockResolvedValue([
			{
				id: "loc-1",
				name: "Global",
				default_locale: "en",
				locales: ["en", "fr"],
				fallbacks: { fr: "en" },
			},
			{
				id: "loc-2",
				name: "Iberia",
				default_locale: "es",
				locales: ["es", "pt"],
				fallbacks: { pt: "es" },
			},
		]);
		render(<AcquisitionSettingsPage defaultTab="localization" />);
		expect(await screen.findByDisplayValue("Global")).toBeInTheDocument();
		await user.click(screen.getByRole("combobox", { name: "Language groups" }));
		await user.click(await screen.findByRole("option", { name: "Iberia" }));
		expect(screen.getByDisplayValue("Iberia")).toBeInTheDocument();
		expect(screen.getByDisplayValue("es, pt")).toBeInTheDocument();
		expect(screen.getByDisplayValue("pt:es")).toBeInTheDocument();
	});

	it("renders settings in French", async () => {
		render(
			<FrontContextProvider
				value={{
					instanceId: "1",
					pluginId: "superboard-flows",
					path: "/acquisition/settings",
					parameters: {},
					locale: "fr",
					operator: null,
					projectScope: null,
					activePluginIds: ["superboard-flows"],
				}}
			>
				<AcquisitionSettingsPage />
			</FrontContextProvider>,
		);

		expect(screen.getByText("Paramètres d’acquisition")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Environnements" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "SDK" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Localisation" })).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Ouvrir dans Plugins" })).toBeInTheDocument();
	});

	it("renders standalone Environments, Localization, and Sdk settings pages", () => {
		const { unmount: u1 } = render(<EnvironmentsSettingsPage />);
		expect(screen.getByRole("tab", { name: "Environments" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		u1();

		const { unmount: u2 } = render(<LocalizationSettingsPage />);
		expect(screen.getByRole("tab", { name: "Localization" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		u2();

		const { unmount: u3 } = render(<SdkSettingsPage />);
		expect(screen.getByRole("tab", { name: "SDK" })).toHaveAttribute("aria-selected", "true");
		u3();
	});
});
