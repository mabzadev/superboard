import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const api = vi.hoisted(() => ({
	getPurchases: vi.fn(),
	getProducts: vi.fn(),
	getProductStatistics: vi.fn(),
	getSubscriptions: vi.fn(),
	getPurchase: vi.fn(),
	createPurchase: vi.fn(),
}));

const purchase = {
	id: "purchase-1",
	external_customer_id: "user-1",
	product_id: "product-1",
	product_name: "Pro",
	store: "manual",
	environment: "sandbox",
	external_transaction_id: "tx-manual",
	status: "pending",
	purchased_at: "2026-08-07T10:00:00.000Z",
	purchased_price_micros: 9_990_000,
	currency: "EUR",
};

function fact(container: HTMLElement, label: string) {
	const term = within(container).getByText(label, { selector: "dt" });
	return term.nextElementSibling?.textContent ?? "";
}

function metric(label: string) {
	const card = screen
		.getByText(label, { selector: "[data-slot=card-description]" })
		.closest<HTMLElement>("[data-slot=card]");
	if (!card) throw new Error(`${label} metric missing`);
	return card;
}

const twoCurrencyStatistics = {
	totals: {
		purchases: 3,
		gross_revenue_micros: 16_980_000,
		refunds: 1,
		refunded_micros: 4_990_000,
		net_revenue_micros: 11_990_000,
		active_subscriptions: 0,
	},
	totals_by_currency: [
		{
			currency: "EUR",
			purchases: 2,
			gross_revenue_micros: 14_980_000,
			refunds: 1,
			refunded_micros: 4_990_000,
			net_revenue_micros: 9_990_000,
		},
		{
			currency: "USD",
			purchases: 1,
			gross_revenue_micros: 2_000_000,
			refunds: 0,
			refunded_micros: 0,
			net_revenue_micros: 2_000_000,
		},
	],
	by_status: [],
	series: [{ bucket: "2026-11-01", purchases: 3, revenue_micros: 16_980_000 }],
	series_by_currency: [
		{ bucket: "2026-11-01", currency: "EUR", purchases: 2, revenue_micros: 14_980_000 },
		{ bucket: "2026-11-01", currency: "USD", purchases: 1, revenue_micros: 2_000_000 },
	],
	by_product_platform: [],
};

vi.mock("@superboard/front-ui/context/useProjectSelection.js", () => ({
	useProjectSelection: () => ({ selectedProject: { id: "10-test", name: "Test" } }),
}));
vi.mock("@superboard/front-ui/lib/Notifications.js", () => ({
	showErrorNotification: vi.fn(),
	showSuccessNotification: vi.fn(),
}));
vi.mock(
	"../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/api/products/productsService.js",
	() => ({
		getBillingMigrationStatus: vi.fn().mockResolvedValue({ complete: true }),
		migrateProductsLedger: vi.fn(),
		createRefund: vi.fn(),
		getPurchase: api.getPurchase,
		updateSubscription: vi.fn(),
		createPurchase: api.createPurchase,
		getPurchases: api.getPurchases,
		getProducts: api.getProducts,
		getProductStatistics: api.getProductStatistics,
		getSubscriptions: api.getSubscriptions,
	}),
);

import { PurchasesPage } from "../../../../../../../../packages/plugins/superboard-monetization/src/front/billing/components/modules/ProductsPages.js";

function French({ children }: { children: ReactNode }) {
	const context = useOptionalFrontContext();
	if (!context) throw new Error("Missing Front context");
	return (
		<FrontContextProvider value={{ ...context, locale: "fr" }}>{children}</FrontContextProvider>
	);
}

