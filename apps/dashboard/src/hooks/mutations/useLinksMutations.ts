import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  createNewLinkAPICall,
  updateLinkAPICall,
  removeLinkAPICall,
} from "@/api/links/linksService";

export function useCreateLinkMutation(
  projectId: string | undefined,
  instanceId?: string
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (formData: FormData) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return createNewLinkAPICall(projectId, formData);
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

export function useUpdateLinkMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      linkId,
      formData,
    }: {
      linkId: string;
      formData: FormData;
    }) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return updateLinkAPICall(projectId, linkId, formData);
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

export function useRemoveLinkMutation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (linkId: string) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return removeLinkAPICall(projectId, linkId);
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
