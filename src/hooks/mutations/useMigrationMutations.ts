import { useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  createMigrationAPICall,
  createMigrationSourceAPICall,
  updateMigrationSourceAPICall,
  deleteMigrationSourceAPICall,
  testMigrationSourceAPICall,
} from "@/api/migrations/migrationsService";
import type {
  CreateMigrationPayload,
  CreateMigrationSourcePayload,
  UpdateMigrationSourcePayload,
} from "@/types";

function invalidateProject(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string | undefined
) {
  if (!projectId) return;
  qc.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
}

export function useCreateMigrationSourceMutation(
  projectId: string | undefined
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMigrationSourcePayload) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return createMigrationSourceAPICall(projectId, body);
    },
    onSuccess: () => invalidateProject(qc, projectId),
  });
}

export function useCreateMigrationMutation(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMigrationPayload) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return createMigrationAPICall(projectId, body);
    },
    onSuccess: () => invalidateProject(qc, projectId),
  });
}

export function useUpdateMigrationSourceMutation(
  projectId: string | undefined
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMigrationSourcePayload) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return updateMigrationSourceAPICall(projectId, body);
    },
    onSuccess: () => invalidateProject(qc, projectId),
  });
}

export function useDeleteMigrationSourceMutation(
  projectId: string | undefined
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return deleteMigrationSourceAPICall(projectId);
    },
    onSuccess: () => invalidateProject(qc, projectId),
  });
}

export function useTestMigrationSourceMutation(projectId: string | undefined) {
  return useMutation({
    mutationFn: (body: { url?: string } | undefined = undefined) => {
      if (!projectId) return Promise.reject(new Error("No project selected"));
      return testMigrationSourceAPICall(projectId, body);
    },
  });
}
