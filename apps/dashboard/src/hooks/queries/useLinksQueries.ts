import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  getProjectLinksAPICall,
  getLinksByIdAPICall,
  availablePathAPICall,
  getRandomPathAPICall,
} from "@/api/links/linksService";
import type { Link, GetLinksParams, LinksByIdsPayload } from "@/types";

interface LinksListResult {
  data: Link[];
  totalPages: number;
  totalEntries: number;
}

export function useLinksListQuery(
  projectId: string | undefined,
  params: GetLinksParams | null
) {
  return useQuery<LinksListResult>({
    queryKey: queryKeys.projects.links(projectId!, params ?? undefined),
    queryFn: async () => {
      const response = await getProjectLinksAPICall(projectId!, params!);
      return {
        data: response.data.links,
        totalPages: response.data.meta.total_pages,
        totalEntries: response.data.meta.total_entries,
      };
    },
    enabled: !!projectId && !!params,
  });
}

export function useLinksByIdsQuery(
  projectId: string | undefined,
  ids: LinksByIdsPayload | null
) {
  return useQuery({
    queryKey: queryKeys.projects.linksByIds(projectId!, ids!),
    queryFn: async () => {
      const response = await getLinksByIdAPICall(projectId!, ids!);
      return response.data.links;
    },
    enabled: !!projectId && !!ids,
  });
}

export function usePathAvailableQuery(
  projectId: string | undefined,
  path: string | undefined
) {
  return useQuery({
    queryKey: queryKeys.projects.pathAvailable(projectId!, path!),
    queryFn: async () => {
      const response = await availablePathAPICall(projectId!, path!);
      return response.data.available;
    },
    enabled: !!projectId && !!path && path.length > 0,
  });
}

export function useRandomPathQuery(
  projectId: string | undefined,
  enabled: boolean = false
) {
  return useQuery({
    queryKey: queryKeys.projects.randomPath(projectId!),
    queryFn: async () => {
      const response = await getRandomPathAPICall(projectId!);
      return response.data.valid_path;
    },
    enabled: !!projectId && enabled,
    staleTime: 0,
  });
}
