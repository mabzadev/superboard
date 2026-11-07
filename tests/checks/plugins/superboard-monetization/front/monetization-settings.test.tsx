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

function WithoutAuthentication({ children }: { children: ReactNode }) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider
			value={{
				...context,
				activePluginIds: context.activePluginIds.filter((id) => id !== "superboard-user"),
			}}
		>
			{children}
		</FrontContextProvider>
	);
}

const displayCurrencies = [
	"USD",
	"EUR",
	"GBP",
	"AUD",
	"CAD",
	"JPY",
	"BRL",
	"KRW",
	"CNY",
	"MXN",
	"SEK",
	"PLN",
];

const autosaved = { timeout: 3000 };

function overview(
	settings: {
		purchases_enabled: number;
		restore_behavior: string;
		sandbox_restore_behavior?: string | null;
	},
	credentials = { ios: { configured: false }, android: { configured: false } },
) {
	return { settings, credentials };
}

const configuredStripe = {
	configured: true,
	environment: "sandbox",
	application_origin: "https://app.example.test",
	last_tested_at: null,
	webhook_path: "/stripe/sandbox/1",
};

function settled() {
	return new Promise((resolve) => {
		setTimeout(resolve, 900);
	});
}

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "1-test" } }),
}));

const billing = vi.hoisted(() => ({
	getBillingOverview: vi.fn(),
	updateBillingSettings: vi.fn(),
	testBillingCredentials: vi.fn(),
	getStripeConnection: vi.fn(),
	saveStripeConnection: vi.fn(),
	testStripeConnection: vi.fn(),
	getOperatorDisplayCurrency: vi.fn(),
	updateOperatorDisplayCurrency: vi.fn(),
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
		if (!("PointerEvent" in window))
			Object.defineProperty(window, "PointerEvent", { value: MouseEvent, configurable: true });
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
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 0, restore_behavior: "block" }),
		);
		billing.getOperatorDisplayCurrency.mockResolvedValue({
			display_currency: "USD",
			available_currencies: displayCurrencies,
		});
	});

	it("opens legacy Products settings links on the General tab", async () => {
		window.history.replaceState(null, "", "/monetization/settings?tab=products");
		render(<MonetizationSettingsPage />);

		expect(screen.getByRole("tab", { name: "General" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByRole("switch", { name: "Enable purchases" })).toBeVisible();
		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
			"General",
			"Gateways",
		]);
	});

	it("keeps the restore behavior hidden until purchases are enabled", async () => {
		billing.updateBillingSettings.mockResolvedValue({});
		render(<MonetizationSettingsPage />);

		const enabled = await screen.findByRole("switch", { name: "Enable purchases" });
		expect(enabled).not.toBeChecked();
		expect(screen.queryByRole("radiogroup", { name: "Restore behavior" })).not.toBeInTheDocument();
		expect(
			screen.queryByRole("switch", { name: "Use a different restore behavior for sandbox" }),
		).not.toBeInTheDocument();

		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "block" }),
		);
		fireEvent.click(enabled);

		expect(screen.getByRole("radiogroup", { name: "Restore behavior" })).toBeVisible();
		expect(screen.getByRole("radio", { name: "Keep with original App User ID" })).toBeChecked();
		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledWith("1-test", {
			purchases_enabled: true,
			restore_behavior: "block",
		});
	});

	it("reports a rejected automatic save without discarding the change, then saves it on retry", async () => {
		billing.updateBillingSettings.mockRejectedValueOnce(new Error("Service unavailable"));
		render(<MonetizationSettingsPage />);
		const enabled = await screen.findByRole("switch", { name: "Enable purchases" });
		expect(enabled).not.toBeChecked();
		fireEvent.click(enabled);

		expect(await screen.findByRole("alert", {}, autosaved)).toHaveTextContent(
			"Changes could not be saved.",
		);
		expect(enabled).toBeChecked();
		expect(screen.queryByText("All changes saved.")).not.toBeInTheDocument();
		await settled();
		expect(billing.updateBillingSettings).toHaveBeenCalledTimes(1);

		billing.updateBillingSettings.mockResolvedValue({});
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "block" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));

		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledTimes(2);
		expect(enabled).toBeChecked();
	});

	it("reports a change the service did not keep as not saved", async () => {
		billing.updateBillingSettings.mockResolvedValue({});
		render(<MonetizationSettingsPage />);
		fireEvent.click(await screen.findByRole("switch", { name: "Enable purchases" }));

		expect(await screen.findByRole("alert", {}, autosaved)).toHaveTextContent(
			"Changes could not be saved.",
		);
		expect(screen.queryByText("All changes saved.")).not.toBeInTheDocument();
	});

	it("offers the three restore behaviors and saves the chosen one without a save button", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "block" }),
		);
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
		expect(screen.queryByRole("button", { name: /save/iu })).not.toBeInTheDocument();

		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "transfer_if_no_active_subscriptions" }),
		);
		fireEvent.click(conditional);

		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledTimes(1);
		expect(billing.updateBillingSettings).toHaveBeenCalledWith("1-test", {
			purchases_enabled: true,
			restore_behavior: "transfer_if_no_active_subscriptions",
		});
		expect(conditional).toBeChecked();
	});

	it("selects the RevenueCat default when no supported restore behavior is stored, without saving it", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "share_between_ids" }),
		);
		render(<MonetizationSettingsPage />);

		expect(await screen.findByRole("radio", { name: "Transfer to new App User ID" })).toBeChecked();
		await settled();
		expect(billing.updateBillingSettings).not.toHaveBeenCalled();
	});

	it("describes the restore behaviors in French", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "block" }),
		);
		render(<MonetizationSettingsPage />, { wrapper: French });

		expect(
			await screen.findByRole("radiogroup", { name: "Comportement de restauration" }),
		).toBeVisible();
		expect(screen.getByRole("switch", { name: "Activer les achats" })).toBeChecked();
		const transfer = screen.getByRole("radio", { name: "Transférer au nouvel identifiant" });
		const conditional = screen.getByRole("radio", {
			name: "Transférer s’il n’y a pas d’abonnement actif",
		});
		const keep = screen.getByRole("radio", { name: "Garder l’identifiant d’origine" });
		expect(keep).toBeChecked();
		expect(transfer).toHaveAccessibleDescription(/un seul client y a accès à la fois/u);
		expect(conditional).toHaveAccessibleDescription(/aucun abonnement actif/u);
		expect(keep).toHaveAccessibleDescription(/^À utiliser avec prudence\./u);
		for (const english of [
			"Transfer to new App User ID",
			"Restore behavior",
			"Use with caution",
			"Purchases",
			"Let your apps sell products",
		])
			expect(screen.queryByText(english, { exact: false })).not.toBeInTheDocument();
	});

	it("applies a different restore behavior to sandbox purchases when asked", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview({ purchases_enabled: 1, restore_behavior: "block" }),
		);
		billing.updateBillingSettings.mockResolvedValue({});
		render(<MonetizationSettingsPage />);

		const different = await screen.findByRole("switch", {
			name: "Use a different restore behavior for sandbox",
		});
		expect(different).not.toBeChecked();
		expect(
			screen.queryByRole("combobox", { name: "Sandbox restore behavior" }),
		).not.toBeInTheDocument();
		fireEvent.click(different);
		const sandbox = screen.getByRole("combobox", { name: "Sandbox restore behavior" });
		expect(sandbox).toHaveValue("block");
		expect(
			within(sandbox)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Transfer to new App User ID",
			"Transfer if there are no active subscriptions",
			"Keep with original App User ID",
		]);
		fireEvent.change(sandbox, { target: { value: "transfer" } });

		billing.getBillingOverview.mockResolvedValue(
			overview({
				purchases_enabled: 1,
				restore_behavior: "block",
				sandbox_restore_behavior: "transfer",
			}),
		);

		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledTimes(1);
		expect(billing.updateBillingSettings).toHaveBeenCalledWith("1-test", {
			purchases_enabled: true,
			restore_behavior: "block",
			sandbox_restore_behavior: "transfer",
		});
	});

	it("shows and clears a stored sandbox restore behavior, in French", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview({
				purchases_enabled: 1,
				restore_behavior: "transfer",
				sandbox_restore_behavior: "transfer_if_no_active_subscriptions",
			}),
		);
		billing.updateBillingSettings.mockResolvedValue({});
		render(<MonetizationSettingsPage />, { wrapper: French });

		const different = await screen.findByRole("switch", {
			name: "Utiliser un autre comportement pour le bac à sable",
		});
		expect(different).toBeChecked();
		const sandbox = screen.getByRole("combobox", {
			name: "Comportement de restauration du bac à sable",
		});
		expect(sandbox).toHaveValue("transfer_if_no_active_subscriptions");
		expect(sandbox).toHaveAccessibleDescription(/achats du bac à sable/u);

		billing.getBillingOverview.mockResolvedValue(
			overview({
				purchases_enabled: 1,
				restore_behavior: "transfer",
				sandbox_restore_behavior: null,
			}),
		);
		fireEvent.click(different);

		expect(
			screen.queryByRole("combobox", { name: "Comportement de restauration du bac à sable" }),
		).not.toBeInTheDocument();
		expect(
			await screen.findByText("Modifications enregistrées.", {}, autosaved),
		).toBeInTheDocument();
		expect(billing.updateBillingSettings).toHaveBeenCalledWith("1-test", {
			purchases_enabled: true,
			restore_behavior: "transfer",
			sandbox_restore_behavior: null,
		});
	});

	afterEach(() => {
		window.history.replaceState(null, "", "/");
		vi.unstubAllGlobals();
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
		for (const mock of Object.values(billing)) mock.mockReset();
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

		expect(await screen.findByRole("switch", { name: "Enable purchases" })).not.toBeChecked();
		expect(screen.queryByText("Automatic (Stripe Tax)")).not.toBeInTheDocument();
	});

	it("switches to gateways tab and shows each gateway's state", async () => {
		render(<MonetizationSettingsPage />);

		const gatewaysBtn = screen.getByRole("tab", { name: "Gateways" });
		fireEvent.keyDown(gatewaysBtn, { key: "Enter" });

		expect(await screen.findByText("Connected Gateways")).toBeInTheDocument();
		expect(screen.queryByText("Stripe Payments")).not.toBeInTheDocument();
		const stores = screen.getByText("Connected Gateways").closest("section");
		if (!stores) throw new Error("Store gateways section missing");
		expect(within(stores).getAllByText("Not configured")).toHaveLength(2);
		expect(within(stores).getByText("Apple App Store")).toBeInTheDocument();
		const stripe = (await screen.findByText("Stripe web payments")).closest("section");
		if (!stripe) throw new Error("Stripe section missing");
		expect(await within(stripe).findByText("Not configured")).toBeInTheDocument();
		expect(within(stripe).getByText("Sandbox")).toBeInTheDocument();
		expect(within(stripe).getByRole("button", { name: "Test connection" })).toBeDisabled();
	});

	it("only lets the operator test a store whose credentials are configured", async () => {
		billing.getBillingOverview.mockResolvedValue(
			overview(
				{ purchases_enabled: 1, restore_behavior: "transfer" },
				{ ios: { configured: true }, android: { configured: false } },
			),
		);
		billing.testBillingCredentials.mockResolvedValue({});
		render(<MonetizationSettingsPage />);
		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });

		const stores = (await screen.findByText("Connected Gateways")).closest("section");
		if (!stores) throw new Error("Store gateways section missing");
		const apple = (await within(stores).findByText("Apple App Store")).parentElement?.parentElement;
		const google = within(stores).getByText("Google Play Billing").parentElement?.parentElement;
		if (!apple || !google) throw new Error("Store rows missing");
		expect(within(apple).getByText("Configured")).toBeInTheDocument();
		expect(within(google).getByRole("button", { name: "Test connection" })).toBeDisabled();
		fireEvent.click(within(apple).getByRole("button", { name: "Test connection" }));

		expect(await within(apple).findByRole("status")).toHaveTextContent(
			"Store connection verified.",
		);
		expect(billing.testBillingCredentials).toHaveBeenCalledWith("1-test", "ios");
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
		for (const label of [
			"Apple issuer ID",
			"Apple key ID",
			"Apple private key",
			"Google service account JSON",
		])
			expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
	});

	it("shows the Stripe webhook endpoint in the last, Advanced section", async () => {
		render(<MonetizationSettingsPage />, { wrapper: French });

		fireEvent.keyDown(screen.getByRole("tab", { name: "Passerelles" }), { key: "Enter" });

		const advanced = (await screen.findByRole("heading", { name: "Avancé" })).closest("section");
		if (!advanced) throw new Error("Advanced section missing");
		expect(within(advanced).getByText("/stripe/sandbox/1")).toBeInTheDocument();
		expect(within(advanced).getByText("Adresse de notification Stripe")).toBeInTheDocument();
		const sections = screen
			.getAllByRole("heading", { level: 2 })
			.map((heading) => heading.textContent);
		expect(sections.at(-1)).toBe("Avancé");
		const stripe = screen.getByText("Paiements web Stripe").closest("section");
		if (!stripe) throw new Error("Stripe section missing");
		expect(within(stripe).queryByText("/stripe/sandbox/1")).not.toBeInTheDocument();
	});

	it("saves a new Stripe origin automatically without resending the secrets", async () => {
		billing.getStripeConnection.mockResolvedValue(configuredStripe);
		billing.saveStripeConnection.mockResolvedValue({});
		render(<MonetizationSettingsPage />);
		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });

		const origin = await screen.findByRole("textbox", { name: "Application origin" });
		expect(origin).toHaveValue("https://app.example.test");
		await settled();
		expect(billing.saveStripeConnection).not.toHaveBeenCalled();

		fireEvent.change(origin, { target: { value: "shop" } });
		expect(origin).toHaveAccessibleDescription(
			"Enter an HTTPS address, for example https://example.com.",
		);
		await settled();
		expect(billing.saveStripeConnection).not.toHaveBeenCalled();

		fireEvent.change(origin, { target: { value: "https://shop.example.test" } });
		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.saveStripeConnection).toHaveBeenCalledTimes(1);
		expect(billing.saveStripeConnection.mock.calls[0]).toEqual([
			"1-test",
			{ application_origin: "https://shop.example.test" },
		]);
		expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
	});

	it("replaces only the secrets the operator typed, with an explicit action, in French", async () => {
		billing.getStripeConnection.mockResolvedValue(configuredStripe);
		billing.saveStripeConnection.mockResolvedValue({});
		render(<MonetizationSettingsPage />, { wrapper: French });
		fireEvent.keyDown(screen.getByRole("tab", { name: "Passerelles" }), { key: "Enter" });

		const replace = await screen.findByRole("button", { name: "Remplacer les secrets" });
		expect(replace).toBeDisabled();
		const key = screen.getByLabelText("Clé secrète Stripe");
		const signing = screen.getByLabelText("Secret de signature des webhooks");
		for (const field of [key, signing]) {
			expect(field).not.toBeRequired();
			expect(field).toHaveAccessibleDescription("Laissez vide pour conserver le secret actuel.");
		}
		fireEvent.change(signing, { target: { value: "whsec_rotated" } });
		fireEvent.click(replace);

		expect(await screen.findByText("Secrets remplacés.")).toBeInTheDocument();
		expect(billing.saveStripeConnection.mock.calls[0]).toEqual([
			"1-test",
			{ webhook_secret: "whsec_rotated", application_origin: "https://app.example.test" },
		]);
		expect(signing).toHaveValue("");
	});

	it("asks for the origin and both secrets before connecting Stripe the first time", async () => {
		billing.saveStripeConnection.mockResolvedValue({});
		render(<MonetizationSettingsPage />);
		fireEvent.keyDown(screen.getByRole("tab", { name: "Gateways" }), { key: "Enter" });

		const connect = await screen.findByRole("button", { name: "Connect Stripe" });
		const origin = screen.getByRole("textbox", { name: "Application origin" });
		const key = screen.getByLabelText("Stripe secret key");
		const signing = screen.getByLabelText("Webhook signing secret");
		for (const field of [origin, key, signing]) expect(field).toBeRequired();
		fireEvent.change(origin, { target: { value: "https://shop.example.test" } });
		await settled();
		expect(billing.saveStripeConnection).not.toHaveBeenCalled();

		fireEvent.change(key, { target: { value: "sk_test_new" } });
		fireEvent.change(signing, { target: { value: "whsec_new" } });
		fireEvent.click(connect);

		await waitFor(() => {
			expect(billing.saveStripeConnection).toHaveBeenCalledWith("1-test", {
				secret_key: "sk_test_new",
				webhook_secret: "whsec_new",
				application_origin: "https://shop.example.test",
			});
		});
	});

	it("shows the full Stripe webhook URL and copies it, in French", async () => {
		const url = "https://sdk.example.com/v1/monetization/webhooks/stripe/sandbox/1";
		billing.getStripeConnection.mockResolvedValue({ ...configuredStripe, webhook_url: url });
		const writeText = vi.fn(async () => undefined);
		Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
		render(<MonetizationSettingsPage />, { wrapper: French });
		fireEvent.keyDown(screen.getByRole("tab", { name: "Passerelles" }), { key: "Enter" });

		const advanced = (await screen.findByRole("heading", { name: "Avancé" })).closest("section");
		if (!advanced) throw new Error("Advanced section missing");
		expect(within(advanced).getByText(url)).toBeInTheDocument();
		expect(within(advanced).queryByText("/stripe/sandbox/1")).not.toBeInTheDocument();
		fireEvent.click(within(advanced).getByRole("button", { name: "Copier l’adresse" }));

		expect(await within(advanced).findByRole("button", { name: "Adresse copiée" })).toBeVisible();
		expect(writeText).toHaveBeenCalledWith(url);
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

	it("leaves the display currency to the operator profile when Authentication is active", async () => {
		window.history.replaceState(null, "", "/monetization/settings");
		render(<MonetizationSettingsPage />);

		expect(await screen.findByRole("switch", { name: "Enable purchases" })).toBeVisible();
		expect(
			screen.queryByRole("combobox", { name: "Your display currency" }),
		).not.toBeInTheDocument();
		expect(billing.getOperatorDisplayCurrency).not.toHaveBeenCalled();
	});

	it("saves the operator's own display currency automatically when there is no operator profile page", async () => {
		billing.updateOperatorDisplayCurrency.mockResolvedValue({
			display_currency: "JPY",
			available_currencies: displayCurrencies,
		});
		window.history.replaceState(null, "", "/monetization/settings");
		render(<MonetizationSettingsPage />, { wrapper: WithoutAuthentication });

		const select = await screen.findByRole("combobox", { name: "Your display currency" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(select).toHaveAccessibleDescription(
			/^Only for you: other operators choose their own\./u,
		);
		expect(
			within(select)
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"US Dollar (USD)",
			"Euro (EUR)",
			"British Pound (GBP)",
			"Australian Dollar (AUD)",
			"Canadian Dollar (CAD)",
			"Japanese Yen (JPY)",
			"Brazilian Real (BRL)",
			"South Korean Won (KRW)",
			"Chinese Yuan (CNY)",
			"Mexican Peso (MXN)",
			"Swedish Krona (SEK)",
			"Polish Zloty (PLN)",
		]);
		await settled();
		expect(billing.updateOperatorDisplayCurrency).not.toHaveBeenCalled();
		fireEvent.change(select, { target: { value: "JPY" } });

		expect(await screen.findByText("All changes saved.", {}, autosaved)).toBeInTheDocument();
		expect(billing.updateOperatorDisplayCurrency).toHaveBeenCalledTimes(1);
		expect(billing.updateOperatorDisplayCurrency).toHaveBeenCalledWith("1-test", "JPY");
		expect(select).toHaveValue("JPY");
	});

	it("keeps the chosen display currency when saving fails and saves it on retry, in French", async () => {
		billing.updateOperatorDisplayCurrency.mockRejectedValueOnce(new Error("Forbidden"));
		window.history.replaceState(null, "", "/monetization/settings?lang=fr");
		render(<MonetizationSettingsPage />, {
			wrapper: ({ children }) => (
				<WithoutAuthentication>
					<French>{children}</French>
				</WithoutAuthentication>
			),
		});

		const select = await screen.findByRole("combobox", { name: "Votre devise d’affichage" });
		await waitFor(() => {
			expect(select).toHaveValue("USD");
		});
		expect(
			screen.getByText(/^Pour vous seul : chaque opérateur choisit la sienne\./u),
		).toBeInTheDocument();
		fireEvent.change(select, { target: { value: "KRW" } });

		expect(await screen.findByRole("alert", {}, autosaved)).toHaveTextContent(
			"Impossible d’enregistrer les modifications.",
		);
		expect(select).toHaveValue("KRW");
		expect(
			within(select).getByRole("option", { name: "Won sud-coréen (KRW)" }),
		).toBeInTheDocument();

		billing.updateOperatorDisplayCurrency.mockResolvedValue({
			display_currency: "KRW",
			available_currencies: displayCurrencies,
		});
		fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

		expect(
			await screen.findByText("Modifications enregistrées.", {}, autosaved),
		).toBeInTheDocument();
		expect(billing.updateOperatorDisplayCurrency).toHaveBeenLastCalledWith("1-test", "KRW");
	});

	it("opens legacy configuration links on the gateways tab", async () => {
		window.history.replaceState(null, "", "/monetization/settings?tab=configuration");
		render(<MonetizationSettingsPage />);

		expect(screen.getByRole("tab", { name: "Gateways" })).toHaveAttribute("aria-selected", "true");
		expect(await screen.findByText("Connected Gateways")).toBeVisible();
	});
});
