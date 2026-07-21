import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getInstancesAPICall,
  instanceDetailsAPICall,
  getMembersForInstanceAPICall,
  currentUserRoleForInstanceAPICall,
  getSetupProgressAPICall,
} from "@/api/instances/instanceService";
import {
  getProjectConfigurationAPICall,
  getGoogleConfigurationsScriptAPICall,
} from "@/api/applications/configApplicationsService";
import type { Instance } from "@/types";

export function useInstancesQuery() {
  return useQuery({
    queryKey: queryKeys.instances.all,
    queryFn: async () => {
      const response = await getInstancesAPICall();
      const instances = response.data.instances as Instance[];
      return instances.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    },
  });
}

export function useInstanceDetailsQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.instances.detail(instanceId!),
    queryFn: async () => {
      const response = await instanceDetailsAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId,
  });
}

export function useInstanceMembersQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.instances.members(instanceId!),
    queryFn: async () => {
      const response = await getMembersForInstanceAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId,
  });
}

export function useInstanceConfigQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.instances.config(instanceId!),
    queryFn: async () => {
      const response = await getProjectConfigurationAPICall(instanceId!);
      return response.data.configurations;
    },
    enabled: !!instanceId,
  });
}

export function useInstanceUserRoleQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.instances.userRole(instanceId!),
    queryFn: async () => {
      const response = await currentUserRoleForInstanceAPICall(instanceId!);
      return response.data.role as string;
    },
    enabled: !!instanceId,
  });
}

export function useSetupProgressQuery(
  instanceId: string | undefined,
  category: string
) {
  return useQuery({
    queryKey: queryKeys.instances.setupProgress(instanceId!, category),
    queryFn: async () => {
      const response = await getSetupProgressAPICall(instanceId!, category);
      return response.data;
    },
    enabled: !!instanceId,
  });
}

export function useGoogleConfigScriptQuery(instanceId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.instances.config(instanceId!), "googleScript"],
    queryFn: async () => {
      const response = await getGoogleConfigurationsScriptAPICall(instanceId!);
      return response.data;
    },
    enabled: !!instanceId,
  });
}
