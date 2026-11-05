import type { ReactNode } from "react";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import MonetizationSettingsPage from "../../../../../packages/plugins/superboard-monetization/src/front/MonetizationSettingsPage.js";
import {
	FrontContextProvider,
	useOptionalFrontContext,
} from "../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../packages/supbrd-front-ui/render.js";

function French({ children }: { children: ReactNode }) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider value={{ ...context, locale: "fr" }}>{children}</FrontContextProvider>
	);
}

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

const billing = vi.hoisted(() => ({
	getBillingOverview: vi.fn(),
	updateBillingSettings: vi.fn(),
	getStripeConnection: vi.fn(),
	getDisplayCurrency: vi.fn(),
	updateDisplayCurrency: vi.fn(),
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
		billing.getDisplayCurrency.mockResolvedValue({
			display_currency: "USD",
			available_currencies: ["USD", "EUR"],
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

	it("offers the three restore behaviors and reads the legacy blocking setting as keeping the original App User ID", async () => {
		billing.updateBillingSettings.mockResolvedValue({});
		render(<MonetizationSettingsPage />);

		const keep = await screen.findByRole("radio", { name: "Keep with original App User ID" });
		const transfer = screen.getByRole("radio", { name: "Transfer to new App User ID" });
		const conditional = screen.getByRole("radio", {
			name: "Transfer if there are no active subscriptions",
		});
		expect(screen.getAllByRole("radio")).toEqual([transfer, conditional, keep]);
		expect(keep).toBeChecked();
		expect(screen.getByRole("radiogroup", { name: "Restore behavior" })).toBeVisible();
		expect(transfer).toHaveAccessibleDescription(/only one customer has access at a time/u);
		expect(transfer).toHaveAccessibleDescription(/anonymous App User ID .* merged/u);
		expect(conditional).toHaveAccessibleDescription(/no active subscription/u);
		expect(keep).toHaveAccessibleDescription(/^Use with caution\..*account before purchasing/u);
		expect(screen.queryByText("Block purchase transfers between users")).not.toBeInTheDocument();

		billing.getBillingOverview.mockResolvedValue({
			settings: { purchases_enabled: 0, restore_behavior: "transfer_if_no_active_subscriptions" },
			credentials: { ios: { configured: false }, android: { configured: false } },
		});
		fireEvent.click(conditional);
		fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

		expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledWith("1-test", {
			purchases_enabled: false,
			restore_behavior: "transfer_if_no_active_subscriptions",
		});
		expect(conditional).toBeChecked();
	});

	it("selects the RevenueCat default when no supported restore behavior is stored", async () => {
		billing.getBillingOverview.mockResolvedValue({
			settings: { purchases_enabled: 1, restore_behavior: "share_between_ids" },
			credentials: { ios: { configured: false }, android: { configured: false } },
		});
		render(<MonetizationSettingsPage />);

		expect(await screen.findByRole("radio", { name: "Transfer to new App User ID" })).toBeChecked();
		expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
	});

	it("describes the restore behaviors in French", async () => {
		render(<MonetizationSettingsPage />, { wrapper: French });

		expect(
			await screen.findByRole("radiogroup", { name: "Comportement de restauration" }),
		).toBeVisible();
		const transfer = screen.getByRole("radio", { name: "Transférer au nouvel identifiant" });
		const conditional = screen.getByRole("radio", {
			name: "Transférer s’il n’y a pas d’abonnement actif",
		});
		const keep = screen.getByRole("radio", { name: "Garder l’identifiant d’origine" });
		expect(keep).toBeChecked();
		expect(transfer).toHaveAccessibleDescription(/un seul client y a accès à la fois/u);
		expect(conditional).toHaveAccessibleDescription(/aucun abonnement actif/u);
		expect(keep).toHaveAccessibleDescription(/^À utiliser avec prudence\./u);
		for (const english of ["Transfer to new App User ID", "Restore behavior", "Use with caution"])
			expect(screen.queryByText(english, { exact: false })).not.toBeInTheDocument();
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

	it("saves the display currency of the project from the General tab", async () => {
		billing.updateDisplayCurrency.mockResolvedValue({
			display_currency: "EUR",
			available_currencies: ["USD", "EUR"],
		});
		window.history.replaceState(null, "", "/monetization/settings");
		render(<MonetizationSettingsPage />);

		const select = await screen.findByRole("combobox", { name: "Display currency" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual(["US dollar (USD)", "Euro (EUR)"]);
		fireEvent.change(select, { target: { value: "EUR" } });

		expect(await screen.findByText("Display currency saved.")).toBeInTheDocument();
		expect(billing.updateDisplayCurrency).toHaveBeenCalledWith("1-test", "EUR");
		expect(select).toHaveValue("EUR");
	});

	it("restores the previous display currency when saving fails, in French", async () => {
		billing.updateDisplayCurrency.mockRejectedValue(new Error("Forbidden"));
		window.history.replaceState(null, "", "/monetization/settings?lang=fr");
		render(<MonetizationSettingsPage />, { wrapper: French });

		const select = await screen.findByRole("combobox", { name: "Devise d’affichage" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(
			screen.getByText(/convertis en USD au taux de référence de la BCE du jour de chaque achat/u),
		).toBeInTheDocument();
		fireEvent.change(select, { target: { value: "EUR" } });

		expect(
			await screen.findByText("Impossible d’enregistrer la devise d’affichage."),
		).toBeInTheDocument();
		expect(select).toHaveValue("USD");
		expect(
			within(select).getByRole("option", { name: "Dollar américain (USD)" }),
		).toBeInTheDocument();
	});

	it("opens legacy configuration links on the gateways tab", async () => {
		window.history.replaceState(null, "", "/monetization/settings?tab=configuration");
		render(<MonetizationSettingsPage />);

		expect(screen.getByRole("tab", { name: "Gateways" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByText("Connected Gateways")).toBeVisible();
	});
});
