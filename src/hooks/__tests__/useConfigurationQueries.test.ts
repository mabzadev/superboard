import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { createTestQueryClient } from "./query-test-utils";
import {
  useRedirectConfigQuery,
  useDomainConfigQuery,
  useCustomDomainQuery,
  customDomainRefetchInterval,
} from "../queries/useConfigurationQueries";

vi.mock("@/api/configurations/redirect/configRedirectService", () => ({
  getProjectRedirectsAPICall: vi.fn(),
}));

vi.mock("@/api/configurations/domains/configDomainsService", () => ({
  getProjectDomainAPICall: vi.fn(),
  getDomainDefaultsAPICall: vi.fn(),
  getCustomDomainAPICall: vi.fn(),
}));

import { getProjectRedirectsAPICall } from "@/api/configurations/redirect/configRedirectService";
import {
  getProjectDomainAPICall,
  getCustomDomainAPICall,
} from "@/api/configurations/domains/configDomainsService";
import { ApiError } from "@/lib/ApiError";

const mockedGetRedirects = vi.mocked(getProjectRedirectsAPICall);
const mockedGetDomain = vi.mocked(getProjectDomainAPICall);
const mockedGetCustomDomain = vi.mocked(getCustomDomainAPICall);

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

  describe("customDomainRefetchInterval", () => {
    const baseDomain = {
      purpose: "primary" as const,
      ssl_status: null,
      verification_errors: null,
      source: "saas" as const,
    };

    it("polls every 30s while pending", () => {
      expect(
        customDomainRefetchInterval({
          ...baseDomain,
          hostname: "links.acme.com",
          status: "pending",
          cname_target: "x.cdn.example",
        })
      ).toBe(30000);
    });

    it("stops polling when active, failed, or null", () => {
      expect(
        customDomainRefetchInterval({
          ...baseDomain,
          hostname: "links.acme.com",
          status: "active",
          cname_target: "x.cdn.example",
        })
      ).toBe(false);
      expect(
        customDomainRefetchInterval({
          ...baseDomain,
          hostname: "links.acme.com",
          status: "failed",
          cname_target: "x.cdn.example",
        })
      ).toBe(false);
      expect(customDomainRefetchInterval(null)).toBe(false);
      expect(customDomainRefetchInterval(undefined)).toBe(false);
    });
  });

  describe("useCustomDomainQuery", () => {
    it("is disabled when projectId is undefined", () => {
      const { result } = renderHook(() => useCustomDomainQuery(undefined), {
        wrapper: createWrapper(queryClient),
      });
      expect(result.current.fetchStatus).toBe("idle");
    });

    it("unwraps the custom_domain object", async () => {
      const domain = {
        hostname: "links.acme.com",
        status: "pending",
        cname_target: "abc.cdn.example",
      };
      mockedGetCustomDomain.mockResolvedValueOnce({
        data: { custom_domain: domain },
      } as never);

      const { result } = renderHook(() => useCustomDomainQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(domain);
    });

    it("returns null for the None state", async () => {
      mockedGetCustomDomain.mockResolvedValueOnce({
        data: { custom_domain: null },
      } as never);

      const { result } = renderHook(() => useCustomDomainQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBeNull();
    });

    it("does not retry on a 404 from the GET", async () => {
      mockedGetCustomDomain.mockRejectedValueOnce(
        new ApiError("not found", 404)
      );

      const { result } = renderHook(() => useCustomDomainQuery("proj-1"), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(mockedGetCustomDomain).toHaveBeenCalledTimes(1);
    });
  });
});
