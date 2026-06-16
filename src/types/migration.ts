export type MigrationProvider = "branch" | "appsflyer";
export type MigrationHealth = "healthy" | "degraded" | "disabled";
export type MigrationTestOutcome =
  | "credentials_ok"
  | "credentials_invalid"
  | "upstream_rate_limited"
  | "upstream_unreachable"
  | "unexpected_success";

export interface MigrationSource {
  id: number;
  provider: MigrationProvider;
  old_host: string;
  enabled: boolean;
  health: MigrationHealth;
  consecutive_failures: number;
  first_failure_at: string | null;
  last_error_status: number | null;
  created_at: string;
  updated_at: string;
}

export type MigrationCredentials =
  | { branch_key: string }
  | { onelink_id: string; api_token: string };

export interface MigrationSourceResponse {
  migration_source: MigrationSource | null;
}

export interface MigrationSourceEnvelope {
  migration_source: MigrationSource;
}

export interface CreateMigrationPayload {
  hostname: string;
  provider: MigrationProvider;
  credentials: MigrationCredentials;
}

export interface CreateMigrationResponse {
  migration_source: MigrationSource;
  custom_domain: import("./configuration").CustomDomain;
}

export interface CreateMigrationSourcePayload {
  provider: MigrationProvider;
  old_host: string;
  credentials: MigrationCredentials;
}

export interface UpdateMigrationSourcePayload {
  enabled?: boolean;
  credentials?: MigrationCredentials;
}

export interface MigrationTestResponse {
  outcome: MigrationTestOutcome;
  http_status: number;
  resolved_url?: string | null;
  slug?: string | null;
}
