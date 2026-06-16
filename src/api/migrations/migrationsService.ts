import { GET, POST, PATCH, DELETE } from "@/lib/api";
import type { AxiosResponse } from "axios";
import { config } from "@/lib/config";
import type {
  MigrationSourceResponse,
  MigrationSourceEnvelope,
  CreateMigrationPayload,
  CreateMigrationResponse,
  CreateMigrationSourcePayload,
  UpdateMigrationSourcePayload,
  MigrationTestResponse,
} from "@/types";

export const getMigrationSourceAPICall = (
  projectId: string
): Promise<AxiosResponse<MigrationSourceResponse>> =>
  // Opt out of the request handler's 5xx retry. /migration_source uses 503 as a
  // permanent "feature flag off" signal, not a transient outage — retrying just
  // burns three round-trips on every page load in deployments that don't ship
  // migration.
  GET(config.apiPath + `/projects/${projectId}/migration_source`, {
    maxRetries: 0,
  });

export const createMigrationAPICall = (
  projectId: string,
  body: CreateMigrationPayload
): Promise<AxiosResponse<CreateMigrationResponse>> =>
  POST(config.apiPath + `/projects/${projectId}/migrations`, body, {
    maxRetries: 0,
  });

export const createMigrationSourceAPICall = (
  projectId: string,
  body: CreateMigrationSourcePayload
): Promise<AxiosResponse<MigrationSourceEnvelope>> =>
  POST(config.apiPath + `/projects/${projectId}/migration_source`, body);

export const updateMigrationSourceAPICall = (
  projectId: string,
  body: UpdateMigrationSourcePayload
): Promise<AxiosResponse<MigrationSourceEnvelope>> =>
  PATCH(config.apiPath + `/projects/${projectId}/migration_source`, body);

export const deleteMigrationSourceAPICall = (
  projectId: string
): Promise<AxiosResponse<{ message: string }>> =>
  DELETE(config.apiPath + `/projects/${projectId}/migration_source`);

export const testMigrationSourceAPICall = (
  projectId: string,
  body?: { url?: string }
): Promise<AxiosResponse<MigrationTestResponse>> =>
  POST(config.apiPath + `/projects/${projectId}/migration_source/test`, body, {
    maxRetries: 0,
  });
