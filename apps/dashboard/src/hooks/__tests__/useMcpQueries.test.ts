import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useMcpTokensQuery,
  useRevokeMcpTokenMutation,
} from "../queries/useMcpQueries";
import { ApiError } from "@/lib/ApiError";

vi.mock("@/api/mcp/mcpService", () => ({
  listMcpTokensAPICall: vi.fn(),
  revokeMcpTokenAPICall: vi.fn(),
}));

import {
  listMcpTokensAPICall,
  revokeMcpTokenAPICall,
} from "@/api/mcp/mcpService";

const mockedListTokens = vi.mocked(listMcpTokensAPICall);
const mockedRevokeToken = vi.mocked(revokeMcpTokenAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useMcpQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useMcpTokensQuery", () => {
    it("fetches and returns tokens array", async () => {
      const tokens = [
        {
          id: "aBx9kZ",
          name: "Claude Desktop",
          created_at: "2026-04-01T12:00:00Z",
          last_used_at: "2026-04-07T15:30:00Z",
          expires_at: "2026-07-01T12:00:00Z",
        },
        {
          id: "cDy3mW",
          name: "Cursor",
          created_at: "2026-04-05T10:00:00Z",
          last_used_at: null,
          expires_at: "2026-07-05T10:00:00Z",
        },
      ];
      mockedListTokens.mockResolvedValueOnce({
        data: { tokens },
      } as never);

      const { result } = renderHook(() => useMcpTokensQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(tokens);
      expect(result.current.data?.[0]?.id).toBe("aBx9kZ");
      expect(result.current.data?.[1]?.last_used_at).toBeNull();
    });

    it("returns empty array when no tokens exist", async () => {
      mockedListTokens.mockResolvedValueOnce({
        data: { tokens: [] },
      } as never);

      const { result } = renderHook(() => useMcpTokensQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual([]);
    });

    it("propagates API errors", async () => {
      mockedListTokens.mockRejectedValueOnce(new ApiError("Unauthorized", 401));

      const { result } = renderHook(() => useMcpTokensQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(ApiError);
    });
  });

  describe("useRevokeMcpTokenMutation", () => {
    it("calls revokeMcpTokenAPICall with string hashid", async () => {
      mockedRevokeToken.mockResolvedValueOnce({
        data: { message: "Token revoked" },
      } as never);

      const { result } = renderHook(() => useRevokeMcpTokenMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("aBx9kZ");
      });

      expect(mockedRevokeToken).toHaveBeenCalledWith("aBx9kZ");
    });

    it("invalidates mcp.tokens cache on success", async () => {
      mockedRevokeToken.mockResolvedValueOnce({
        data: { message: "Token revoked" },
      } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useRevokeMcpTokenMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("aBx9kZ");
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["mcp", "tokens"],
      });
    });

    it("does not invalidate cache on failure", async () => {
      mockedRevokeToken.mockRejectedValueOnce(new ApiError("Not found", 404));
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useRevokeMcpTokenMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("bad-id").catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
