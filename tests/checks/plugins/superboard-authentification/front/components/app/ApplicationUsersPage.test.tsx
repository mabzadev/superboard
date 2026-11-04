import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	fireEvent,
	render,
	screen,
	waitFor,
} from "../../../../../packages/supbrd-front-ui/render.js";

const mocks = vi.hoisted(() => ({
	getApplicationUsers: vi.fn(),
	getApplicationUser: vi.fn(),
	searchBillingCustomers: vi.fn(),
	getBillingCustomer: vi.fn(),
	useProjectSelection: vi.fn(),
}));

vi.mock(
	"../../../../../../../packages/plugins/superboard-authentification/src/front/api/identity/applicationUsersService.js",
	() => ({
		getApplicationUsers: mocks.getApplicationUsers,
		getApplicationUser: mocks.getApplicationUser,
	}),
);
vi.mock(
	"../../../../../../../packages/plugins/superboard-authentification/src/front/api/billing/billingService.js",
	() => ({
		searchBillingCustomers: mocks.searchBillingCustomers,
		getBillingCustomer: mocks.getBillingCustomer,
	}),
);
vi.mock(
	"../../../../../../../packages/supbrd-front-ui/src/shared/context/useProjectSelection.js",
	() => ({
		useProjectSelection: mocks.useProjectSelection,
	}),
);

import ApplicationUsersPage, {
	commerceCustomerForUser,
} from "../../../../../../../packages/plugins/superboard-authentification/src/front/components/app/ApplicationUsersPage.js";

