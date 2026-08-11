import { describe, expect, it, vi } from "vitest";

describe("Revenue columns", () => {
  const importTimeoutMs = 15000;
  const dummySort = { sortKey: "name", ascending: true };
  const dummySetSort = vi.fn();

  it("includes attributed revenue in link columns", async () => {
    const { getLinksTableColumns } =
      await import("@/components/dynamic_links/links/LinksTableColumns");
    const columns = getLinksTableColumns(dummySort, dummySetSort, vi.fn());
    expect(columns.map((column) => column.accessorKey)).toContain("revenue");
  }, importTimeoutMs);

  it("includes revenue in campaign columns", async () => {
    const { createCampaignsTableColumns } =
      await import("@/components/dynamic_links/campaigns/CampaignsTableColumns");
    const columns = createCampaignsTableColumns(dummySort, dummySetSort);
    expect(columns.map((column) => column.accessorKey)).toContain("revenue");
  }, importTimeoutMs);
});
