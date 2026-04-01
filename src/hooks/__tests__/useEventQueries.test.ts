import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useEventsSearchQuery,
  useEventsSortedQuery,
  useMetricValuesQuery,
  useEventsOverviewQuery,
  useEventsPaymentQuery,
} from "../queries/useEventQueries";
import type {
  EventsSearchPayload,
  EventsSortedPayload,
  DateRangeQuery,
} from "@/types";

vi.mock("@/api/events/eventsService", () => ({
  getEventsForSearchParamsAPICall: vi.fn(),
  getEventsSortedByParamsAPICall: vi.fn(),
  getMetricsValuesForEventsAPICall: vi.fn(),
  getEventsForOverviewAPICall: vi.fn(),
  getEventsForPaymentScreenAPICall: vi.fn(),
  downloadLinksAsCSVAPICall: vi.fn(),
}));

import {
  getEventsForSearchParamsAPICall,
  getEventsSortedByParamsAPICall,
  getMetricsValuesForEventsAPICall,
  getEventsForOverviewAPICall,
  getEventsForPaymentScreenAPICall,
} from "@/api/events/eventsService";

const mockedSearchEvents = vi.mocked(getEventsForSearchParamsAPICall);
const mockedSortedEvents = vi.mocked(getEventsSortedByParamsAPICall);
const mockedMetricValues = vi.mocked(getMetricsValuesForEventsAPICall);
const mockedOverview = vi.mocked(getEventsForOverviewAPICall);
const mockedPayment = vi.mocked(getEventsForPaymentScreenAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useEventQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useEventsSearchQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useEventsSearchQuery(undefined, {
            search: "click",
          } as unknown as EventsSearchPayload),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useEventsSearchQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and transforms events search data", async () => {
      mockedSearchEvents.mockResolvedValueOnce({
        data: {
          events: [{ id: "e1", name: "click" }],
          meta: { total_pages: 2, total_entries: 15 },
        },
      } as never);

      const { result } = renderHook(
        () =>
          useEventsSearchQuery("proj-1", {
            search: "click",
          } as unknown as EventsSearchPayload),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        events: [{ id: "e1", name: "click" }],
        totalPages: 2,
        totalEntries: 15,
      });
    });
  });

  describe("useEventsSortedQuery", () => {
    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useEventsSortedQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches sorted events", async () => {
      const events = [{ id: "e1" }, { id: "e2" }];
      mockedSortedEvents.mockResolvedValueOnce({
        data: { events },
      } as never);

      const { result } = renderHook(
        () =>
          useEventsSortedQuery("proj-1", {
            sort: "date",
          } as unknown as EventsSortedPayload),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(events);
    });
  });

  describe("useMetricValuesQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(() => useMetricValuesQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches metric values", async () => {
      const metrics = { clicks: 100, installs: 50 };
      mockedMetricValues.mockResolvedValueOnce({
        data: { metrics_values: metrics },
      } as never);

      const { result } = renderHook(() => useMetricValuesQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(metrics);
    });
  });

  describe("useEventsOverviewQuery", () => {
    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useEventsOverviewQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches overview events", async () => {
      const events = [{ id: "e1", type: "overview" }];
      mockedOverview.mockResolvedValueOnce({
        data: { events },
      } as never);

      const { result } = renderHook(
        () =>
          useEventsOverviewQuery("proj-1", {
            from: "2024-01-01",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(events);
    });
  });

  describe("useEventsPaymentQuery", () => {
    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useEventsPaymentQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches payment events", async () => {
      const metricsValues = { revenue: 500 };
      mockedPayment.mockResolvedValueOnce({
        data: { metrics_values: metricsValues },
      } as never);

      const { result } = renderHook(
        () =>
          useEventsPaymentQuery("proj-1", {
            period: "30d",
          } as unknown as DateRangeQuery),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(metricsValues);
    });
  });
});