describe("purchases page", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		api.getProducts.mockResolvedValue([
			{
				id: "product-1",
				identifier: "pro",
				display_name: "Pro",
				description: null,
				product_type: "subscription",
				status: "active",
			},
		]);
		api.getPurchases.mockResolvedValue([purchase]);
		api.getSubscriptions.mockResolvedValue([]);
		api.getProductStatistics.mockResolvedValue({
			totals: {
				purchases: 1,
				gross_revenue_micros: 9_990_000,
				refunds: 0,
				refunded_micros: 0,
				net_revenue_micros: 9_990_000,
				active_subscriptions: 0,
			},
			by_status: [],
			series: [],
			by_product_platform: [],
		});
		api.createPurchase.mockResolvedValue({});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("filters purchases and subscriptions from the inline toolbar while typing", async () => {
		render(<PurchasesPage />);
		await screen.findByText("tx-manual");

		fireEvent.change(screen.getByRole("searchbox", { name: "Financial customer" }), {
			target: { value: "user-2" },
		});
		await waitFor(() => {
			expect(api.getPurchases).toHaveBeenLastCalledWith(
				"10-test",
				expect.objectContaining({ customer_id: "user-2" }),
			);
		});
		expect(api.getSubscriptions).toHaveBeenLastCalledWith("10-test", { customer_id: "user-2" });

		fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
			target: { value: "refunded" },
		});
		await waitFor(() => {
			expect(api.getPurchases).toHaveBeenLastCalledWith(
				"10-test",
				expect.objectContaining({ customer_id: "user-2", status: "refunded" }),
			);
		});
	});

	it("records a sandbox purchase from a dialog and closes it once saved", async () => {
		render(<PurchasesPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Record sandbox purchase" }));
		const dialog = await screen.findByRole("dialog", { name: "Record sandbox purchase" });

		fireEvent.change(within(dialog).getByLabelText("Financial customer ID"), {
			target: { value: "user-9" },
		});
		fireEvent.change(within(dialog).getByLabelText("Store"), { target: { value: "apple" } });
		fireEvent.change(within(dialog).getByLabelText("External transaction ID"), {
			target: { value: "tx-9" },
		});
		fireEvent.change(within(dialog).getByLabelText("Price"), { target: { value: "4.99" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "Record purchase" }));

		await waitFor(() => {
			expect(api.createPurchase).toHaveBeenCalledWith(
				"10-test",
				expect.objectContaining({
					financial_customer_id: "user-9",
					product_id: "product-1",
					store: "apple",
					environment: "sandbox",
					external_transaction_id: "tx-9",
					purchased_price_micros: 4_990_000,
				}),
			);
		});
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		});
	});

	it("keeps every purchase field in the detail opened from the history row", async () => {
		api.getPurchase.mockResolvedValue({
			...purchase,
			expires_at: "2026-09-07T10:00:00.000Z",
			entitlements: [],
			refunds: [],
		});
		render(<PurchasesPage />);
		const row = (await screen.findByText("tx-manual")).closest("tr");
		if (!row) throw new Error("Purchase row missing");
		expect(within(row).getByRole("button", { name: "Refund" })).toBeEnabled();

		fireEvent.click(within(row).getByRole("button", { name: "View purchase tx-manual" }));
		const detail = (await screen.findByText("Purchase detail")).closest<HTMLElement>(
			"[data-slot=card]",
		);
		if (!detail) throw new Error("Purchase detail missing");
		expect(api.getPurchase).toHaveBeenCalledWith("10-test", "purchase-1");
		expect(fact(detail, "Product")).toBe("Pro");
		expect(fact(detail, "Customer")).toBe("user-1");
		expect(fact(detail, "Transaction ID")).toBe("tx-manual");
		expect(fact(detail, "Store")).toBe("Manual");
		expect(fact(detail, "Environment")).toBe("Sandbox");
		expect(fact(detail, "Status")).toBe("Pending");
		expect(fact(detail, "Amount")).toBe("€9.99");
		expect(fact(detail, "Purchased")).toMatch(/2026/u);
		expect(fact(detail, "Expires")).toMatch(/2026/u);
	});

	it("keeps renewal and last update of each subscription in its row in French", async () => {
		api.getSubscriptions.mockResolvedValue([
			{
				id: "subscription-1",
				external_customer_id: "user-1",
				product_id: "product-1",
				product_name: "Pro",
				store: "apple",
				environment: "production",
				original_transaction_id: "tx-original",
				status: "cancelled",
				current_period_started_at: "2026-08-01T10:00:00.000Z",
				current_period_ends_at: "2026-09-01T10:00:00.000Z",
				auto_renew: 0,
				updated_at: "2026-08-02T10:00:00.000Z",
			},
		]);
		render(<PurchasesPage />, { wrapper: French });
		const row = (await screen.findByRole("button", { name: "Restaurer" })).closest("tr");
		if (!row) throw new Error("Subscription row missing");

		expect(row).toHaveTextContent("Annulé");
		expect(row).toHaveTextContent("Renouvellement désactivé");
		expect(row).toHaveTextContent(/Mis à jour le .*2026/u);
	});

	it("renders statuses, stores, environments and amounts in French", async () => {
		render(<PurchasesPage />, { wrapper: French });
		const row = (await screen.findByText("tx-manual")).closest("tr");
		if (!row) throw new Error("Purchase row missing");

		expect(row).toHaveTextContent("Manuel");
		expect(row).toHaveTextContent("Bac à sable");
		expect(row).toHaveTextContent("En attente");
		expect(row).toHaveTextContent(/9,99\s€/u);
		expect(
			within(screen.getByRole("combobox", { name: "Statut" }))
				.getAllByRole("option")
				.map((option) => option.textContent),
		).toEqual([
			"Tous les statuts",
			"En attente",
			"Actif",
			"Expiré",
			"Annulé",
			"Remboursé",
			"Échec",
		]);
	});

	it("totals revenue in each purchase currency without adding currencies together", async () => {
		api.getProductStatistics.mockResolvedValue(twoCurrencyStatistics);
		const { unmount } = render(<PurchasesPage />);
		const day = (await screen.findByText("Nov 1, 2026")).closest("tr");
		if (!day) throw new Error("Revenue day missing");

		expect(day).toHaveTextContent("3€14.98$2.00");
		expect(metric("Gross revenue")).toHaveTextContent("€14.98$2.00");
		expect(metric("Refunded")).toHaveTextContent("€4.99$0.00");
		expect(metric("Net revenue")).toHaveTextContent("€9.99$2.00");
		for (const mixed of ["16.98", "11.99"])
			expect(screen.queryByText(new RegExp(mixed, "u"))).not.toBeInTheDocument();
		unmount();

		render(<PurchasesPage />, { wrapper: French });
		await screen.findByText("1 nov. 2026");
		expect(metric("Revenu brut")).toHaveTextContent(/14,98\s€\s*2,00\s\$US/u);
	});

	it("totals revenue in the display currency and reports purchases awaiting conversion", async () => {
		api.getProductStatistics.mockResolvedValue({
			...twoCurrencyStatistics,
			display_currency: "USD",
			totals_in_display_currency: {
				purchases: 3,
				gross_revenue_micros: 12_500_000,
				refunds: 1,
				refunded_micros: 1_000_000,
				net_revenue_micros: 11_500_000,
				active_subscriptions: 0,
				unconverted_purchases: 2,
				unconverted_refunds: 1,
			},
			series_in_display_currency: [
				{
					bucket: "2026-11-01",
					purchases: 3,
					revenue_micros: 12_500_000,
					unconverted_purchases: 2,
				},
			],
		});
		const { unmount } = render(<PurchasesPage />);
		const day = (await screen.findByText("Nov 1, 2026")).closest("tr");
		if (!day) throw new Error("Revenue day missing");

		expect(day).toHaveTextContent("3$12.502 awaiting conversion");
		expect(metric("Gross revenue")).toHaveTextContent(/^Gross revenue\$12\.50$/u);
		expect(metric("Refunded")).toHaveTextContent("$1.00");
		expect(metric("Net revenue")).toHaveTextContent("$11.50");
		expect(
			screen.getByText("Amounts in USD, converted at the exchange rate of each purchase day."),
		).toBeInTheDocument();
		expect(
			screen.getByText("2 purchases awaiting conversion are not included in these totals."),
		).toBeInTheDocument();
		expect(
			screen.getByText("1 refund awaiting conversion is not included in these totals."),
		).toBeInTheDocument();
		unmount();

		render(<PurchasesPage />, { wrapper: French });
		await screen.findByText("1 nov. 2026");
		expect(metric("Revenu net")).toHaveTextContent(/11,50\s\$US/u);
		expect(
			screen.getByText("2 achats en attente de conversion ne sont pas inclus dans ces totaux."),
		).toBeInTheDocument();
		expect(
			screen.getByText("Montants en USD, convertis au taux de change du jour de chaque achat."),
		).toBeInTheDocument();
	});

	it("shows yen and won totals without decimals", async () => {
		const inDisplayCurrency = (currency: string) => ({
			...twoCurrencyStatistics,
			display_currency: currency,
			totals_in_display_currency: {
				purchases: 3,
				gross_revenue_micros: 1_250_000_000,
				refunds: 0,
				refunded_micros: 0,
				net_revenue_micros: 1_250_000_000,
				active_subscriptions: 0,
				unconverted_purchases: 0,
				unconverted_refunds: 0,
			},
			series_in_display_currency: [],
		});
		api.getProductStatistics.mockResolvedValue(inDisplayCurrency("JPY"));
		const { unmount } = render(<PurchasesPage />);
		await screen.findByText("Amounts in JPY, converted at the exchange rate of each purchase day.");
		expect(metric("Net revenue")).toHaveTextContent(/^Net revenue¥1,250$/u);
		unmount();

		api.getProductStatistics.mockResolvedValue(inDisplayCurrency("KRW"));
		render(<PurchasesPage />, { wrapper: French });
		await screen.findByText(
			"Montants en KRW, convertis au taux de change du jour de chaque achat.",
		);
		expect(metric("Revenu net")).toHaveTextContent(/^Revenu net1\s250\s₩$/u);
	});

	it("names the daily Currency API rate for a currency the ECB does not publish", async () => {
		const riyals = {
			...purchase,
			id: "purchase-sar",
			external_transaction_id: "tx-sar",
			purchased_price_micros: 37_500_000,
			currency: "SAR",
			usd_price_micros: 10_000_000,
			usd_rate_date: "2026-08-07",
			display_currency: "USD",
			display_price_micros: 10_000_000,
		};
		api.getPurchases.mockResolvedValue([riyals]);
		api.getPurchase.mockResolvedValue({
			...riyals,
			usd_rate_source: "currency-api",
			entitlements: [],
			refunds: [],
		});
		const { unmount } = render(<PurchasesPage />);
		fireEvent.click(await screen.findByRole("button", { name: "View purchase tx-sar" }));
		const detail = (await screen.findByText("Purchase detail")).closest<HTMLElement>(
			"[data-slot=card]",
		);
		if (!detail) throw new Error("Purchase detail missing");
		expect(fact(detail, "Amount in USD")).toBe(
			"$10.00Currency API daily rate of Aug 7, 2026 (not published by the ECB)",
		);
		unmount();

		render(<PurchasesPage />, { wrapper: French });
		fireEvent.click(await screen.findByRole("button", { name: "Voir l’achat tx-sar" }));
		const french = (await screen.findByText("Détail de l’achat")).closest<HTMLElement>(
			"[data-slot=card]",
		);
		if (!french) throw new Error("Purchase detail missing");
		expect(fact(french, "Montant en USD")).toMatch(
			/^10,00\s\$USTaux quotidien Currency API du 7 août 2026 \(devise non publiée par la BCE\)$/u,
		);
	});

	it("shows each transaction in its original currency and in the display currency", async () => {
		const converted = {
			...purchase,
			id: "purchase-2",
			external_transaction_id: "tx-converted",
			usd_price_micros: 10_800_000,
			usd_rate_date: "2026-08-07",
			display_currency: "USD",
			display_price_micros: 10_800_000,
		};
		const awaiting = {
			...purchase,
			display_currency: "USD",
			display_price_micros: null,
			usd_rate_date: null,
		};
		api.getPurchases.mockResolvedValue([converted, awaiting]);
		api.getPurchase.mockResolvedValue({
			...converted,
			entitlements: [],
			refunds: [
				{
					id: "refund-1",
					purchase_id: "purchase-2",
					status: "completed",
					amount_micros: 9_990_000,
					currency: "EUR",
					usd_amount_micros: 10_900_000,
					usd_rate_date: "2026-08-10",
					display_currency: "USD",
					display_amount_micros: 10_900_000,
					requested_at: "2026-08-10T10:00:00.000Z",
				},
			],
		});
		const { unmount } = render(<PurchasesPage />);
		const row = (await screen.findByText("tx-converted")).closest("tr");
		const pending = screen.getByText("tx-manual").closest("tr");
		if (!row || !pending) throw new Error("Purchase rows missing");
		expect(row).toHaveTextContent("€9.99$10.80");
		expect(pending).toHaveTextContent("€9.99Conversion pending");

		fireEvent.click(within(row).getByRole("button", { name: "View purchase tx-converted" }));
		const detail = (await screen.findByText("Purchase detail")).closest<HTMLElement>(
			"[data-slot=card]",
		);
		if (!detail) throw new Error("Purchase detail missing");
		expect(fact(detail, "Amount")).toBe("€9.99");
		expect(fact(detail, "Amount in USD")).toBe("$10.80ECB reference rate of Aug 7, 2026");
		expect(within(detail).getByText("$10.90")).toBeInTheDocument();
		unmount();

		render(<PurchasesPage />, { wrapper: French });
		const frenchPending = (await screen.findByText("tx-manual")).closest("tr");
		expect(frenchPending).toHaveTextContent(/9,99\s€Conversion en attente/u);
	});

	it("never presents an amount without a recorded currency as dollars", async () => {
		const unknown = { ...purchase, currency: null };
		api.getPurchases.mockResolvedValue([unknown]);
		api.getPurchase.mockResolvedValue({
			...unknown,
			entitlements: [],
			refunds: [
				{
					id: "refund-1",
					purchase_id: "purchase-1",
					status: "completed",
					amount_micros: 4_990_000,
					currency: null,
					requested_at: "2026-08-08T10:00:00.000Z",
				},
			],
		});
		render(<PurchasesPage />);
		const row = (await screen.findByText("tx-manual")).closest("tr");
		if (!row) throw new Error("Purchase row missing");

		expect(row).toHaveTextContent("9.99");
		expect(row).not.toHaveTextContent("$");
		expect(metric("Gross revenue")).toHaveTextContent("9.99");
		expect(metric("Gross revenue")).not.toHaveTextContent("$");

		fireEvent.click(within(row).getByRole("button", { name: "View purchase tx-manual" }));
		const detail = (await screen.findByText("Purchase detail")).closest<HTMLElement>(
			"[data-slot=card]",
		);
		if (!detail) throw new Error("Purchase detail missing");
		expect(fact(detail, "Amount")).toBe("9.99");
		expect(within(detail).getByText("4.99")).toBeInTheDocument();
	});

	it("names platforms and stores and shows revenue days as localized dates", async () => {
		const statistics = {
			totals: {
				purchases: 2,
				gross_revenue_micros: 19_980_000,
				refunds: 0,
				refunded_micros: 0,
				net_revenue_micros: 19_980_000,
				active_subscriptions: 0,
			},
			by_status: [],
			series: [{ bucket: "2026-11-01", purchases: 2, revenue_micros: 19_980_000 }],
			by_product_platform: [
				{ platform: "ios", store: "apple" },
				{ platform: "android", store: "google" },
				{ platform: "smart_tv", store: "manual" },
			].map((source) => ({
				product_id: "product-1",
				product_name: "Pro",
				units_sold: 1,
				first_time_purchases: 1,
				revenue_micros: 9_990_000,
				currency: "EUR",
				cancellations: 0,
				...source,
			})),
		};
		api.getProductStatistics.mockResolvedValue(statistics);
		const platforms = (header: string) => {
			const table = screen.getByRole("columnheader", { name: header }).closest("table");
			if (!table) throw new Error("Revenue table missing");
			return Array.from(table.querySelectorAll("tbody tr"), (row) => row.children[1]?.textContent);
		};

		const { unmount } = render(<PurchasesPage />);
		expect(await screen.findByText("Nov 1, 2026")).toBeInTheDocument();
		expect(platforms("Platform")).toEqual(["iOSApple", "AndroidGoogle", "Smart tvManual"]);
		expect(screen.queryByText("2026-11-01")).not.toBeInTheDocument();
		unmount();

		render(<PurchasesPage />, { wrapper: French });
		expect(await screen.findByText("1 nov. 2026")).toBeInTheDocument();
		expect(platforms("Plateforme")).toEqual(["iOSApple", "AndroidGoogle", "Smart tvManuel"]);
	});
});
