import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import MonetizationSettingsPage from "../../../../../packages/plugins/superboard-monetization/src/front/MonetizationSettingsPage.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

const billing = vi.hoisted(() => ({
	getBillingOverview: vi.fn(),
	updateBillingSettings: vi.fn(),
	getStripeConnection: vi.fn(),
}));
vi.mock(
	"../../../../../packages/plugins/superboard-monetization/src/front/billing/api/billing/billingService.js",
	() => billing,
);

vi.mock("@superboard/front-ui/section-navigation.js", () => ({
	SectionNavigation: () => <div data-testid="section-nav" />,
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
		billing.getStripeConnection.mockResolvedValue({
			configured: false,
			environment: "sandbox",
			application_origin: "",
			last_tested_at: null,
			webhook_path: "/stripe/sandbox/1",
		});
		billing.getBillingOverview.mockResolvedValue({
			settings: { purchases_enabled: 0, restore_behavior: "block" },
			credentials: { ios: { configured: false }, android: { configured: false } },
		});
	});

	it("shows and saves product settings under the keys returned by the Monetization settings endpoint", async () => {
		const prefix = "superboard-monetization.setting.products_";
		let stored: Record<string, unknown> = {
			[`${prefix}default_currency`]: "EUR",
			[`${prefix}store_environment`]: "sandbox",
			[`${prefix}catalog_sync_enabled`]: false,
		};
		let submitted: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url, options) => {
				if (options?.method === "PUT") {
					submitted = JSON.parse(options.body).values;
					stored = { ...stored, ...submitted };
				}
				return Response.json({
					data: {
						values: stored,
						secretsSet: { "superboard-monetization.setting.billing_apple_private_key": false },
					},
				});
			}),
		);
		window.history.replaceState(null, "", "/monetization/settings?tab=products");
		render(<MonetizationSettingsPage />);

		const currency = await screen.findByLabelText("Default Currency");
		await waitFor(() => {
			expect(currency).toHaveValue("EUR");
		});
		expect(screen.getByLabelText("Store environment")).toHaveValue("sandbox");
		expect(screen.getByLabelText("Catalog synchronization")).toHaveValue("false");

		fireEvent.change(currency, { target: { value: "CHF" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
		expect(submitted).toEqual({ [`${prefix}default_currency`]: "CHF" });
		expect(screen.queryByRole("alert")).not.toBeInTheDocument();
		expect(currency).toHaveValue("CHF");
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
		expect(screen.queryByRole("tab", { name: "Configuration" })).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Open in Plugins" })).toHaveAttribute(
			"href",
			expect.stringMatching(/^\/_emdash\/admin\/plugins-manager\/[^/]+\/configuration$/),
		);

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
		expect(await screen.findByText(/Not configured.*Sandbox/)).toBeInTheDocument();
		expect(screen.getByText("Apple App Store")).toBeInTheDocument();
	});

	it("leaves store credentials to the application settings instead of unused fields", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: { values: {}, secretsSet: {} } })),
		);
		render(<MonetizationSettingsPage />);

		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });

		expect(await screen.findByText("Connected Gateways")).toBeInTheDocument();
		expect(screen.getAllByRole("link", { name: "Configure store" })).toHaveLength(2);
		expect(screen.queryByText("Advanced")).not.toBeInTheDocument();
		for (const label of [
			"Apple issuer ID",
			"Apple key ID",
			"Apple private key",
			"Google service account JSON",
		])
			expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
	});

	it("asks for the Stripe secret key and webhook signing secret only in the Stripe section", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ data: { values: {}, secretsSet: {} } })),
		);
		render(<MonetizationSettingsPage />);

		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });

		const stripe = (await screen.findByText("Stripe web payments")).closest("section");
		if (!stripe) throw new Error("Stripe section missing");
		for (const label of ["Stripe secret key", "Webhook signing secret"]) {
			const fields = await within(stripe).findAllByLabelText(label);
			expect(screen.getAllByLabelText(label)).toEqual(fields);
			expect(fields).toHaveLength(1);
		}
	});

	it("opens legacy configuration links on the gateways tab", async () => {
		window.history.replaceState(null, "", "/monetization/settings?tab=configuration");
		render(<MonetizationSettingsPage />);

		expect(screen.getByRole("tab", { name: "Gateways" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByText("Connected Gateways")).toBeVisible();
	});
});