describe("application user back office", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		window.history.replaceState({}, "", "/auth/users");
		mocks.useProjectSelection.mockReturnValue({
			selectedInstance: { id: "10", role: "owner" },
			selectedProject: { id: "10-test", name: "Test" },
		});
		mocks.getApplicationUsers.mockResolvedValue({
			data: [
				{
					id: "application-user-1",
					email: "user@example.test",
					name: "Example User",
					anonymous: false,
					email_verified: true,
					password_configured: true,
					providers: ["apple", "google"],
					auth_methods: ["password", "apple", "google"],
					active_session_count: 2,
					last_session_at: "2026-08-10T10:00:00.000Z",
					created_at: "2026-08-01T10:00:00.000Z",
					updated_at: "2026-08-10T10:00:00.000Z",
				},
			],
			meta: { total: 1, limit: 50, offset: 0, has_more: false },
		});
		mocks.getApplicationUser.mockResolvedValue({
			id: "application-user-1",
			email: "user@example.test",
			name: "Example User",
			anonymous: false,
			email_verified: true,
			password_configured: true,
			providers: ["apple", "google"],
			auth_methods: ["password", "apple", "google"],
			active_session_count: 2,
			last_session_at: "2026-08-10T10:00:00.000Z",
			created_at: "2026-08-01T10:00:00.000Z",
			updated_at: "2026-08-10T10:00:00.000Z",
			identities: [
				{
					provider: "apple",
					provider_email: "relay@privaterelay.appleid.com",
					linked_at: "2026-08-01T10:00:00.000Z",
				},
				{
					provider: "google",
					provider_email: "user@example.test",
					linked_at: "2026-08-02T10:00:00.000Z",
				},
			],
			sessions: {
				total: 4,
				active: 2,
				revoked: 1,
				expired: 1,
				last_authenticated_at: "2026-08-10T10:00:00.000Z",
			},
		});
		mocks.searchBillingCustomers.mockResolvedValue({
			data: [
				{
					id: "billing-customer-1",
					primary_app_user_id: "application-user-1",
				},
			],
			next_cursor: null,
		});
		mocks.getBillingCustomer.mockResolvedValue({
			customer: {
				id: "billing-customer-1",
				primary_app_user_id: "application-user-1",
			},
			aliases: [],
			customer_info: {
				original_app_user_id: "application-user-1",
				aliases: [],
				request_date: "2026-08-10T10:00:00.000Z",
				entitlements: {
					premium: {
						identifier: "premium",
						is_active: true,
						status: "active",
					},
				},
				active_subscriptions: ["premium.monthly"],
				subscriptions: [],
				balances: {},
				signature: "signed",
				signature_algorithm: "ES256",
				signature_key_id: "key-1",
			},
			transactions: [],
			events: [],
			paywall_events: [
				{
					id: "paywall-event-1",
					event_type: "purchase",
					placement_identifier: "onboarding",
					occurred_at: "2026-08-10T09:00:00.000Z",
				},
			],
		});
	});

	it("lists users in a single table with their sign-in method, session and sign-up date", async () => {
		render(<ApplicationUsersPage />);
		const row = (await screen.findByRole("button", { name: "Example User" })).closest("tr")!;
		expect(row).toHaveTextContent("user@example.test");
		expect(row).toHaveTextContent("Password, Apple, Google");
		expect(row).toHaveTextContent("2 active");
		expect(row).toHaveTextContent(new Date("2026-08-01T10:00:00.000Z").toLocaleDateString("en"));
		expect(screen.getByText("1 user")).toBeInTheDocument();
		expect(screen.queryByRole("tab")).not.toBeInTheDocument();
		expect(mocks.getApplicationUser).not.toHaveBeenCalled();
	});

	it("opens the user sheet in place of the list and returns to the list", async () => {
		render(<ApplicationUsersPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Example User" }));

		expect(await screen.findByText("Linked authentication")).toBeInTheDocument();
		expect(window.location.search).toBe("?user=application-user-1");
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(
			screen.getByText("relay@privaterelay.appleid.com", { exact: false }),
		).toBeInTheDocument();
		expect(await screen.findByText("premium: active")).toBeInTheDocument();
		expect(screen.getByText("purchase")).toBeInTheDocument();
		expect(mocks.searchBillingCustomers).toHaveBeenCalledWith("10-test", "application-user-1");
		expect(screen.queryByRole("tab")).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "All users" }));
		expect(await screen.findByRole("table")).toBeInTheDocument();
		expect(window.location.search).toBe("");
	});

	it("opens a user sheet directly from its address", async () => {
		window.history.replaceState({}, "", "/auth/users?tab=users&user=application-user-1");
		render(<ApplicationUsersPage />);
		expect(await screen.findByText("Linked authentication")).toBeInTheDocument();
		expect(mocks.getApplicationUser).toHaveBeenCalledWith("10-test", "application-user-1");
	});

	it("links the dimensions owned by other plugins from the user sheet", async () => {
		render(<ApplicationUsersPage />);
		fireEvent.click(await screen.findByRole("button", { name: "Example User" }));
		await screen.findByText("Linked authentication");

		expect(screen.getByRole("link", { name: "View in Communication › Audience" })).toHaveAttribute(
			"href",
			"/communication/marketing-email?tab=contacts&q=user%40example.test",
		);
		expect(screen.getByRole("link", { name: "View in Support" })).toHaveAttribute(
			"href",
			"/support/inbox?q=user%40example.test",
		);
		expect(screen.getByRole("link", { name: "View events" })).toHaveAttribute(
			"href",
			"/analytics/events?user=application-user-1",
		);
	});

	it("does not query personal data for a non-administrator", async () => {
		mocks.useProjectSelection.mockReturnValue({
			selectedInstance: { id: "10", role: "member" },
			selectedProject: { id: "10-test", name: "Test" },
		});
		render(<ApplicationUsersPage />);
		expect(screen.getByText("Administrator access required")).toBeInTheDocument();
		await waitFor(() => expect(mocks.getApplicationUsers).not.toHaveBeenCalled());
	});

	it("matches billing aliases without accepting partial identifiers", () => {
		const customers = [
			{
				id: "billing-1",
				primary_app_user_id: "primary-user",
				aliases: "alias-one,alias-two",
			},
		];
		expect(commerceCustomerForUser(customers as never, "alias-two")).toMatchObject({
			id: "billing-1",
		});
		expect(commerceCustomerForUser(customers as never, "alias")).toBeUndefined();
	});
});
