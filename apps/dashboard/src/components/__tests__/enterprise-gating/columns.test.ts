import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests that the revenue column is present/absent in table column definitions
 * based on IS_ENTERPRISE. These catch the real bug: someone removes an
 * IS_ENTERPRISE guard and revenue columns leak into community builds.
 */

describe("Revenue column gating", () => {
  const importTimeoutMs = 15000;

  beforeEach(() => {
    vi.resetModules();
  });

  const dummySort = { sortKey: "name", ascending: true };
  const dummySetSort = vi.fn();

  describe("LinksTableColumns", () => {
    it("includes revenue column when IS_ENTERPRISE is true", async () => {
      vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: true }));
      const { getLinksTableColumns } =
        await import("@/components/dynamic_links/links/LinksTableColumns");
      const columns = getLinksTableColumns(dummySort, dummySetSort, vi.fn());
      const keys = columns.map((c) => c.accessorKey);
      expect(keys).toContain("revenue");
    }, importTimeoutMs);

    it("excludes revenue column when IS_ENTERPRISE is false", async () => {
      vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: false }));
      const { getLinksTableColumns } =
        await import("@/components/dynamic_links/links/LinksTableColumns");
      const columns = getLinksTableColumns(dummySort, dummySetSort, vi.fn());
      const keys = columns.map((c) => c.accessorKey);
      expect(keys).not.toContain("revenue");
    }, importTimeoutMs);
  });

  describe("CampaignsTableColumns", () => {
    it("includes revenue column when IS_ENTERPRISE is true", async () => {
      vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: true }));
      const { createCampaignsTableColumns } =
        await import("@/components/dynamic_links/campaigns/CampaignsTableColumns");
      const columns = createCampaignsTableColumns(dummySort, dummySetSort);
      const keys = columns.map((c) => c.accessorKey);
      expect(keys).toContain("revenue");
    }, importTimeoutMs);

    it("excludes revenue column when IS_ENTERPRISE is false", async () => {
      vi.doMock("@/lib/edition", () => ({ IS_ENTERPRISE: false }));
      const { createCampaignsTableColumns } =
        await import("@/components/dynamic_links/campaigns/CampaignsTableColumns");
      const columns = createCampaignsTableColumns(dummySort, dummySetSort);
      const keys = columns.map((c) => c.accessorKey);
      expect(keys).not.toContain("revenue");
    }, importTimeoutMs);
  });
});
