import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  GET: requests.get,
  POST: requests.post,
  PUT: requests.put,
  DELETE: requests.delete,
}));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import {
  getProductStatistics,
  getPurchase,
  getFinancialCustomerEntitlements,
  getPurchases,
  updateEntitlement,
  updateOffering,
  updatePackage,
} from "../productsService";

describe("products dashboard service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const request of Object.values(requests)) {
      request.mockResolvedValue({ data: { data: [] } });
    }
  });

  it("passes every supported purchase filter to the canonical route", async () => {
    await getPurchases("10-test", {
      from: "2026-08-01",
      to: "2026-08-07",
      status: "active",
      customer_id: "customer 1",
      product_id: "product-1",
      platform: "ios",
    });
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/products/projects/10-test/purchases?from=2026-08-01&to=2026-08-07&status=active&customer_id=customer+1&product_id=product-1&platform=ios"
    );
  });

  it("requests the server-side legacy revenue dimensions", async () => {
    await getProductStatistics("10-prod", {
      from: "2026-07-01",
      to: "2026-08-01",
      product_id: "product-1",
      platform: "android",
    });
    expect(requests.get).toHaveBeenCalledWith(
      "/api/v1/products/projects/10-prod/statistics?from=2026-07-01&to=2026-08-01&product_id=product-1&platform=android"
    );
  });

  it("uses PUT for every editable catalog association", async () => {
    await updatePackage("10-test", "package-1", {
      identifier: "monthly",
      display_name: "Monthly",
      description: null,
      product_id: "product-1",
      position: 0,
      active: true,
    });
    await updateOffering("10-test", "offering-1", {
      identifier: "default",
      display_name: "Default",
      description: null,
      placement: "main",
      priority: 100,
      active: true,
      package_ids: ["package-1"],
    });
    await updateEntitlement("10-test", "entitlement-1", {
      identifier: "pro",
      display_name: "Pro",
      description: null,
      active: true,
      product_ids: ["product-1"],
    });
    expect(requests.put.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/products/projects/10-test/packages/package-1",
      "/api/v1/products/projects/10-test/offerings/offering-1",
      "/api/v1/products/projects/10-test/entitlements/entitlement-1",
    ]);
  });

  it("loads purchase and customer entitlement details from scoped routes", async () => {
    await getPurchase("10-test", "purchase-1");
    await getFinancialCustomerEntitlements("10-test", "customer/one");
    expect(requests.get.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/products/projects/10-test/purchases/purchase-1",
      "/api/v1/products/projects/10-test/customers/customer%2Fone/entitlements",
    ]);
  });
});
