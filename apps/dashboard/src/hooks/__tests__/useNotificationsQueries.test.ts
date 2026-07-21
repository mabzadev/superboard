import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import { useNotificationsQuery } from "../queries/useNotificationsQueries";
import type { GetMessagingParams } from "@/types";

vi.mock("@/api/notifications/notificationService", () => ({
  getNotificationsAPICall: vi.fn(),
}));

import { getNotificationsAPICall } from "@/api/notifications/notificationService";

const mockedGetNotifications = vi.mocked(getNotificationsAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useNotificationsQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useNotificationsQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () =>
          useNotificationsQuery(undefined, { page: 1 } as GetMessagingParams),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(
        () => useNotificationsQuery("proj-1", null),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and transforms notifications data", async () => {
      mockedGetNotifications.mockResolvedValueOnce({
        data: {
          data: [{ id: "n1", title: "Hello" }],
          total_pages: 3,
          total_entries: 25,
        },
      } as never);

      const { result } = renderHook(
        () =>
          useNotificationsQuery("proj-1", { page: 1 } as GetMessagingParams),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        data: [{ id: "n1", title: "Hello" }],
        totalPages: 3,
        totalEntries: 25,
      });
    });
  });
});
