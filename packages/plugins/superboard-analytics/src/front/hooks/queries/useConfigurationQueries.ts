import { queryKeys } from "@superboard/front-ui/lib/queryKeys.js";
import type { RedirectConfig, DomainConfig, DomainDefaults } from "@superboard/front-ui/types";
import { useQuery } from "@tanstack/react-query";

import {
	getProjectDomainAPICall,
	getDomainDefaultsAPICall,
} from "../../api/configurations/domains/configDomainsService.js";
import { getProjectRedirectsAPICall } from "../../api/configurations/redirect/configRedirectService.js";

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
