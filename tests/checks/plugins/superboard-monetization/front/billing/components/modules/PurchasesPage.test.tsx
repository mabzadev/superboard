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
	createPurchase: vi.fn(),
}));

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
		archiveEntitlement: vi.fn(),
		archiveOffering: vi.fn(),
		archiveProduct: vi.fn(),
		createEntitlement: vi.fn(),
		createOffering: vi.fn(),
		createPackage: vi.fn(),
		createProduct: vi.fn(),
		createRefund: vi.fn(),
		getEntitlements: vi.fn(),
		getOfferings: vi.fn(),
		getPackages: vi.fn(),
		getPurchase: vi.fn(),
		updateEntitlement: vi.fn(),
		updateOffering: vi.fn(),
		updatePackage: vi.fn(),
		updateProduct: vi.fn(),
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
		api.getPurchases.mockResolvedValue([
			{
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
			},
		]);
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
});
