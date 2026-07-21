import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCreateSubscriptionMutation,
  useCancelSubscriptionMutation,
} from "../mutations/usePaymentsMutations";

vi.mock("@/api/payments/paymentsService", () => ({
  createSubscriptionAPICall: vi.fn(),
  cancelSubscriptionAPICall: vi.fn(),
}));

vi.mock("@/analytics", () => ({
  trackEvent: vi.fn(),
  EVENTS: {
    PURCHASE: "purchase",
  },
}));

import {
  createSubscriptionAPICall,
  cancelSubscriptionAPICall,
} from "@/api/payments/paymentsService";

import { trackEvent } from "@/analytics";

const mockedCreateSubscription = vi.mocked(createSubscriptionAPICall);
const mockedCancelSubscription = vi.mocked(cancelSubscriptionAPICall);
const mockedTrackEvent = vi.mocked(trackEvent);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("usePaymentsMutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCreateSubscriptionMutation", () => {
    it("calls createSubscriptionAPICall with instanceId", async () => {
      mockedCreateSubscription.mockResolvedValueOnce({
        data: { url: "https://stripe.com/checkout" },
      } as never);

      const { result } = renderHook(
        () => useCreateSubscriptionMutation("inst-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(mockedCreateSubscription).toHaveBeenCalledWith("inst-1");
    });

    it("tracks purchase event and invalidates subscription on success", async () => {
      mockedCreateSubscription.mockResolvedValueOnce({
        data: { url: "https://stripe.com/checkout" },
      } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCreateSubscriptionMutation("inst-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(mockedTrackEvent).toHaveBeenCalledWith("purchase", {
        instanceId: "inst-1",
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["payments", "subscription", "inst-1"],
      });
    });

    it("does not invalidate when instanceId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCreateSubscriptionMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync().catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useCancelSubscriptionMutation", () => {
    it("calls cancelSubscriptionAPICall with instanceId", async () => {
      mockedCancelSubscription.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(
        () => useCancelSubscriptionMutation("inst-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(mockedCancelSubscription).toHaveBeenCalledWith("inst-1");
    });

    it("invalidates subscription on success", async () => {
      mockedCancelSubscription.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCancelSubscriptionMutation("inst-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["payments", "subscription", "inst-1"],
      });
    });

    it("does not invalidate when instanceId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCancelSubscriptionMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync().catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
