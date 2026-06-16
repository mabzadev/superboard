import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { getMigrationSourceAPICall } from "@/api/migrations/migrationsService";
import type { MigrationSource } from "@/types";
import { getApiErrorStatus } from "@/lib/apiErrorHelpers";

export function useMigrationSourceQuery(projectId: string | undefined) {
  return useQuery<MigrationSource | null>({
    queryKey: queryKeys.projects.migrationSource(projectId!),
    queryFn: async () => {
      const response = await getMigrationSourceAPICall(projectId!);
      return response.data.migration_source;
    },
    enabled: !!projectId,
    retry: (failureCount, error) => {
      const status = getApiErrorStatus(error);
      // Don't retry feature-off (503), not-admin (403), or not-found.
      if (status === 503 || status === 403 || status === 404) return false;
      return failureCount < 2;
    },
    refetchOnWindowFocus: true,
  });
}
