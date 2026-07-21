import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCampaignsListQuery,
  useCampaignMetricsQuery,
} from "../queries/useCampaignsQueries";
import type { GetCampaignsParams, DateRangeQuery } from "@/types";

vi.mock("@/api/campaigns/campaignsService", () => ({
  getCampaignsAPICall: vi.fn(),
  getCampaignMetricsAPICall: vi.fn(),
}));

import {
  getCampaignsAPICall,
  getCampaignMetricsAPICall,
} from "@/api/campaigns/campaignsService";

const mockedGetCampaigns = vi.mocked(getCampaignsAPICall);
const mockedGetCampaignMetrics = vi.mocked(getCampaignMetricsAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useCampaignsQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCampaignsListQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useCampaignsListQuery(undefined, {
            page: 1,
          } as unknown as GetCampaignsParams),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockedGetCampaigns).not.toHaveBeenCalled();
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useCampaignsListQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and transforms campaigns data", async () => {
      mockedGetCampaigns.mockResolvedValueOnce({
        data: {
          data: [{ id: "c1", name: "Campaign 1" }],
          total_pages: 2,
          total_entries: 10,
        },
      } as never);

      const { result } = renderHook(
        () =>
          useCampaignsListQuery("proj-1", {
            page: 1,
          } as unknown as GetCampaignsParams),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.totalPages).toBe(2);
      expect(result.current.data?.totalEntries).toBe(10);
      expect(result.current.data?.data).toHaveLength(1);
    });
  });

  describe("useCampaignMetricsQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useCampaignMetricsQuery(undefined, {
            period: "7d",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches campaign metrics", async () => {
      const metrics = { total_clicks: 100 };
      mockedGetCampaignMetrics.mockResolvedValueOnce({
        data: { metrics },
      } as never);

      const { result } = renderHook(
        () =>
          useCampaignMetricsQuery("proj-1", {
            period: "7d",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(metrics);
    });
  });
});
