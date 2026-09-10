import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type {
	SubdomainPayload,
	GoogleTrackingIdPayload,
} from "../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	trackEvent,
	EVENTS,
} from "../../../../../../supbrd-core/src/front/settings/analytics/index.js";
import {
	setSubdomainAPICall,
	setGoogleTrackingIDAPICall,
	verifySubdomainAvailabilityAPICall,
} from "../../../../../../supbrd-plug-analytics/src/front/api/configurations/domains/configDomainsService.js";
import {
	setDefaultRedirectAPICall,
	setRedirectAPICall,
} from "../../../../../../supbrd-plug-analytics/src/front/api/configurations/redirect/configRedirectService.js";

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
				showIosPreview,
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
			return setRedirectAPICall(projectId, platform, variation, appstore, fallbackUrl, enabled);
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
