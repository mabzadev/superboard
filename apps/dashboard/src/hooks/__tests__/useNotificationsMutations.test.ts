import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useCreateNotificationMutation,
  useArchiveNotificationMutation,
} from "../mutations/useNotificationsMutations";
import type { CreateNotificationApiPayload } from "@/types";

vi.mock("@/api/notifications/notificationService", () => ({
  createNotificationsAPICall: vi.fn(),
  archiveNotificationsAPICall: vi.fn(),
}));

import {
  createNotificationsAPICall,
  archiveNotificationsAPICall,
} from "@/api/notifications/notificationService";

const mockedCreateNotification = vi.mocked(createNotificationsAPICall);
const mockedArchiveNotification = vi.mocked(archiveNotificationsAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useNotificationsMutations", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useCreateNotificationMutation", () => {
    it("calls createNotificationsAPICall with provided data", async () => {
      mockedCreateNotification.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(
        () => useCreateNotificationMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      const payload = {
        title: "Hello",
        body: "World",
      } as unknown as CreateNotificationApiPayload;
      await act(async () => {
        await result.current.mutateAsync(payload);
      });

      expect(mockedCreateNotification).toHaveBeenCalledWith(payload);
    });

    it("invalidates project detail queries on success", async () => {
      mockedCreateNotification.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCreateNotificationMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync({
          title: "Test",
        } as unknown as CreateNotificationApiPayload);
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      mockedCreateNotification.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useCreateNotificationMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync({
          title: "Test",
        } as unknown as CreateNotificationApiPayload);
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe("useArchiveNotificationMutation", () => {
    it("calls ArchiveNotificationsAPICall with projectId and notificationId", async () => {
      mockedArchiveNotification.mockResolvedValueOnce({ data: {} } as never);

      const { result } = renderHook(
        () => useArchiveNotificationMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("notif-1");
      });

      expect(mockedArchiveNotification).toHaveBeenCalledWith(
        "proj-1",
        "notif-1"
      );
    });

    it("invalidates project detail queries on success", async () => {
      mockedArchiveNotification.mockResolvedValueOnce({ data: {} } as never);
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useArchiveNotificationMutation("proj-1"),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("notif-1");
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "proj-1"],
      });
    });

    it("does not invalidate when projectId is undefined", async () => {
      const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

      const { result } = renderHook(
        () => useArchiveNotificationMutation(undefined),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.mutateAsync("notif-1").catch(() => {});
      });

      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
