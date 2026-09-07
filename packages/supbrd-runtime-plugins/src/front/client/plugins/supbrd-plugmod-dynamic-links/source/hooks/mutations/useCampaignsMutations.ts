import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "../../../../../../../../../supbrd-front-ui/src/shared/lib/queryKeys.js";
import type {
	CreateCampaignPayload,
	UpdateCampaignPayload,
} from "../../../../../../../../../supbrd-front-ui/src/shared/types/index.js";
import {
	createNewCampaignAPICall,
	updateCampaignAPICall,
	archiveCampaignAPICall,
} from "../../api/campaigns/campaignsService.js";

export function useCreateCampaignMutation(projectId: string | undefined, instanceId?: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (formData: CreateCampaignPayload) => {
			if (!projectId) return Promise.reject(new Error("No project selected"));
			return createNewCampaignAPICall(projectId, formData);
		},
		onSuccess: () => {
			if (projectId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.detail(projectId),
				});
			}
			if (instanceId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.instances.detail(instanceId),
				});
			}
		},
	});
}

export function useUpdateCampaignMutation(projectId: string | undefined) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({
			campaignId,
			formData,
		}: {
			campaignId: string;
			formData: UpdateCampaignPayload;
		}) => {
			if (!projectId) return Promise.reject(new Error("No project selected"));
			return updateCampaignAPICall(projectId, campaignId, formData);
		},
		onSuccess: () => {
			if (projectId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.detail(projectId),
				});
			}
		},
	});
}

export function useArchiveCampaignMutation(projectId: string | undefined) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (campaignId: string) => {
			if (!projectId) return Promise.reject(new Error("No project selected"));
			return archiveCampaignAPICall(projectId, campaignId);
		},
		onSuccess: () => {
			if (projectId) {
				queryClient.invalidateQueries({
					queryKey: queryKeys.projects.detail(projectId),
				});
			}
		},
	});
}
