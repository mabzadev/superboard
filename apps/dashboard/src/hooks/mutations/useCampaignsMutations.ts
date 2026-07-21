import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  createNewCampaignAPICall,
  updateCampaignAPICall,
  archiveCampaignAPICall,
} from "@/api/campaigns/campaignsService";
import type { CreateCampaignPayload, UpdateCampaignPayload } from "@/types";

export function useCreateCampaignMutation(
  projectId: string | undefined,
  instanceId?: string
) {
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
