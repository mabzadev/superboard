import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCreateLinkMutation,
  useUpdateLinkMutation,
  useRemoveLinkMutation,
} from "../mutations/useLinksMutations";

vi.mock("@/api/links/linksService", () => ({
  createNewLinkAPICall: vi.fn(),
  updateLinkAPICall: vi.fn(),
  removeLinkAPICall: vi.fn(),
}));

import {
  createNewLinkAPICall,
  updateLinkAPICall,
  removeLinkAPICall,
} from "@/api/links/linksService";

const mockedCreateLink = vi.mocked(createNewLinkAPICall);
const mockedUpdateLink = vi.mocked(updateLinkAPICall);
const mockedRemoveLink = vi.mocked(removeLinkAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useLinksMutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCreateLinkMutation", () => {
    it("calls createNewLinkAPICall with projectId and formData", async () => {
      mockedCreateLink.mockResolvedValueOnce({
        data: { id: "new-link" },
      } as never);

      const { result } = renderHook(() => useCreateLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: "Test Link",
        } as unknown as FormData);
      });

      expect(mockedCreateLink).toHaveBeenCalledWith("proj-1", {
        name: "Test Link",
      });
    });

    it("invalidates project detail queries on success", async () => {
      mockedCreateLink.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useCreateLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: "New",
        } as unknown as FormData);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useCreateLinkMutation(undefined), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current
          .mutateAsync({
            name: "New",
          } as unknown as FormData)
          .catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useUpdateLinkMutation", () => {
    it("calls updateLinkAPICall with projectId, linkId and formData", async () => {
      mockedUpdateLink.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(() => useUpdateLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          linkId: "link-1",
          formData: { name: "Updated" } as unknown as FormData,
        });
      });

      expect(mockedUpdateLink).toHaveBeenCalledWith("proj-1", "link-1", {
        name: "Updated",
      });
    });

    it("invalidates project detail queries on success", async () => {
      mockedUpdateLink.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useUpdateLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          linkId: "l1",
          formData: {} as unknown as FormData,
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });
  });

  describe("useRemoveLinkMutation", () => {
    it("calls removeLinkAPICall with projectId and linkId", async () => {
      mockedRemoveLink.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(() => useRemoveLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("link-1");
      });

      expect(mockedRemoveLink).toHaveBeenCalledWith("proj-1", "link-1");
    });

    it("invalidates project detail queries on success", async () => {
      mockedRemoveLink.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useRemoveLinkMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("link-1");
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });
  });
});
