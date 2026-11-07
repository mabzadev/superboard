import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, waitFor, within } from "../../../packages/supbrd-front-ui/render.js";

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
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
		window.history.replaceState(null, "", "/acquisition/settings");
		mockFlowsApi.listEnvironments.mockResolvedValue([
			{
				id: "env-1",
				name: "Production",
				key: "production",
				kind: "production",
				active: 1,
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

		expect(
			await screen.findByRole("heading", { level: 3, name: "Production" }),
		).toBeInTheDocument();
		expect(screen.getByText("Published versions only")).toBeInTheDocument();
	});

	it("shows the raw project and environment identifiers in the SDK tab", async () => {
		render(<AcquisitionSettingsPage defaultTab="sdk" />);
		expect(await screen.findByText("Environment identifier")).toBeInTheDocument();
		expect(screen.getByText("production", { selector: "code" })).toBeInTheDocument();
		expect(screen.getByText("test-project", { selector: "code" })).toBeInTheDocument();
	});

	it("rotates an SDK key only after confirmation and shows the new key", async () => {
		const user = userEvent.setup();
		mockFlowsApi.rotateEnvironmentKey.mockResolvedValue({ id: "env-1", sdk_key: "sk_new_123" });
		render(<AcquisitionSettingsPage />);
		await user.click(await screen.findByRole("button", { name: "Rotate SDK key" }));
		expect(mockFlowsApi.rotateEnvironmentKey).not.toHaveBeenCalled();
		const confirmation = await screen.findByRole("alertdialog");
		await user.click(within(confirmation).getByRole("button", { name: "Rotate SDK key" }));
		await waitFor(() =>
			expect(mockFlowsApi.rotateEnvironmentKey).toHaveBeenCalledWith("test-project", "env-1"),
		);
		expect(await screen.findByText("sk_new_123")).toBeInTheDocument();
	});

	it("offers draft releases only while creating a development environment", async () => {
		const user = userEvent.setup();
		render(<AcquisitionSettingsPage />);
		await user.click(screen.getByRole("button", { name: "New environment" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("switch", { name: "Allow draft releases" })).toBeChecked();
		await user.click(within(dialog).getByRole("combobox", { name: "Kind" }));
		await user.click(await screen.findByRole("option", { name: "Production" }));
		expect(
			within(dialog).queryByRole("switch", { name: "Allow draft releases" }),
		).not.toBeInTheDocument();
	});

	it("saves an edited language group automatically and never saves the loaded values back", async () => {
		const user = userEvent.setup();
		mockFlowsApi.saveLocalization.mockImplementation(
			async (_project: string, body: Record<string, unknown>) => body,
		);
		render(<AcquisitionSettingsPage defaultTab="localization" />);
		const name = await screen.findByDisplayValue("Global");
		expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
		await new Promise((resolve) => {
			setTimeout(resolve, 800);
		});
		expect(mockFlowsApi.saveLocalization).not.toHaveBeenCalled();
		await user.type(name, " EU");
		await waitFor(
			() =>
				expect(mockFlowsApi.saveLocalization).toHaveBeenCalledWith("test-project", {
					id: "loc-1",
					name: "Global EU",
					default_locale: "en",
					locales: ["en", "fr"],
					fallbacks: { fr: "en" },
				}),
			{ timeout: 3000 },
		);
		expect(mockFlowsApi.saveLocalization).toHaveBeenCalledTimes(1);
		expect(await screen.findByText("All changes saved.")).toBeInTheDocument();
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
