import { beforeEach, describe, expect, it, vi } from "vitest";

const requests = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({
  GET: requests.get,
  POST: vi.fn(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock("@/lib/config", () => ({ config: { apiPath: "/api/v1" } }));

import { getCustomers, getReferrals, type AppCustomer } from "../appService";
import { customerToAudienceRow } from "@/components/app/AppAudiencePages";

describe("App acquisition analytics", () => {
  beforeEach(() => requests.get.mockReset());

  it("sends the selected period and timezone to Customers and Referrals", async () => {
    requests.get
      .mockResolvedValueOnce({ data: { data: [], meta: { total: 0 } } })
      .mockResolvedValueOnce({ data: { data: [] } });
    const filters = { from: "2026-07-08", to: "2026-08-07", timezone: "Europe/Zurich" };

    await getCustomers("10-prod", "ada", 0, filters);
    await getReferrals("10-prod", filters);

    expect(requests.get.mock.calls[0]?.[0]).toContain("/app/projects/10-prod/customers?");
    expect(requests.get.mock.calls[0]?.[0]).toContain("from=2026-07-08");
    expect(requests.get.mock.calls[0]?.[0]).toContain("search=ada");
    expect(requests.get.mock.calls[1]?.[0]).toContain("/app/projects/10-prod/referrals?");
    expect(requests.get.mock.calls[1]?.[0]).toContain("timezone=Europe%2FZurich");
  });

  it("renders Worker aggregates ahead of legacy attribute snapshots", () => {
    const customer: AppCustomer = {
      id: "customer-1",
      external_id: "sdk-1",
      attributes: { total_views: 999, total_revenue: 999 },
      first_seen_at: "2026-01-01T00:00:00Z",
      last_seen_at: "2026-08-07T00:00:00Z",
      total_views: 12,
      total_opens: 11,
      total_installs: 10,
      total_reinstalls: 9,
      total_reactivations: 8,
      total_user_referred: 7,
      total_time_spent: 60,
      total_revenue: 1299,
    };

    expect(customerToAudienceRow(customer)).toMatchObject({
      views: 12,
      opens: 11,
      installs: 10,
      reinstalls: 9,
      reactivations: 8,
      invitedUsers: 7,
      timeSpent: 60,
      revenue: 1299,
    });
  });
});
