import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import MonetizationSettingsPage from "../../../../../packages/plugins/superboard-monetization/src/front/MonetizationSettingsPage.js";
import { fireEvent, render, screen, within } from "../../../packages/supbrd-front-ui/render.js";

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

	it("opens legacy Products settings links on the General tab without reading product settings", async () => {
		const request = vi.fn(async () => Response.json({ data: { values: {}, secretsSet: {} } }));
		vi.stubGlobal("fetch", request);
		window.history.replaceState(null, "", "/monetization/settings?tab=products");
		render(<MonetizationSettingsPage />);

		expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByRole("checkbox", { name: "Enable purchases" })).toBeVisible();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"General",
			"Gateways",
		]);
		for (const label of ["Default Currency", "Store environment", "Catalog synchronization"])
			expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
		expect(request).not.toHaveBeenCalledWith(
			expect.stringContaining("/plugins/superboard-monetization/settings"),
			expect.anything(),
		);
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
