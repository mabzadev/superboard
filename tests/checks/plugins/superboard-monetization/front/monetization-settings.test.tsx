import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import MonetizationSettingsPage from "../../../../../packages/plugins/superboard-monetization/src/front/MonetizationSettingsPage.js";
import { fireEvent, render, screen, waitFor } from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

const billing = vi.hoisted(() => ({
	getBillingOverview: vi.fn(),
	updateBillingSettings: vi.fn(),
}));
vi.mock(
	"../../../../../packages/plugins/superboard-monetization/src/front/billing/api/billing/billingService.js",
	() => billing,
);

vi.mock("@superboard/front-ui/section-navigation.js", () => ({
	SectionNavigation: () => <div data-testid="section-nav" />,
}));

vi.mock("@superboard/front-ui/plugin-configuration-tab", () => ({
	PluginConfigurationTab: () => <div data-testid="plugin-config-tab">Plugin configuration</div>,
}));

describe("MonetizationSettingsPage", () => {
	it("opens a linked products settings tab", async () => {
		window.history.replaceState(null, "", "/monetization/settings?tab=products");
		render(<MonetizationSettingsPage />);
		expect(screen.getByRole("tab", { name: "Products" })).toHaveAttribute("aria-selected", "true");
	});

	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		billing.getBillingOverview.mockResolvedValue({
			settings: { purchases_enabled: 0, restore_behavior: "block" },
			credentials: { ios: { configured: false }, android: { configured: false } },
		});
	});

	it("keeps a multiline secret draft across tabs and clears it after saving", async () => {
		const key = "supbrd-plugmod-billing__apple_private_key";
		const pem = "-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----";
		let submitted: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url, options) => {
				if (options?.method === "PUT") submitted = JSON.parse(options.body).values;
				return Response.json({ data: { values: {}, secretsSet: { [key]: Boolean(submitted) } } });
			}),
		);
		render(<MonetizationSettingsPage />);
		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });
		const secret = await screen.findByLabelText("Apple private key");
		fireEvent.change(secret, { target: { value: pem } });
		fireEvent.keyDown(screen.getByRole("tab", { name: "Products" }), { key: "Enter" });
		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });
		expect(screen.getByLabelText("Apple private key")).toHaveValue(pem);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await screen.findByText("Settings saved.");
		expect(submitted).toEqual({ [key]: pem });
		expect(screen.getByLabelText("Apple private key")).toHaveValue("");
	});

	it("loads persisted billing settings and reports a rejected save without discarding the draft", async () => {
		billing.getBillingOverview.mockResolvedValue({
			settings: { purchases_enabled: 0, restore_behavior: "block" },
			credentials: { ios: { configured: false }, android: { configured: false } },
		});
		billing.updateBillingSettings.mockRejectedValue(new Error("Service unavailable"));
		render(<MonetizationSettingsPage />);
		const enabled = await screen.findByRole("checkbox", { name: "Enable purchases" });
		expect(enabled).not.toBeChecked();
		fireEvent.click(enabled);
		fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
		expect(await screen.findByRole("alert")).toHaveTextContent("Could not save billing settings.");
		expect(enabled).toBeChecked();
		expect(screen.queryByText("Settings saved.")).not.toBeInTheDocument();
	});

	afterEach(() => {
		window.history.replaceState(null, "", "/");
		vi.unstubAllGlobals();
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("renders Monetization Settings with general tab by default", async () => {
		render(<MonetizationSettingsPage />);

		expect(screen.getByText("Monetization Settings")).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "General" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Gateways" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Configuration" })).toBeInTheDocument();

		expect(await screen.findByRole("checkbox", { name: "Enable purchases" })).not.toBeChecked();
		expect(screen.queryByText("Automatic (Stripe Tax)")).not.toBeInTheDocument();
	});

	it("switches to gateways tab", async () => {
		render(<MonetizationSettingsPage />);

		const gatewaysBtn = screen.getByRole("tab", { name: "Gateways" });
		fireEvent.keyDown(gatewaysBtn, { key: "Enter" });

		expect(await screen.findByText("Connected Gateways")).toBeInTheDocument();
		expect(screen.queryByText("Stripe Payments")).not.toBeInTheDocument();
		expect(screen.getAllByText("Not configured")).toHaveLength(2);
		expect(screen.getByText("Apple App Store")).toBeInTheDocument();
	});

	it("switches to configuration tab and opens the active View configuration", async () => {
		render(<MonetizationSettingsPage />);

		const configBtn = screen.getByRole("tab", { name: "Configuration" });
		fireEvent.keyDown(configBtn, { key: "Enter" });

		await waitFor(() => {
			expect(screen.getByTestId("plugin-config-tab")).toBeInTheDocument();
		});
		expect(screen.getByText("Plugin configuration")).toBeInTheDocument();
	});
});
