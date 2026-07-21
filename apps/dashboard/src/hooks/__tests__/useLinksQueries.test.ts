import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useLinksListQuery,
  useLinksByIdsQuery,
  usePathAvailableQuery,
  useRandomPathQuery,
} from "../queries/useLinksQueries";
import type { GetLinksParams } from "@/types";

vi.mock("@/api/links/linksService", () => ({
  getProjectLinksAPICall: vi.fn(),
  getLinksByIdAPICall: vi.fn(),
  availablePathAPICall: vi.fn(),
  getRandomPathAPICall: vi.fn(),
}));

import {
  getProjectLinksAPICall,
  getLinksByIdAPICall,
  availablePathAPICall,
  getRandomPathAPICall,
} from "@/api/links/linksService";

const mockedGetProjectLinks = vi.mocked(getProjectLinksAPICall);
const mockedGetLinksById = vi.mocked(getLinksByIdAPICall);
const mockedAvailablePath = vi.mocked(availablePathAPICall);
const mockedGetRandomPath = vi.mocked(getRandomPathAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useLinksQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useLinksListQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () => useLinksListQuery(undefined, { page: 1 } as GetLinksParams),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockedGetProjectLinks).not.toHaveBeenCalled();
    });

    it("is disabled when params is null", () => {
      const { result } = renderHook(() => useLinksListQuery("proj-1", null), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockedGetProjectLinks).not.toHaveBeenCalled();
    });

    it("fetches and transforms links data", async () => {
      mockedGetProjectLinks.mockResolvedValueOnce({
        data: {
          links: [{ id: "l1", name: "Link 1" }],
          meta: { total_pages: 3, total_entries: 25 },
        },
      } as never);

      const { result } = renderHook(
        () => useLinksListQuery("proj-1", { page: 1 } as GetLinksParams),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({
        data: [{ id: "l1", name: "Link 1" }],
        totalPages: 3,
        totalEntries: 25,
      });
      expect(mockedGetProjectLinks).toHaveBeenCalledWith("proj-1", { page: 1 });
    });
  });

  describe("useLinksByIdsQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () => useLinksByIdsQuery(undefined, { ids: ["1"] }),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when ids is null", () => {
      const { result } = renderHook(() => useLinksByIdsQuery("proj-1", null), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches links by ids", async () => {
      mockedGetLinksById.mockResolvedValueOnce({
        data: { links: [{ id: "l1" }, { id: "l2" }] },
      } as never);

      const { result } = renderHook(
        () => useLinksByIdsQuery("proj-1", { ids: ["l1", "l2"] }),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([{ id: "l1" }, { id: "l2" }]);
    });
  });

  describe("usePathAvailableQuery", () => {
    it("is disabled when path is empty string", () => {
      const { result } = renderHook(() => usePathAvailableQuery("proj-1", ""), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(
        () => usePathAvailableQuery(undefined, "my-path"),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches path availability", async () => {
      mockedAvailablePath.mockResolvedValueOnce({
        data: { available: true },
      } as never);

      const { result } = renderHook(
        () => usePathAvailableQuery("proj-1", "my-path"),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe(true);
      expect(mockedAvailablePath).toHaveBeenCalledWith("proj-1", "my-path");
    });
  });

  describe("useRandomPathQuery", () => {
    it("is disabled by default", () => {
      const { result } = renderHook(() => useRandomPathQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("is disabled when projectId is undefined even if enabled is true", () => {
      const { result } = renderHook(() => useRandomPathQuery(undefined, true), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches random path when enabled", async () => {
      mockedGetRandomPath.mockResolvedValueOnce({
        data: { valid_path: "abc-xyz-123" },
      } as never);

      const { result } = renderHook(() => useRandomPathQuery("proj-1", true), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe("abc-xyz-123");
    });
  });
});
