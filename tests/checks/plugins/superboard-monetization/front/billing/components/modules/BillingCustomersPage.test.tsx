import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	FrontContextProvider,
	useOptionalFrontContext,
} from "../../../../../../../../packages/supbrd-front-ui/src/context.js";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "../../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	searchBillingCustomers: vi.fn(),
	getBillingOverview: vi.fn(),
	getBillingCustomer: vi.fn(),
	deleteBillingCustomer: vi.fn(),
	setBillingCustomerBlocked: vi.fn(),
	transferBillingCustomerPurchases: vi.fn(),
}));

vi.mock(
	"../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/api/billing/billingService.js",
	() => ({
		searchBillingCustomers: mocks.searchBillingCustomers,
		getBillingOverview: mocks.getBillingOverview,
		getBillingCustomer: mocks.getBillingCustomer,
		deleteBillingCustomer: mocks.deleteBillingCustomer,
		setBillingCustomerBlocked: mocks.setBillingCustomerBlocked,
		grantBillingEntitlement: vi.fn(),
		mergeBillingCustomers: vi.fn(),
		revokeBillingEntitlement: vi.fn(),
		transferBillingCustomerPurchases: mocks.transferBillingCustomerPurchases,
	}),
);
vi.mock(
	"../../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: () => ({ selectedProject: { id: "10-test", name: "Test" } }),
	}),
);

import BillingCustomersPage from "../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/components/modules/BillingCustomersPage.js";

const customer = {
	id: "cus_1",
	project_id: "10-test",
	primary_app_user_id: "app-user-1",
	anonymous: 0,
	blocked: 0,
	attributes: JSON.stringify({ sdk_context: { country: "FR", language: "fr", platform: "ios" } }),
	transaction_count: 3,
	active_subscription_count: 1,
	first_seen_at: "2026-08-01T10:00:00.000Z",
	last_seen_at: "2026-08-10T10:00:00.000Z",
	created_at: "2026-08-01T10:00:00.000Z",
	updated_at: "2026-08-10T10:00:00.000Z",
};

function row(text: string) {
	const element = screen.getByText(text).closest("tr");
	if (!element) throw new Error(`Row missing: ${text}`);
	return element;
}

function fact(label: string) {
	return screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent;
}

function French({ children }: { children: ReactNode }) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider value={{ ...context, locale: "fr" }}>{children}</FrontContextProvider>
	);
}

