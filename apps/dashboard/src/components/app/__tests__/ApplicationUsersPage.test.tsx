import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApplicationUsers: vi.fn(),
  getApplicationUser: vi.fn(),
  searchBillingCustomers: vi.fn(),
  getBillingCustomer: vi.fn(),
  useProjectSelection: vi.fn(),
}));

vi.mock("@/api/identity/applicationUsersService", () => ({
  getApplicationUsers: mocks.getApplicationUsers,
  getApplicationUser: mocks.getApplicationUser,
}));
vi.mock("@/api/billing/billingService", () => ({
  searchBillingCustomers: mocks.searchBillingCustomers,
  getBillingCustomer: mocks.getBillingCustomer,
}));
vi.mock("@/context/useProjectSelection", () => ({
  useProjectSelection: mocks.useProjectSelection,
}));

import ApplicationUsersPage, {
  commerceCustomerForUser,
} from "../ApplicationUsersPage";

describe("application user back office", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("shows free and paying users with authentication and commerce state", async () => {
    render(<ApplicationUsersPage />);
    expect(await screen.findByText("Example User")).toBeInTheDocument();
    expect(screen.getByText("Email verified")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect user@example.test" })
    );

    expect(
      await screen.findByText("Linked authentication")
    ).toBeInTheDocument();
    expect(
      screen.getByText("relay@privaterelay.appleid.com", { exact: false })
    ).toBeInTheDocument();
    expect(await screen.findByText("premium: active")).toBeInTheDocument();
    expect(screen.getByText("purchase")).toBeInTheDocument();
    expect(mocks.searchBillingCustomers).toHaveBeenCalledWith(
      "10-test",
      "application-user-1"
    );
  });

  it("does not query personal data for a non-administrator", async () => {
    mocks.useProjectSelection.mockReturnValue({
      selectedInstance: { id: "10", role: "member" },
      selectedProject: { id: "10-test", name: "Test" },
    });
    render(<ApplicationUsersPage />);
    expect(
      screen.getByText("Administrator access required")
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.getApplicationUsers).not.toHaveBeenCalled()
    );
  });

  it("matches billing aliases without accepting partial identifiers", () => {
    const customers = [
      {
        id: "billing-1",
        primary_app_user_id: "primary-user",
        aliases: "alias-one,alias-two",
      },
    ];
    expect(
      commerceCustomerForUser(customers as never, "alias-two")
    ).toMatchObject({ id: "billing-1" });
    expect(
      commerceCustomerForUser(customers as never, "alias")
    ).toBeUndefined();
  });
});
