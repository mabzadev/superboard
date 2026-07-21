import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useRedirectConfigQuery,
  useDomainConfigQuery,
} from "../queries/useConfigurationQueries";

vi.mock("@/api/configurations/redirect/configRedirectService", () => ({
  getProjectRedirectsAPICall: vi.fn(),
}));

vi.mock("@/api/configurations/domains/configDomainsService", () => ({
  getProjectDomainAPICall: vi.fn(),
}));

import { getProjectRedirectsAPICall } from "@/api/configurations/redirect/configRedirectService";
import { getProjectDomainAPICall } from "@/api/configurations/domains/configDomainsService";

const mockedGetRedirects = vi.mocked(getProjectRedirectsAPICall);
const mockedGetDomain = vi.mocked(getProjectDomainAPICall);

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe("useConfigurationQueries", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.clearAllMocks();
  });

  describe("useRedirectConfigQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(() => useRedirectConfigQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches redirect config", async () => {
      const config = { default_url: "https://example.com" };
      mockedGetRedirects.mockResolvedValueOnce({
        data: { redirect_config: config },
      } as never);

      const { result } = renderHook(() => useRedirectConfigQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(config);
    });
  });

  describe("useDomainConfigQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(() => useDomainConfigQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("fetches domain config", async () => {
      const domain = { subdomain: "myapp", custom_domain: null };
      mockedGetDomain.mockResolvedValueOnce({
        data: { domain },
      } as never);

      const { result } = renderHook(() => useDomainConfigQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(domain);
    });
  });
});
