import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useProjectPurchasesQuery,
  useRevenueMetricsQuery,
} from "../queries/usePurchasesQueries";
import type { GetRevenueParams } from "@/types";

vi.mock("@/api/purchases/purchasesService", () => ({
  getProjectPurchasesAPICall: vi.fn(),
  getRevenueMetricsAPICall: vi.fn(),
}));

import {
  getProjectPurchasesAPICall,
  getRevenueMetricsAPICall,
} from "@/api/purchases/purchasesService";

const mockedGetPurchases = vi.mocked(getProjectPurchasesAPICall);
const mockedGetRevenue = vi.mocked(getRevenueMetricsAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("usePurchasesQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useProjectPurchasesQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useProjectPurchasesQuery(undefined, {
            page: 1,
          } as unknown as GetRevenueParams),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useProjectPurchasesQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and transforms purchases data", async () => {
      mockedGetPurchases.mockResolvedValueOnce({
        data: {
          data: [{ id: "p1", amount: 9.99 }],
          total_pages: 2,
        },
      } as never);

      const { result } = renderHook(
        () =>
          useProjectPurchasesQuery("proj-1", {
            page: 1,
          } as unknown as GetRevenueParams),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        data: [{ id: "p1", amount: 9.99 }],
        totalPages: 2,
      });
    });
  });

  describe("useRevenueMetricsQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useRevenueMetricsQuery(undefined, {
            period: "30d",
          } as unknown as GetRevenueParams),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches revenue metrics", async () => {
      mockedGetRevenue.mockResolvedValueOnce({
        data: {
          data: [{ metric: "revenue", value: 1000 }],
          total_pages: 1,
        },
      } as never);

      const { result } = renderHook(
        () =>
          useRevenueMetricsQuery("proj-1", {
            period: "30d",
          } as unknown as GetRevenueParams),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        data: [{ metric: "revenue", value: 1000 }],
        totalPages: 1,
        totalEntries: 10,
      });
    });
  });
});