describe("billing customers page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState({}, "", "/monetization/customers");
		mocks.searchBillingCustomers.mockResolvedValue({ data: [customer], next_cursor: null });
		mocks.getBillingOverview.mockResolvedValue({ entitlements: [] });
		mocks.getBillingCustomer.mockResolvedValue({
			customer,
			aliases: [],
			customer_info: {
				original_app_user_id: "app-user-1",
				aliases: ["alias-1"],
				request_date: "2026-08-10T10:00:00.000Z",
				entitlements: {
					premium: {
						identifier: "premium",
						is_active: true,
						status: "active",
						store: "apple",
						expires_at: "2026-12-01T12:00:00.000Z",
						verification: "verified",
					},
				},
				active_subscriptions: ["premium.monthly"],
				subscriptions: [
					{
						id: "sub-1",
						store_product_id: "premium.yearly",
						store: "google",
						status: "grace_period",
						expires_at: "2026-12-01T12:00:00.000Z",
					},
				],
				balances: { coins: 12 },
				signature: "signed",
				signature_algorithm: "ES256",
				signature_key_id: "key-1",
			},
			transactions: [
				{
					id: "tx-1",
					store: "apple",
					store_transaction_id: "apple-tx-1",
					event_type: "INITIAL_PURCHASE",
					status: "succeeded",
					created_at: "2026-11-01T12:00:00.000Z",
				},
			],
			events: [
				{
					id: "ev-1",
					event_type: "RENEWAL",
					status: "processed",
					store: "apple",
					occurred_at: "2026-11-01 12:00:00",
				},
				{
					id: "ev-2",
					event_type: "SOME_NEW_EVENT",
					status: "awaiting_store",
					store: "amazon",
					occurred_at: "2026-11-01T12:00:00.000Z",
				},
			],
			paywall_events: [
				{
					id: "pw-1",
					event_type: "purchase_started",
					paywall_id: "pw_main",
					placement_identifier: "onboarding",
					occurred_at: "2026-11-01T12:00:00.000Z",
				},
			],
		});
		mocks.deleteBillingCustomer.mockResolvedValue({});
		mocks.setBillingCustomerBlocked.mockResolvedValue({});
	});

	it("lists customers in a single full-width table with an inline search", async () => {
		render(<BillingCustomersPage />);
		const row = (await screen.findByRole("button", { name: "app-user-1" })).closest("tr")!;
		expect(row).toHaveTextContent("cus_1");
		expect(screen.getByText("1 customer")).toBeInTheDocument();
		expect(screen.getAllByRole("heading")).toHaveLength(1);
		expect(screen.queryByText(/Select a customer/u)).not.toBeInTheDocument();
		expect(mocks.getBillingCustomer).not.toHaveBeenCalled();

		fireEvent.change(screen.getByRole("searchbox", { name: "App user ID or alias" }), {
			target: { value: "alias-1" },
		});
		await waitFor(() => {
			expect(mocks.searchBillingCustomers).toHaveBeenLastCalledWith("10-test", "alias-1");
		});
	});

	it("opens the customer in place of the list and returns to the list", async () => {
		render(<BillingCustomersPage />);
		fireEvent.click(await screen.findByRole("button", { name: "app-user-1" }));

		expect(
			await screen.findByRole("heading", { name: "Entitlements and subscriptions" }),
		).toBeInTheDocument();
		expect(window.location.search).toBe("?customer=cus_1");
		expect(mocks.getBillingCustomer).toHaveBeenCalledWith("10-test", "cus_1");
		expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
		expect(screen.queryByRole("tab")).not.toBeInTheDocument();
		expect(screen.getByText("France")).toBeInTheDocument();
		expect(screen.getByText("alias-1")).toBeInTheDocument();
		expect(screen.getByText("apple-tx-1")).toBeInTheDocument();
		expect(screen.getByText("coins: 12")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Identity operations" })).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "All customers" }));
		expect(await screen.findByRole("searchbox")).toBeInTheDocument();
		expect(window.location.search).toBe("");
	});

	it("opens a customer directly from its address", async () => {
		window.history.replaceState({}, "", "/monetization/customers?lang=en&customer=cus_1");
		render(<BillingCustomersPage />);
		expect(
			await screen.findByRole("heading", { name: "Financial and paywall history" }),
		).toBeInTheDocument();
		expect(mocks.getBillingCustomer).toHaveBeenCalledWith("10-test", "cus_1");

		fireEvent.click(screen.getByRole("button", { name: "All customers" }));
		await waitFor(() => {
			expect(window.location.search).toBe("?lang=en");
		});
	});

	it("returns to the list after deleting the customer", async () => {
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		render(<BillingCustomersPage />);
		const confirmation = await screen.findByLabelText("Type the exact customer ID to delete");
		const remove = screen.getByRole("button", { name: "Delete billing customer" });
		expect(remove).toBeDisabled();

		fireEvent.change(confirmation, { target: { value: "cus_1" } });
		fireEvent.click(remove);

		await waitFor(() => {
			expect(mocks.deleteBillingCustomer).toHaveBeenCalledWith("10-test", "cus_1");
		});
		expect(await screen.findByRole("searchbox")).toBeInTheDocument();
		expect(window.location.search).toBe("");
	});

	it("renders the list and the customer sheet in French", async () => {
		window.history.replaceState({}, "", "/monetization/customers?lang=fr");
		render(<BillingCustomersPage />, { wrapper: French });
		expect(await screen.findByRole("heading", { name: "Clients" })).toBeInTheDocument();
		expect(screen.getByRole("columnheader", { name: "Dernière activité" })).toBeInTheDocument();

		fireEvent.click(await screen.findByRole("button", { name: "app-user-1" }));
		expect(
			await screen.findByRole("heading", { name: "Droits d’accès et abonnements" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Tous les clients" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Bloquer" })).toBeInTheDocument();
		const transaction = screen.getByText("apple-tx-1").closest("tr");
		if (!transaction) throw new Error("Transaction row missing");
		expect(transaction).toHaveTextContent("Réussi");
		expect(transaction).not.toHaveTextContent("succeeded");
	});

	it("shows readable labels and localized dates on the customer sheet", async () => {
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		render(<BillingCustomersPage />);
		await screen.findByText("apple-tx-1");

		expect(fact("Platform")).toBe("iOS");
		expect(fact("Country")).toBe("France");
		expect(fact("Language")).toBe("French");
		expect(fact("First seen")).toMatch(/^Aug 1, 2026/u);
		expect(screen.getByText("premium").nextElementSibling).toHaveTextContent(
			/^Active · Apple · expires Dec 1, 2026.* · Verified$/u,
		);
		expect(row("apple-tx-1")).toHaveTextContent(
			/^Appleapple-tx-1Initial purchaseSucceededNov 1, 2026/u,
		);
		expect(row("premium.yearly")).toHaveTextContent(/GoogleGrace periodDec 1, 2026/u);
		expect(row("pw_main")).toHaveTextContent(/^Purchase startedpw_mainonboardingNov 1, 2026/u);
		fireEvent.click(screen.getByText("All billing events (2)"));
		expect(row("Renewal")).toHaveTextContent(/^RenewalProcessedAppleNov 1, 2026/u);
		expect(row("Some new event")).toHaveTextContent(
			/^Some new eventAwaiting storeAmazonNov 1, 2026/u,
		);
		const sheet = screen.getByRole("article");
		for (const raw of ["INITIAL_PURCHASE", "grace_period", "2026-11-01", "succeeded", "ios"])
			expect(sheet.textContent).not.toContain(raw);
	});

	it("shows who a purchase was transferred from and to in the customer history", async () => {
		const detail = await mocks.getBillingCustomer.getMockImplementation()?.();
		mocks.getBillingCustomer.mockResolvedValue({
			...detail,
			events: [
				{
					id: "ev-transfer",
					event_type: "transferred",
					status: "processed",
					provider: "google",
					occurred_at: "2026-11-02T12:00:00.000Z",
					payload: JSON.stringify({
						transferred_from: ["previous-user"],
						transferred_to: ["app-user-1"],
					}),
				},
			],
		});
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		const { unmount } = render(<BillingCustomersPage />);
		fireEvent.click(await screen.findByText("All billing events (1)"));
		expect(row("Transfer")).toHaveTextContent(/From previous-user to app-user-1/u);
		unmount();

		window.history.replaceState({}, "", "/monetization/customers?lang=fr&customer=cus_1");
		render(<BillingCustomersPage />, { wrapper: French });
		fireEvent.click(await screen.findByText("Tous les événements de facturation (1)"));
		expect(row("Transfert")).toHaveTextContent(/De previous-user vers app-user-1/u);
	});

	it("shows the customer sheet labels and dates in French", async () => {
		window.history.replaceState({}, "", "/monetization/customers?lang=fr&customer=cus_1");
		render(<BillingCustomersPage />, { wrapper: French });
		await screen.findByText("apple-tx-1");

		expect(fact("Plateforme")).toBe("iOS");
		expect(fact("Pays")).toBe("France");
		expect(fact("Langue")).toBe("Français");
		expect(fact("Première activité")).toMatch(/^1 août 2026/u);
		expect(screen.getByText("premium").nextElementSibling).toHaveTextContent(
			/^Actif · Apple · expire le 1 déc\. 2026.* · Vérifié$/u,
		);
		expect(row("apple-tx-1")).toHaveTextContent(/^Appleapple-tx-1Achat initialRéussi1 nov\. 2026/u);
		expect(row("premium.yearly")).toHaveTextContent(/GooglePériode de grâce1 déc\. 2026/u);
		expect(row("pw_main")).toHaveTextContent(/^Achat commencépw_mainonboarding1 nov\. 2026/u);
		fireEvent.click(screen.getByText("Tous les événements de facturation (2)"));
		expect(row("Renouvellement")).toHaveTextContent(/^RenouvellementTraitéApple1 nov\. 2026/u);
	});

	it("shows the total spent and each transaction amount in the display currency", async () => {
		const detail = await mocks.getBillingCustomer.getMockImplementation()?.("10-test", "cus_1");
		const spending = {
			...detail,
			display_currency: "EUR",
			total_spent: {
				currency: "EUR",
				purchases: 3,
				amount_micros: 27_480_000,
				unconverted_purchases: 1,
			},
			transactions: [
				{
					...detail.transactions[0],
					price_micros: 9_990_000,
					currency: "usd",
					usd_price_micros: 9_990_000,
					usd_rate_date: "2026-11-01",
					display_currency: "EUR",
					display_price_micros: 9_250_000,
				},
				{
					id: "tx-2",
					store: "google",
					store_transaction_id: "google-tx-2",
					event_type: "PURCHASED",
					status: "active",
					created_at: "2026-11-02T12:00:00.000Z",
					price_micros: 4_990_000,
					currency: "BRL",
					usd_price_micros: null,
					usd_rate_date: null,
					display_currency: "EUR",
					display_price_micros: null,
				},
			],
		};
		mocks.getBillingCustomer.mockResolvedValue(spending);
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		const { unmount } = render(<BillingCustomersPage />);
		await screen.findByText("apple-tx-1");

		expect(fact("Total spent")).toBe("€27.481 purchase awaiting conversion is not included.");
		expect(row("apple-tx-1")).toHaveTextContent(/Nov 1, 2026.*\$9\.99 · €9\.25$/u);
		expect(row("google-tx-2")).toHaveTextContent(/R\$4\.99 · Conversion pending$/u);
		unmount();

		render(<BillingCustomersPage />, { wrapper: French });
		await screen.findByText("apple-tx-1");
		expect(fact("Total dépensé")).toMatch(
			/^27,48\s€1 achat en attente de conversion n’est pas inclus\.$/u,
		);
		expect(row("google-tx-2")).toHaveTextContent(/4,99\sR\$ · Conversion en attente$/u);
	});

	it("shows the store of each billing event and the aliases recorded in the history", async () => {
		const detail = await mocks.getBillingCustomer.getMockImplementation()?.();
		mocks.getBillingCustomer.mockResolvedValue({
			...detail,
			events: [
				{
					id: "ev-renewal",
					event_type: "RENEWAL",
					status: "processed",
					provider: "google",
					occurred_at: "2026-11-01T12:00:00.000Z",
				},
				{
					id: "ev-alias",
					event_type: "aliased",
					status: "processed",
					provider: "superboard",
					occurred_at: "2026-11-02T12:00:00.000Z",
					payload: JSON.stringify({ alias: "$superboard_anon_1", app_user_id: "app-user-1" }),
				},
			],
		});
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		const { unmount } = render(<BillingCustomersPage />);
		fireEvent.click(await screen.findByText("All billing events (2)"));
		expect(row("Renewal")).toHaveTextContent(/^RenewalProcessedGoogleNov 1, 2026/u);
		expect(row("Alias created")).toHaveTextContent(
			/^Alias createdProcessed—Nov 2, 2026.*Aliased with \$superboard_anon_1$/u,
		);
		unmount();

		window.history.replaceState({}, "", "/monetization/customers?lang=fr&customer=cus_1");
		render(<BillingCustomersPage />, { wrapper: French });
		fireEvent.click(await screen.findByText("Tous les événements de facturation (2)"));
		expect(row("Renouvellement")).toHaveTextContent(/^RenouvellementTraitéGoogle1 nov\. 2026/u);
		expect(row("Alias créé")).toHaveTextContent(
			/^Alias crééTraité—2 nov\. 2026.*Associé à \$superboard_anon_1$/u,
		);
	});

	it("transfers the purchases to another App User ID after a confirmation", async () => {
		const target = { ...customer, id: "cus_2", primary_app_user_id: "app-user-2" };
		mocks.searchBillingCustomers.mockImplementation(async (_projectId: string, query: string) => ({
			data: query
				? [{ ...customer, id: "cus_3", primary_app_user_id: "app-user-20" }, target]
				: [customer],
			next_cursor: null,
		}));
		mocks.transferBillingCustomerPurchases.mockResolvedValue({
			customer_id: "cus_2",
			transferred: 2,
		});
		window.history.replaceState({}, "", "/monetization/customers?customer=cus_1");
		render(<BillingCustomersPage />);
		const destination = await screen.findByLabelText("Destination App User ID");

		fireEvent.change(destination, { target: { value: "nobody" } });
		mocks.searchBillingCustomers.mockResolvedValueOnce({ data: [], next_cursor: null });
		fireEvent.click(screen.getByRole("button", { name: "Find" }));
		expect(await screen.findByText("No customer has this App User ID.")).toBeInTheDocument();

		fireEvent.change(destination, { target: { value: "app-user-1" } });
		fireEvent.click(screen.getByRole("button", { name: "Find" }));
		expect(
			await screen.findByText("Enter the App User ID of another customer."),
		).toBeInTheDocument();

		fireEvent.change(destination, { target: { value: "app-user-2" } });
		fireEvent.click(screen.getByRole("button", { name: "Find" }));
		const found = await screen.findByRole("group", { name: "Destination customer" });
		expect(found).toHaveTextContent("app-user-2");
		expect(found).toHaveTextContent("cus_2");
		expect(mocks.searchBillingCustomers).toHaveBeenCalledWith("10-test", "app-user-2");

		fireEvent.click(within(found).getByRole("button", { name: "Transfer purchases" }));
		const dialog = await screen.findByRole("alertdialog", {
			name: "Transfer the purchases of app-user-1 to app-user-2?",
		});
		expect(dialog).toHaveTextContent(/app-user-1 loses the access they give/u);
		expect(mocks.transferBillingCustomerPurchases).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getByRole("button", { name: "Transfer purchases" }));

		await waitFor(() => {
			expect(mocks.transferBillingCustomerPurchases).toHaveBeenCalledWith(
				"10-test",
				"cus_1",
				"cus_2",
			);
		});
		await waitFor(() => {
			expect(window.location.search).toBe("?customer=cus_2");
		});
	});

	it("offers the purchase transfer in French", async () => {
		const target = { ...customer, id: "cus_2", primary_app_user_id: "app-user-2" };
		mocks.searchBillingCustomers.mockResolvedValue({ data: [target], next_cursor: null });
		window.history.replaceState({}, "", "/monetization/customers?lang=fr&customer=cus_1");
		render(<BillingCustomersPage />, { wrapper: French });

		expect(
			await screen.findByRole("heading", { name: "Transférer les achats" }),
		).toBeInTheDocument();
		fireEvent.change(screen.getByLabelText("Identifiant de destination"), {
			target: { value: "app-user-2" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
		const found = await screen.findByRole("group", { name: "Client de destination" });
		fireEvent.click(within(found).getByRole("button", { name: "Transférer les achats" }));
		const dialog = await screen.findByRole("alertdialog", {
			name: "Transférer les achats de app-user-1 vers app-user-2\u00a0?",
		});
		expect(within(dialog).getByRole("button", { name: "Annuler" })).toBeInTheDocument();
		expect(dialog).not.toHaveTextContent(/purchases|loses/u);
	});
});
