import type { CustomDomain, MigrationSource } from "@/types";

export type MigrationStep =
  | "loading"
  | "feature_off"
  | "not_admin"
  | "start"
  | "dns_verify"
  | "dns_failed"
  | "cutover"
  | "managed";

export interface DeriveStepInput {
  domainsLoading: boolean;
  sourceLoading: boolean;
  domains: CustomDomain[] | undefined;
  source: MigrationSource | null | undefined;
  sourceErrorStatus: number | undefined;
  attestations: { preflightDone?: boolean; cutoverDone?: boolean };
}

export function deriveStep(input: DeriveStepInput): MigrationStep {
  const { domainsLoading, sourceLoading, domains, source, sourceErrorStatus } =
    input;

  if (sourceErrorStatus === 503) return "feature_off";
  if (sourceErrorStatus === 403) return "not_admin";
  if (domainsLoading || sourceLoading) return "loading";

  const migrationRow = domains?.find((d) => d.purpose === "migration");

  // No migration domain/source yet — show the combined migration create form.
  if (!migrationRow) return "start";

  const sslStatus = migrationRow.ssl_status ?? migrationRow.status;
  if (
    sslStatus === "pending_validation" ||
    sslStatus === "pending_deployment" ||
    migrationRow.status === "pending" ||
    migrationRow.status === "provisioning"
  ) {
    return "dns_verify";
  }
  if (migrationRow.status === "failed" || migrationRow.status === "suspended") {
    return "dns_failed";
  }

  if (!source) return "start";
  return migrationRow.status === "active" ? "managed" : "dns_verify";
}
