import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useInstancesQuery,
  useInstanceDetailsQuery,
  useInstanceMembersQuery,
  useInstanceConfigQuery,
  useInstanceUserRoleQuery,
  useSetupProgressQuery,
} from "../queries/useInstanceQueries";

vi.mock("@/api/instances/instanceService", () => ({
  getInstancesAPICall: vi.fn(),
  instanceDetailsAPICall: vi.fn(),
  getMembersForInstanceAPICall: vi.fn(),
  currentUserRoleForInstanceAPICall: vi.fn(),
  getSetupProgressAPICall: vi.fn(),
}));

vi.mock("@/api/applications/configApplicationsService", () => ({
  getProjectConfigurationAPICall: vi.fn(),
  getGoogleConfigurationsScriptAPICall: vi.fn(),
}));

import {
  getInstancesAPICall,
  instanceDetailsAPICall,
  getMembersForInstanceAPICall,
  currentUserRoleForInstanceAPICall,
  getSetupProgressAPICall,
} from "@/api/instances/instanceService";
import { getProjectConfigurationAPICall } from "@/api/applications/configApplicationsService";

const mockedGetInstances = vi.mocked(getInstancesAPICall);
const mockedInstanceDetails = vi.mocked(instanceDetailsAPICall);
const mockedGetMembers = vi.mocked(getMembersForInstanceAPICall);
const mockedUserRole = vi.mocked(currentUserRoleForInstanceAPICall);
const mockedSetupProgress = vi.mocked(getSetupProgressAPICall);
const mockedGetConfig = vi.mocked(getProjectConfigurationAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useInstanceQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useInstancesQuery", () => {
    it("fetches and sorts instances by updated_at descending", async () => {
      const instances = [
        { id: "1", updated_at: "2024-01-01" },
        { id: "2", updated_at: "2024-06-01" },
      ];
      mockedGetInstances.mockResolvedValueOnce({
        data: { instances },
      } as never);

      const { result } = renderHook(() => useInstancesQuery(), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0]?.id).toBe("2");
      expect(result.current.data?.[1]?.id).toBe("1");
    });
  });

  describe("useInstanceDetailsQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useInstanceDetailsQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
      expect(mockedInstanceDetails).not.toHaveBeenCalled();
    });

    it("fetches instance details", async () => {
      const details = { id: "inst-1", name: "My App" };
      mockedInstanceDetails.mockResolvedValueOnce({
        data: details,
      } as never);

      const { result } = renderHook(() => useInstanceDetailsQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(details);
    });
  });

  describe("useInstanceMembersQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useInstanceMembersQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches members", async () => {
      const members = [{ email: "a@b.com", role: "admin" }];
      mockedGetMembers.mockResolvedValueOnce({
        data: members,
      } as never);

      const { result } = renderHook(() => useInstanceMembersQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(members);
    });
  });

  describe("useInstanceConfigQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useInstanceConfigQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches and returns configurations", async () => {
      const configs = { ios: { bundle_id: "com.test" } };
      mockedGetConfig.mockResolvedValueOnce({
        data: { configurations: configs },
      } as never);

      const { result } = renderHook(() => useInstanceConfigQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(configs);
    });
  });

  describe("useInstanceUserRoleQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(() => useInstanceUserRoleQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("returns role string", async () => {
      mockedUserRole.mockResolvedValueOnce({
        data: { role: "admin" },
      } as never);

      const { result } = renderHook(() => useInstanceUserRoleQuery("inst-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe("admin");
    });
  });

  describe("useSetupProgressQuery", () => {
    it("is disabled when instanceId is undefined", () => {
      const { result } = renderHook(
        () => useSetupProgressQuery(undefined, "ios"),
        { wrapper: createWrapper(queryClient) }
      );
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches setup progress data", async () => {
      const progressData = { completed_steps: ["step1"] };
      mockedSetupProgress.mockResolvedValueOnce({
        data: progressData,
      } as never);

      const { result } = renderHook(
        () => useSetupProgressQuery("inst-1", "ios"),
        { wrapper: createWrapper(queryClient) }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(progressData);
    });
  });
});
