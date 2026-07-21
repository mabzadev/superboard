import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useTopLinksQuery,
  useLinksViewsQuery,
  useMetricsOverviewQuery,
} from "../queries/useDashboardQueries";
import type { DateRangeQuery } from "@/types";

vi.mock("@/api/dashboard/dashboardService", () => ({
  getTopLinksAPICall: vi.fn(),
  getLinksViewsAPICall: vi.fn(),
  getMetricsOverviewAPICall: vi.fn(),
}));

import {
  getTopLinksAPICall,
  getLinksViewsAPICall,
  getMetricsOverviewAPICall,
} from "@/api/dashboard/dashboardService";

const mockedGetTopLinks = vi.mocked(getTopLinksAPICall);
const mockedGetLinksViews = vi.mocked(getLinksViewsAPICall);
const mockedGetMetricsOverview = vi.mocked(getMetricsOverviewAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useDashboardQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useTopLinksQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useTopLinksQuery(undefined, {
            from: "2024-01-01",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockedGetTopLinks).not.toHaveBeenCalled();
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(() => useTopLinksQuery("proj-1", null), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and returns top links", async () => {
      const links = [
        { id: "1", views: 100 },
        { id: "2", views: 50 },
      ];
      mockedGetTopLinks.mockResolvedValueOnce({
        data: { links },
      } as never);

      const { result } = renderHook(
        () =>
          useTopLinksQuery("proj-1", {
            from: "2024-01-01",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(links);
    });
  });

  describe("useLinksViewsQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useLinksViewsQuery(undefined, {
            from: "2024-01-01",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and returns metrics", async () => {
      const metrics = { total_views: 500, unique_views: 200 };
      mockedGetLinksViews.mockResolvedValueOnce({
        data: { metrics },
      } as never);

      const { result } = renderHook(
        () =>
          useLinksViewsQuery("proj-1", {
            from: "2024-01-01",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(metrics);
    });
  });

  describe("useMetricsOverviewQuery", () => {
    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useMetricsOverviewQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches metrics overview", async () => {
      const metrics = { clicks: 100, installs: 50 };
      mockedGetMetricsOverview.mockResolvedValueOnce({
        data: { metrics },
      } as never);

      const { result } = renderHook(
        () =>
          useMetricsOverviewQuery("proj-1", {
            period: "7d",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(metrics);
    });
  });
});
