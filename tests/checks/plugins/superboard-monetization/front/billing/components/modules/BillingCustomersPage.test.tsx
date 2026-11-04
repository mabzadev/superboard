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
} from "../../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	searchBillingCustomers: vi.fn(),
	getBillingOverview: vi.fn(),
	getBillingCustomer: vi.fn(),
	deleteBillingCustomer: vi.fn(),
	setBillingCustomerBlocked: vi.fn(),
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
	attributes: JSON.stringify({ sdk_context: { country: "FR", platform: "ios" } }),
	transaction_count: 3,
	active_subscription_count: 1,
	first_seen_at: "2026-08-01T10:00:00.000Z",
	last_seen_at: "2026-08-10T10:00:00.000Z",
	created_at: "2026-08-01T10:00:00.000Z",
	updated_at: "2026-08-10T10:00:00.000Z",
};

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
						verification: "apple",
					},
				},
				active_subscriptions: ["premium.monthly"],
				subscriptions: [],
				balances: { coins: 12 },
				signature: "signed",
				signature_algorithm: "ES256",
				signature_key_id: "key-1",
			},
			transactions: [{ id: "tx-1", store: "apple", store_transaction_id: "apple-tx-1" }],
			events: [],
			paywall_events: [],
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
		expect(screen.getByText("FR")).toBeInTheDocument();
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
	});
});
