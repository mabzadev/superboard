import { describe, it, expect } from "vitest";
import { queryKeys } from "../queryKeys";
import type {
  GetLinksParams,
  GetCampaignsParams,
  DateRangeQuery,
} from "@/types";

describe("queryKeys", () => {
  describe("projects", () => {
    it("builds hierarchical project keys", () => {
      expect(queryKeys.projects.all).toEqual(["projects"]);
      expect(queryKeys.projects.detail("p1")).toEqual(["projects", "p1"]);
    });

    it("includes params in feature keys", () => {
      const linksParams = {
        page: 1,
        search: "test",
      } as unknown as GetLinksParams;
      expect(queryKeys.projects.links("p1", linksParams)).toEqual([
        "projects",
        "p1",
        "links",
        linksParams,
      ]);
      const campaignsParams = {
        page: 1,
        search: "test",
      } as unknown as GetCampaignsParams;
      expect(queryKeys.projects.campaigns("p1", campaignsParams)).toEqual([
        "projects",
        "p1",
        "campaigns",
        campaignsParams,
      ]);
    });

    it("builds link-specific keys", () => {
      expect(queryKeys.projects.pathAvailable("p1", "my-path")).toEqual([
        "projects",
        "p1",
        "pathAvailable",
        "my-path",
      ]);
      expect(queryKeys.projects.randomPath("p1")).toEqual([
        "projects",
        "p1",
        "randomPath",
      ]);
      expect(queryKeys.projects.linksByIds("p1", { ids: ["1"] })).toEqual([
        "projects",
        "p1",
        "linksByIds",
        { ids: ["1"] },
      ]);
    });

    it("builds dashboard keys", () => {
      const params = { from: "2024-01-01" } as unknown as DateRangeQuery;
      expect(queryKeys.projects.topLinks("p1", params)).toEqual([
        "projects",
        "p1",
        "topLinks",
        params,
      ]);
      expect(queryKeys.projects.linksViews("p1", params)).toEqual([
        "projects",
        "p1",
        "linksViews",
        params,
      ]);
      expect(queryKeys.projects.metricsOverview("p1", params)).toEqual([
        "projects",
        "p1",
        "metricsOverview",
        params,
      ]);
    });

    it("builds visitor keys", () => {
      expect(queryKeys.projects.visitorDetails("p1", "v1")).toEqual([
        "projects",
        "p1",
        "visitorDetails",
        "v1",
      ]);
    });

    it("builds configuration keys", () => {
      expect(queryKeys.projects.redirectConfig("p1")).toEqual([
        "projects",
        "p1",
        "redirectConfig",
      ]);
      expect(queryKeys.projects.domainConfig("p1")).toEqual([
        "projects",
        "p1",
        "domainConfig",
      ]);
    });
  });

  describe("instances", () => {
    it("builds hierarchical instance keys", () => {
      expect(queryKeys.instances.all).toEqual(["instances"]);
      expect(queryKeys.instances.detail("i1")).toEqual(["instances", "i1"]);
    });

    it("builds instance sub-keys", () => {
      expect(queryKeys.instances.members("i1")).toEqual([
        "instances",
        "i1",
        "members",
      ]);
      expect(queryKeys.instances.config("i1")).toEqual([
        "instances",
        "i1",
        "config",
      ]);
      expect(queryKeys.instances.userRole("i1")).toEqual([
        "instances",
        "i1",
        "userRole",
      ]);
      expect(queryKeys.instances.setupProgress("i1", "ios")).toEqual([
        "instances",
        "i1",
        "setupProgress",
        "ios",
      ]);
    });
  });

  describe("payments", () => {
    it("builds payment keys", () => {
      expect(queryKeys.payments.subscription("i1")).toEqual([
        "payments",
        "subscription",
        "i1",
      ]);
      expect(queryKeys.payments.mau("i1")).toEqual(["payments", "mau", "i1"]);
      expect(queryKeys.payments.usage("i1")).toEqual([
        "payments",
        "usage",
        "i1",
      ]);
      expect(queryKeys.payments.dashboardUrl("i1")).toEqual([
        "payments",
        "dashboardUrl",
        "i1",
      ]);
    });
  });

  describe("user", () => {
    it("builds user keys", () => {
      expect(queryKeys.user.current).toEqual(["user", "current"]);
      expect(queryKeys.user.otpEnabled("test@test.com")).toEqual([
        "user",
        "otpEnabled",
        "test@test.com",
      ]);
      expect(queryKeys.user.otpQrCode).toEqual(["user", "otpQrCode"]);
    });
  });

  describe("key uniqueness", () => {
    it("different params produce different keys", () => {
      const key1 = queryKeys.projects.links("p1", {
        page: 1,
      } as unknown as GetLinksParams);
      const key2 = queryKeys.projects.links("p1", {
        page: 2,
      } as unknown as GetLinksParams);
      expect(key1).not.toEqual(key2);
    });

    it("different projects produce different keys", () => {
      const key1 = queryKeys.projects.links("p1", {
        page: 1,
      } as unknown as GetLinksParams);
      const key2 = queryKeys.projects.links("p2", {
        page: 1,
      } as unknown as GetLinksParams);
      expect(key1).not.toEqual(key2);
    });
  });
});
