import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

vi.mock("@/api/migrations/migrationsService", () => ({
  createMigrationAPICall: vi.fn(() =>
    Promise.resolve({ data: { migration_source: {}, custom_domain: {} } })
  ),
  createMigrationSourceAPICall: vi.fn(() =>
    Promise.resolve({ data: { migration_source: {} } })
  ),
  updateMigrationSourceAPICall: vi.fn(() =>
    Promise.resolve({ data: { migration_source: {} } })
  ),
  deleteMigrationSourceAPICall: vi.fn(() =>
    Promise.resolve({ data: { message: "ok" } })
  ),
  testMigrationSourceAPICall: vi.fn(() =>
    Promise.resolve({
      data: { outcome: "credentials_ok", http_status: 404 },
    })
  ),
}));

import {
  useCreateMigrationSourceMutation,
  useCreateMigrationMutation,
  useUpdateMigrationSourceMutation,
  useDeleteMigrationSourceMutation,
  useTestMigrationSourceMutation,
} from "@/hooks/mutations/useMigrationMutations";
import {
  createMigrationSourceAPICall,
  createMigrationAPICall,
  updateMigrationSourceAPICall,
  deleteMigrationSourceAPICall,
  testMigrationSourceAPICall,
} from "@/api/migrations/migrationsService";
import { queryKeys } from "@/lib/queryKeys";

function wrap(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("migration mutations", () => {
  let client: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
  });

  it("create calls API and invalidates broad project key", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => useCreateMigrationSourceMutation("p1"),
      { wrapper: wrap(client) }
    );

    await act(async () => {
      await result.current.mutateAsync({
        provider: "branch",
        old_host: "old.example.com",
        credentials: { branch_key: "key_live_abc" },
      });
    });

    expect(createMigrationSourceAPICall).toHaveBeenCalledWith("p1", {
      provider: "branch",
      old_host: "old.example.com",
      credentials: { branch_key: "key_live_abc" },
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.detail("p1"),
    });
  });

  it("create migration calls API and invalidates broad project key", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useCreateMigrationMutation("p1"), {
      wrapper: wrap(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        provider: "branch",
        hostname: "old.example.com",
        credentials: { branch_key: "key_live_abc" },
      });
    });

    expect(createMigrationAPICall).toHaveBeenCalledWith("p1", {
      provider: "branch",
      hostname: "old.example.com",
      credentials: { branch_key: "key_live_abc" },
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.detail("p1"),
    });
  });

  it("update calls API and invalidates broad project key", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => useUpdateMigrationSourceMutation("p1"),
      { wrapper: wrap(client) }
    );

    await act(async () => {
      await result.current.mutateAsync({ enabled: false });
    });

    expect(updateMigrationSourceAPICall).toHaveBeenCalledWith("p1", {
      enabled: false,
    });
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.detail("p1"),
    });
  });

  it("delete calls API and invalidates broad project key", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(
      () => useDeleteMigrationSourceMutation("p1"),
      { wrapper: wrap(client) }
    );

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    expect(deleteMigrationSourceAPICall).toHaveBeenCalledWith("p1");
    expect(spy).toHaveBeenCalledWith({
      queryKey: queryKeys.projects.detail("p1"),
    });
  });

  it("test calls API but does not invalidate (probe is read-only)", async () => {
    const spy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useTestMigrationSourceMutation("p1"), {
      wrapper: wrap(client),
    });

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    expect(testMigrationSourceAPICall).toHaveBeenCalledWith("p1", undefined);
    expect(spy).not.toHaveBeenCalled();
  });

  it("create rejects with 'No project selected' when projectId is undefined", async () => {
    const { result } = renderHook(
      () => useCreateMigrationSourceMutation(undefined),
      { wrapper: wrap(client) }
    );

    await expect(
      result.current.mutateAsync({
        provider: "branch",
        old_host: "old.example.com",
        credentials: { branch_key: "k" },
      })
    ).rejects.toThrow("No project selected");
    expect(createMigrationSourceAPICall).not.toHaveBeenCalled();
  });

  it("update rejects with 'No project selected' when projectId is undefined", async () => {
    const { result } = renderHook(
      () => useUpdateMigrationSourceMutation(undefined),
      { wrapper: wrap(client) }
    );

    await expect(result.current.mutateAsync({ enabled: true })).rejects.toThrow(
      "No project selected"
    );
    expect(updateMigrationSourceAPICall).not.toHaveBeenCalled();
  });

  it("delete rejects with 'No project selected' when projectId is undefined", async () => {
    const { result } = renderHook(
      () => useDeleteMigrationSourceMutation(undefined),
      { wrapper: wrap(client) }
    );

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow(
      "No project selected"
    );
    expect(deleteMigrationSourceAPICall).not.toHaveBeenCalled();
  });

  it("test rejects with 'No project selected' when projectId is undefined", async () => {
    const { result } = renderHook(
      () => useTestMigrationSourceMutation(undefined),
      { wrapper: wrap(client) }
    );

    await expect(result.current.mutateAsync(undefined)).rejects.toThrow(
      "No project selected"
    );
    expect(testMigrationSourceAPICall).not.toHaveBeenCalled();
  });
});
