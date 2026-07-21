import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  createInstanceAPICall,
  editInstanceAPICall,
  deleteInstanceAPICall,
  addMemberToInstanceAPICall,
  removedMemberFromInstanceAPICall,
  dismissGetStartedAPICall,
  exportUsageApiCall,
  setRevenueCollectionEnabledApiCall,
  completeSetupStepAPICall,
} from "@/api/instances/instanceService";
import {
  setIOSAppConfigAPICall,
  setIOSPushConfigAPICall,
  setAndroidAppConfigAPICall,
  setAndroidPushConfigAPICall,
  setAndroidAppWebhookAccessKeyAPICall,
  setWebAppConfigAPICall,
  setDesktopAppConfigAPICall,
  removeIOSConfigAPICall,
  removeAndroidConfigAPICall,
  removeWebConfigAPICall,
} from "@/api/applications/configApplicationsService";
import type {
  DismissGetStartedPayload,
  ExportUsagePayload,
  RevenueCollectionPayload,
  IosConfigPayload,
  AndroidConfigPayload,
  AndroidPushConfigPayload,
  DesktopConfigPayload,
} from "@/types";

export function useCreateInstanceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      name,
      members,
    }: {
      name: string;
      members: { email: string; role: string }[];
    }) => createInstanceAPICall(name, members),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances.all });
    },
  });
}

export function useEditInstanceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      editInstanceAPICall(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances.all });
    },
  });
}

export function useDeleteInstanceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteInstanceAPICall(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances.all });
    },
  });
}

export function useAddMemberMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: string }) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return addMemberToInstanceAPICall(instanceId, email, role);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.members(instanceId),
        });
      }
    },
  });
}

export function useRemoveMemberMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (email: string) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return removedMemberFromInstanceAPICall(instanceId, email);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.members(instanceId),
        });
      }
    },
  });
}

export function useDismissGetStartedMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data?: DismissGetStartedPayload;
    }) => dismissGetStartedAPICall(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances.all });
    },
  });
}

export function useExportUsageMutation() {
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ExportUsagePayload }) =>
      exportUsageApiCall(id, data),
  });
}

export function useSetRevenueCollectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: RevenueCollectionPayload;
    }) => setRevenueCollectionEnabledApiCall(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.instances.all });
    },
  });
}

export function useCompleteSetupStepMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      category,
      stepIdentifier,
    }: {
      category: string;
      stepIdentifier: string;
    }) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return completeSetupStepAPICall(instanceId, category, stepIdentifier);
    },
    onSuccess: (_, variables) => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.setupProgress(
            instanceId,
            variables.category
          ),
        });
      }
    },
  });
}

// Platform configuration mutations
export function useSetIosConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | IosConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setIOSAppConfigAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetIosPushConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | IosConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setIOSPushConfigAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetAndroidConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | AndroidConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setAndroidAppConfigAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetAndroidPushConfigMutation(
  instanceId: string | undefined
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | AndroidPushConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setAndroidPushConfigAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetAndroidWebhookKeyMutation(
  instanceId: string | undefined
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | AndroidConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setAndroidAppWebhookAccessKeyAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetWebConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      enabled,
      domains,
    }: {
      enabled: boolean;
      domains: string[];
    }) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setWebAppConfigAPICall(instanceId, enabled, domains);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useSetDesktopConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: FormData | DesktopConfigPayload) => {
      if (!instanceId) throw new Error("Instance ID is required");
      return setDesktopAppConfigAPICall(instanceId, data);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useRemoveIosConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!instanceId) throw new Error("Instance ID is required");
      return removeIOSConfigAPICall(instanceId);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useRemoveAndroidConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!instanceId) throw new Error("Instance ID is required");
      return removeAndroidConfigAPICall(instanceId);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}

export function useRemoveWebConfigMutation(instanceId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!instanceId) throw new Error("Instance ID is required");
      return removeWebConfigAPICall(instanceId);
    },
    onSuccess: () => {
      if (instanceId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.instances.config(instanceId),
        });
      }
    },
  });
}
