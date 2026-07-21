import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useSubscriptionQuery,
  useMauQuery,
  useUsageQuery,
  useDashboardUrlQuery,
} from "../queries/usePaymentsQueries";
import { ApiError } from "@/lib/ApiError";

vi.mock("@/api/payments/paymentsService", () => ({
  getSubscriptionDetailsAPICall: vi.fn(),
  getCurrentMauAPICall: vi.fn(),
  getCurrentUsageAPICall: vi.fn(),
  getDashboardUrlAPICall: vi.fn(),
}));

import {
  getSubscriptionDetailsAPICall,
  getCurrentMauAPICall,
  getCurrentUsageAPICall,
  getDashboardUrlAPICall,
} from "@/api/payments/paymentsService";

const mockedGetSubscription = vi.mocked(getSubscriptionDetailsAPICall);
const mockedGetMau = vi.mocked(getCurrentMauAPICall);
const mockedGetUsage = vi.mocked(getCurrentUsageAPICall);
const mockedGetDashboardUrl = vi.mocked(getDashboardUrlAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("usePaymentsQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useSubscriptionQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useSubscriptionQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("returns subscription data with isEnterprise flag", async () => {
      mockedGetSubscription.mockResolvedValueOnce({
        data: { type: "enterprise", plan: "Pro" },
      } as never);

      const { result } = renderHook(() => useSubscriptionQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.isEnterprise).toBe(true);
      expect(result.current.data?.subscription).toEqual({
        type: "enterprise",
        plan: "Pro",
      });
    });

    it("returns non-enterprise for regular subscriptions", async () => {
      mockedGetSubscription.mockResolvedValueOnce({
        data: { type: "standard", plan: "Basic" },
      } as never);

      const { result } = renderHook(() => useSubscriptionQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.isEnterprise).toBe(false);
    });

    it("handles 404 gracefully by returning null subscription", async () => {
      mockedGetSubscription.mockRejectedValueOnce(
        new ApiError("Not found", 404)
      );

      const { result } = renderHook(() => useSubscriptionQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        subscription: null,
        isEnterprise: false,
      });
    });

    it("propagates non-404 errors", async () => {
      mockedGetSubscription.mockRejectedValueOnce(
        new ApiError("Server error", 500)
      );

      const { result } = renderHook(() => useSubscriptionQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(ApiError);
    });
  });

  describe("useMauQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useMauQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches MAU data", async () => {
      const mauData = { current_quantity: 5000, total_available: 10000 };
      mockedGetMau.mockResolvedValueOnce({ data: mauData } as never);

      const { result } = renderHook(() => useMauQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mauData);
    });
  });

  describe("useUsageQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useUsageQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches usage data", async () => {
      const usageData = { api_calls: 1000 };
      mockedGetUsage.mockResolvedValueOnce({ data: usageData } as never);

      const { result } = renderHook(() => useUsageQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(usageData);
    });
  });

  describe("useDashboardUrlQuery", () => {
    it("is disabled by default", () => {
      const { result } = renderHook(() => useDashboardUrlQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when instanceId is undefined even if enabled is true", () => {
      const { result } = renderHook(
        () => useDashboardUrlQuery(undefined, true),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches dashboard URL when enabled", async () => {
      mockedGetDashboardUrl.mockResolvedValueOnce({
        data: { url: "https://dashboard.example.com" },
      } as never);

      const { result } = renderHook(
        () => useDashboardUrlQuery("inst-1", true),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        url: "https://dashboard.example.com",
      });
    });
  });
});
