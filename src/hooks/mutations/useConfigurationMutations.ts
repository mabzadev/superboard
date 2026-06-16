import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { trackEvent, EVENTS } from "@/analytics";
import {
  setDefaultRedirectAPICall,
  setRedirectAPICall,
} from "@/api/configurations/redirect/configRedirectService";
import {
  setSubdomainAPICall,
  setGoogleTrackingIDAPICall,
  verifySubdomainAvailabilityAPICall,
  addCustomDomainWithPurposeAPICall,
  removeCustomDomainByPurposeAPICall,
} from "@/api/configurations/domains/configDomainsService";
import type {
  SubdomainPayload,
  GoogleTrackingIdPayload,
  CustomDomainPurpose,
} from "@/types";

export function useSetDefaultRedirectMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: ({
      defaultFallback,
      showAndroidPreview,
      showIosPreview,
    }: {
      defaultFallback: string;
      showAndroidPreview: boolean;
      showIosPreview: boolean;
    }) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return setDefaultRedirectAPICall(
        projectId,
        defaultFallback,
        showAndroidPreview,
        showIosPreview
      );
    },
    onSuccess: () => {
      trackEvent(EVENTS.REDIRECT_RULES_CREATED, { projectId });
    },
  });
}

export function useSetRedirectMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: ({
      platform,
      variation,
      appstore,
      fallbackUrl,
      enabled,
    }: {
      platform: string;
      variation: string;
      appstore: boolean;
      fallbackUrl: string | null;
      enabled: boolean;
    }) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return setRedirectAPICall(
        projectId,
        platform,
        variation,
        appstore,
        fallbackUrl,
        enabled
      );
    },
  });
}

export function useSetSubdomainMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData | SubdomainPayload) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return setSubdomainAPICall(projectId, formData);
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.domainConfig(projectId),
        });
      }
    },
  });
}

export function useSetGoogleTrackingIDMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData | GoogleTrackingIdPayload) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return setGoogleTrackingIDAPICall(projectId, formData);
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.domainConfig(projectId),
        });
      }
    },
  });
}

export function useVerifySubdomainMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (subdomain: string) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return verifySubdomainAvailabilityAPICall(projectId, subdomain);
    },
  });
}

export function useAddCustomDomainMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { hostname: string; purpose?: CustomDomainPurpose }) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return addCustomDomainWithPurposeAPICall(
        projectId,
        args.hostname,
        args.purpose ?? "primary"
      );
    },
    onSuccess: () => {
      if (projectId) {
        // Invalidate both keys: the plural list is the source of truth, and
        // the singular shim still backs the existing dialog read path.
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.customDomains(projectId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.customDomain(projectId),
        });
      }
    },
  });
}

export function useRemoveCustomDomainMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (purpose: CustomDomainPurpose = "primary") => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return removeCustomDomainByPurposeAPICall(projectId, purpose);
    },
    onSuccess: () => {
      if (projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.customDomains(projectId),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.projects.customDomain(projectId),
        });
      }
    },
  });
}
