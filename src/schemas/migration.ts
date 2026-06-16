import { z } from "zod";
import type { MigrationProvider } from "@/types";

export const branchCredentialsSchema = z.object({
  branch_key: z.string().min(1, "Branch API key is required"),
});

export const appsflyerCredentialsSchema = z.object({
  onelink_id: z.string().min(1, "OneLink ID is required"),
  api_token: z.string().min(1, "API token is required"),
});

const HOSTNAME_RE =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export const migrationOldHostSchema = z
  .string()
  .min(1, "Hostname is required")
  .refine((v) => !v.includes("://"), "Don't include http(s)://")
  .refine((v) => !v.includes(":"), "Don't include a port")
  .refine((v) => !v.includes("/"), "Don't include a path")
  .refine(
    (v) => HOSTNAME_RE.test(v),
    "Enter a valid bare hostname (e.g. old.example.com)"
  );

export function credentialsSchemaFor(provider: MigrationProvider) {
  return provider === "branch"
    ? branchCredentialsSchema
    : appsflyerCredentialsSchema;
}

export type BranchCredentials = z.infer<typeof branchCredentialsSchema>;
export type AppsflyerCredentials = z.infer<typeof appsflyerCredentialsSchema>;
