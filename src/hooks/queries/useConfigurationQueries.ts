import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { isCustomDomainInFlight } from "@/lib/customDomainStatus";
import { getProjectRedirectsAPICall } from "@/api/configurations/redirect/configRedirectService";
import {
  getProjectDomainAPICall,
  getDomainDefaultsAPICall,
  getCustomDomainAPICall,
  getCustomDomainsAPICall,
  getCustomDomainPreflightAPICall,
} from "@/api/configurations/domains/configDomainsService";
import type {
  RedirectConfig,
  DomainConfig,
  DomainDefaults,
  CustomDomain,
  CustomDomainPreflight,
} from "@/types";

const CUSTOM_DOMAIN_POLL_MS = 30000;
const CUSTOM_DOMAINS_POLL_MS = 45000;
const MIGRATION_CUSTOM_DOMAINS_POLL_MS = 15000;

export function customDomainRefetchInterval(
  data: CustomDomain | null | undefined
): number | false {
  return data && isCustomDomainInFlight(data.status)
    ? CUSTOM_DOMAIN_POLL_MS
    : false;
}

export function customDomainsRefetchInterval(
  data: CustomDomain[] | undefined
): number | false {
  if (!data || data.length === 0) return false;
  const inflightMigration = data.some(
    (d) =>
      d.purpose === "migration" &&
      (d.ssl_status === "pending_validation" ||
        d.ssl_status === "pending_deployment" ||
        isCustomDomainInFlight(d.status))
  );
  if (inflightMigration) return MIGRATION_CUSTOM_DOMAINS_POLL_MS;
  const inflightPrimary = data.some(
    (d) => d.purpose !== "migration" && isCustomDomainInFlight(d.status)
  );
  return inflightPrimary ? CUSTOM_DOMAINS_POLL_MS : false;
}

export function normalizeCustomDomainPreflight(
  data:
    | CustomDomainPreflight
    | { preflight?: CustomDomainPreflight | null }
    | undefined
): CustomDomainPreflight | null {
  if (!data) return null;
  if ("preflight" in data) {
    // Validate the envelope payload the same way as the flat shape — a
    // partial object (no boolean cname_matches) must read as "no preflight",
    // not as "known not pointed".
    const candidate = data.preflight;
    if (
      candidate &&
      typeof candidate.hostname === "string" &&
      typeof candidate.cname_matches === "boolean"
    ) {
      return candidate;
    }
    return null;
  }
  const candidate = data as Record<string, unknown>;
  if (
    typeof candidate.hostname === "string" &&
    typeof candidate.cname_matches === "boolean"
  ) {
    return data as CustomDomainPreflight;
  }
  return null;
}

export function useRedirectConfigQuery(projectId: string | undefined) {
  return useQuery<RedirectConfig>({
    queryKey: queryKeys.projects.redirectConfig(projectId!),
    queryFn: async () => {
      const response = await getProjectRedirectsAPICall(projectId!);
      return response.data.redirect_config;
    },
    enabled: !!projectId,
  });
}

export function useDomainConfigQuery(projectId: string | undefined) {
  return useQuery<DomainConfig>({
    queryKey: queryKeys.projects.domainConfig(projectId!),
    queryFn: async () => {
      const response = await getProjectDomainAPICall(projectId!);
      return response.data.domain;
    },
    enabled: !!projectId,
  });
}

export function useDomainDefaultsQuery(projectId: string | undefined) {
  return useQuery<DomainDefaults>({
    queryKey: queryKeys.projects.domainDefaults(projectId!),
    queryFn: async () => {
      const response = await getDomainDefaultsAPICall(projectId!);
      return response.data;
    },
    enabled: !!projectId,
    staleTime: Infinity,
  });
}

export function useCustomDomainQuery(projectId: string | undefined) {
  return useQuery<CustomDomain | null>({
    queryKey: queryKeys.projects.customDomain(projectId!),
    queryFn: async () => {
      const response = await getCustomDomainAPICall(projectId!);
      return response.data.custom_domain;
    },
    enabled: !!projectId,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => customDomainRefetchInterval(query.state.data),
  });
}

export function useCustomDomainsQuery(projectId: string | undefined) {
  return useQuery<CustomDomain[]>({
    queryKey: queryKeys.projects.customDomains(projectId!),
    queryFn: async () => {
      const response = await getCustomDomainsAPICall(projectId!);
      return response.data.custom_domains;
    },
    enabled: !!projectId,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => customDomainsRefetchInterval(query.state.data),
  });
}

export function useCustomDomainPreflightQuery(
  projectId: string | undefined,
  hostname: string | undefined,
  options: {
    enabled?: boolean;
    refetchInterval?: UseQueryOptions<CustomDomainPreflight | null>["refetchInterval"];
  } = {}
) {
  const normalized = hostname?.trim().toLowerCase() ?? "";
  return useQuery<CustomDomainPreflight | null>({
    queryKey: queryKeys.projects.customDomainPreflight(projectId!, normalized),
    queryFn: async () => {
      const response = await getCustomDomainPreflightAPICall(
        projectId!,
        normalized
      );
      return normalizeCustomDomainPreflight(response.data);
    },
    enabled: !!projectId && normalized.length > 0 && options.enabled !== false,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval,
  });
}
