import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  DELETE: requests.delete,
  GET: requests.get,
  PATCH: vi.fn(),
  POST: requests.post,
  PUT: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  config: { apiPath: "/api/v1" },
}));

import {
  deleteBillingCustomer,
  getBillingCustomer,
  grantBillingEntitlement,
  mergeBillingCustomers,
  revokeBillingEntitlement,
  searchBillingCustomers,
  setBillingCustomerBlocked,
} from "../billingService";

describe("billing customer administration service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requests.get.mockResolvedValue({ data: { data: [], next_cursor: null } });
    requests.post.mockResolvedValue({ data: {} });
    requests.delete.mockResolvedValue({ data: {} });
  });

  it("searches and loads customers through the project-scoped purchases API", async () => {
    await searchBillingCustomers("project-1", "user@example.com");
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v2/purchases/projects/project-1/customers?q=user%40example.com&limit=100"
    );

    await getBillingCustomer("project-1", "customer/one");
    expect(requests.get).toHaveBeenLastCalledWith(
      "/api/v2/purchases/projects/project-1/customers/customer%2Fone"
    );
  });

  it("uses only audited customer mutation routes", async () => {
    await setBillingCustomerBlocked("project-1", "customer-1", true);
    await grantBillingEntitlement(
      "project-1",
      "customer-1",
      "entitlement-1",
      "2027-01-01T00:00:00.000Z"
    );
    await revokeBillingEntitlement("project-1", "customer-1", "entitlement-1");
    await mergeBillingCustomers("project-1", "customer-1", "customer-2");
    await deleteBillingCustomer("project-1", "customer-1");

    expect(requests.post.mock.calls).toEqual([
      [
        "/api/v2/purchases/projects/project-1/customers/customer-1/block",
        { blocked: true },
      ],
      [
        "/api/v2/purchases/projects/project-1/customers/customer-1/entitlements/entitlement-1",
        { expires_at: "2027-01-01T00:00:00.000Z" },
      ],
      [
        "/api/v2/purchases/projects/project-1/customers/customer-1/merge",
        { target_customer_id: "customer-2" },
      ],
    ]);
    expect(requests.delete.mock.calls).toEqual([
      [
        "/api/v2/purchases/projects/project-1/customers/customer-1/entitlements/entitlement-1",
      ],
      ["/api/v2/purchases/projects/project-1/customers/customer-1"],
    ]);
  });
});
