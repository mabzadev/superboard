import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  config: { apiPath: "/api/v1" },
}));
import {
  toCampaignAnalytics,
  type LinkCampaign,
  type LinkStatistics,
  type DynamicLink,
} from "../dynamicLinksService";
import { toLinkData } from "@/components/dynamic_links/links/linkAnalytics";

describe("Dynamic Links analytics mapping", () => {
  it("maps every canonical campaign metric without losing zero values", () => {
    const campaign: LinkCampaign = {
      id: "campaign-1",
      name: "Launch",
      slug: "launch",
      status: "active",
      metadata: {},
      created_at: "2026-08-01T12:00:00.000Z",
    };
    const statistics: LinkStatistics = {
      totals: {
        views: 101,
        opens: 91,
        installs: 81,
        reinstalls: 71,
        reactivations: 61,
        app_opens: 51,
        user_referred: 41,
        revenue: 3199,
      },
      series: [],
    };

    expect(toCampaignAnalytics(campaign, statistics)).toMatchObject({
      total_views: 101,
      total_opens: 91,
      total_installs: 81,
      total_reinstalls: 71,
      total_reactivations: 61,
      total_app_opens: 51,
      total_user_referred: 41,
      total_revenue: 3199,
    });
  });

  it("maps all link aggregates, routing data, tags and tracking fields", () => {
    const link: DynamicLink = {
      id: "link-1",
      slug: "summer",
      name: "Summer",
      destination_url: "https://example.com",
      destinations: { ios: "https://example.com/ios" },
      campaign_id: "campaign-1",
      title: "Summer title",
      subtitle: "Summer subtitle",
      image_url: "https://example.com/image.png",
      utm: {
        source: "meta",
        medium: "paid",
        campaign: "summer",
        tags: "paid,retargeting",
      },
      active: true,
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-02T12:00:00.000Z",
      total_views: 10,
      total_opens: 9,
      total_installs: 8,
      total_reinstalls: 7,
      total_reactivations: 6,
      total_app_opens: 5,
      total_user_referred: 4,
      total_time_spent: 321,
      total_revenue: 2999,
    };

    expect(toLinkData(link)).toMatchObject({
      path: "summer",
      ads_platform: "meta",
      tags: ["paid", "retargeting"],
      total_views: 10,
      total_opens: 9,
      total_installs: 8,
      total_reinstalls: 7,
      total_reactivations: 6,
      total_app_opens: 5,
      total_user_referred: 4,
      total_time_spent: 321,
      total_revenue: 2999,
      tracking_source: "meta",
      tracking_medium: "paid",
      tracking_campaign: "summer",
    });
  });
});
