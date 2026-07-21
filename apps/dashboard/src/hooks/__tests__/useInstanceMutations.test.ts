import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCreateInstanceMutation,
  useEditInstanceMutation,
  useDeleteInstanceMutation,
  useAddMemberMutation,
  useRemoveMemberMutation,
  useCompleteSetupStepMutation,
} from "../mutations/useInstanceMutations";

vi.mock("@/api/instances/instanceService", () => ({
  createInstanceAPICall: vi.fn(),
  editInstanceAPICall: vi.fn(),
  deleteInstanceAPICall: vi.fn(),
  addMemberToInstanceAPICall: vi.fn(),
  removedMemberFromInstanceAPICall: vi.fn(),
  dismissGetStartedAPICall: vi.fn(),
  exportUsageApiCall: vi.fn(),
  setRevenueCollectionEnabledApiCall: vi.fn(),
  completeSetupStepAPICall: vi.fn(),
}));

vi.mock("@/api/applications/configApplicationsService", () => ({
  setIOSAppConfigAPICall: vi.fn(),
  setIOSPushConfigAPICall: vi.fn(),
  setAndroidAppConfigAPICall: vi.fn(),
  setAndroidPushConfigAPICall: vi.fn(),
  setAndroidAppWebhookAccessKeyAPICall: vi.fn(),
  setWebAppConfigAPICall: vi.fn(),
  setDesktopAppConfigAPICall: vi.fn(),
}));

import {
  createInstanceAPICall,
  editInstanceAPICall,
  deleteInstanceAPICall,
  addMemberToInstanceAPICall,
  removedMemberFromInstanceAPICall,
  completeSetupStepAPICall,
} from "@/api/instances/instanceService";

const mockedCreateInstance = vi.mocked(createInstanceAPICall);
const mockedEditInstance = vi.mocked(editInstanceAPICall);
const mockedDeleteInstance = vi.mocked(deleteInstanceAPICall);
const mockedAddMember = vi.mocked(addMemberToInstanceAPICall);
const mockedRemoveMember = vi.mocked(removedMemberFromInstanceAPICall);
const mockedCompleteStep = vi.mocked(completeSetupStepAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useInstanceMutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCreateInstanceMutation", () => {
    it("calls create API and invalidates instances", async () => {
      mockedCreateInstance.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useCreateInstanceMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          name: "New Project",
          members: [{ email: "test@test.com", role: "admin" }],
        });
      });

      expect(mockedCreateInstance).toHaveBeenCalledWith("New Project", [
        { email: "test@test.com", role: "admin" },
      ]);
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances"],
      });
    });
  });

  describe("useEditInstanceMutation", () => {
    it("calls edit API and invalidates instances", async () => {
      mockedEditInstance.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useEditInstanceMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({ id: "inst-1", name: "Renamed" });
      });

      expect(mockedEditInstance).toHaveBeenCalledWith("inst-1", "Renamed");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances"],
      });
    });
  });

  describe("useDeleteInstanceMutation", () => {
    it("calls delete API and invalidates instances", async () => {
      mockedDeleteInstance.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useDeleteInstanceMutation(), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("inst-1");
      });

      expect(mockedDeleteInstance).toHaveBeenCalledWith("inst-1");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances"],
      });
    });
  });

  describe("useAddMemberMutation", () => {
    it("calls add member API and invalidates members", async () => {
      mockedAddMember.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useAddMemberMutation("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync({
          email: "new@test.com",
          role: "member",
        });
      });

      expect(mockedAddMember).toHaveBeenCalledWith(
        "inst-1",
        "new@test.com",
        "member"
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances", "inst-1", "members"],
      });
    });

    it("does not invalidate when instanceId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useAddMemberMutation(undefined), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current
          .mutateAsync({
            email: "new@test.com",
            role: "member",
          })
          .catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useRemoveMemberMutation", () => {
    it("calls remove member API and invalidates members", async () => {
      mockedRemoveMember.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(() => useRemoveMemberMutation("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.mutateAsync("old@test.com");
      });

      expect(mockedRemoveMember).toHaveBeenCalledWith("inst-1", "old@test.com");
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances", "inst-1", "members"],
      });
    });
  });

  describe("useCompleteSetupStepMutation", () => {
    it("calls complete step API and invalidates setup progress", async () => {
      mockedCompleteStep.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCompleteSetupStepMutation("inst-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync({
          category: "ios",
          stepIdentifier: "bundle_id",
        });
      });

      expect(mockedCompleteStep).toHaveBeenCalledWith(
        "inst-1",
        "ios",
        "bundle_id"
      );
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["instances", "inst-1", "setupProgress", "ios"],
      });
    });
  });
});
