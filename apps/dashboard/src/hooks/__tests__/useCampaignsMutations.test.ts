import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCreateCampaignMutation,
  useUpdateCampaignMutation,
  useArchiveCampaignMutation,
} from "../mutations/useCampaignsMutations";

vi.mock("@/api/campaigns/campaignsService", () => ({
  createNewCampaignAPICall: vi.fn(),
  updateCampaignAPICall: vi.fn(),
  archiveCampaignAPICall: vi.fn(),
}));

import {
  createNewCampaignAPICall,
  updateCampaignAPICall,
  archiveCampaignAPICall,
} from "@/api/campaigns/campaignsService";

const mockedCreateCampaign = vi.mocked(createNewCampaignAPICall);
const mockedUpdateCampaign = vi.mocked(updateCampaignAPICall);
const mockedArchiveCampaign = vi.mocked(archiveCampaignAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useCampaignsMutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCreateCampaignMutation", () => {
    it("calls createNewCampaignAPICall with projectId and formData", async () => {
      mockedCreateCampaign.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(() => useCreateCampaignMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      const formData = { name: "Summer Sale", description: "Big discounts" };
      await act(async () => {
        await result.current.mutateAsync(formData);
      });

      expect(mockedCreateCampaign).toHaveBeenCalledWith("proj-1", formData);
    });

    it("invalidates project detail queries on success", async () => {
      mockedCreateCampaign.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useCreateCampaignMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ name: "Test" });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCreateCampaignMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync({ name: "Test" }).catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useUpdateCampaignMutation", () => {
    it("calls updateCampaignAPICall with projectId, campaignId and formData", async () => {
      mockedUpdateCampaign.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(() => useUpdateCampaignMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          campaignId: "camp-1",
          formData: { name: "Updated Campaign" },
        });
      });

      expect(mockedUpdateCampaign).toHaveBeenCalledWith("proj-1", "camp-1", {
        name: "Updated Campaign",
      });
    });

    it("invalidates project detail queries on success", async () => {
      mockedUpdateCampaign.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useUpdateCampaignMutation("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          campaignId: "camp-1",
          formData: { name: "Updated" },
        });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useUpdateCampaignMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current
          .mutateAsync({
            campaignId: "camp-1",
            formData: { name: "Updated" },
          })
          .catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useArchiveCampaignMutation", () => {
    it("calls archiveCampaignAPICall with projectId and campaignId", async () => {
      mockedArchiveCampaign.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(
        () => useArchiveCampaignMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("camp-1");
      });

      expect(mockedArchiveCampaign).toHaveBeenCalledWith("proj-1", "camp-1");
    });

    it("invalidates project detail queries on success", async () => {
      mockedArchiveCampaign.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useArchiveCampaignMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("camp-1");
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useArchiveCampaignMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("camp-1").catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
