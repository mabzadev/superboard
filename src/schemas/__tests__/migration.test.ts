import { describe, it, expect } from "vitest";
import {
  branchCredentialsSchema,
  appsflyerCredentialsSchema,
  migrationOldHostSchema,
  credentialsSchemaFor,
} from "@/schemas/migration";

describe("migration schemas", () => {
  it("branch requires branch_key", () => {
    expect(branchCredentialsSchema.safeParse({ branch_key: "k" }).success).toBe(
      true
    );
    expect(branchCredentialsSchema.safeParse({ branch_key: "" }).success).toBe(
      false
    );
    expect(branchCredentialsSchema.safeParse({}).success).toBe(false);
  });

  it("appsflyer requires onelink_id and api_token", () => {
    const ok = appsflyerCredentialsSchema.safeParse({
      onelink_id: "x",
      api_token: "t",
    });
    expect(ok.success).toBe(true);
    expect(
      appsflyerCredentialsSchema.safeParse({ onelink_id: "x" }).success
    ).toBe(false);
    expect(
      appsflyerCredentialsSchema.safeParse({ api_token: "t" }).success
    ).toBe(false);
  });

  it("old host must be bare hostname", () => {
    expect(migrationOldHostSchema.safeParse("old.acme.com").success).toBe(true);
    expect(migrationOldHostSchema.safeParse("sub.old.acme.com").success).toBe(
      true
    );
    expect(
      migrationOldHostSchema.safeParse("https://old.acme.com").success
    ).toBe(false);
    expect(migrationOldHostSchema.safeParse("old.acme.com:443").success).toBe(
      false
    );
    expect(migrationOldHostSchema.safeParse("old.acme.com/path").success).toBe(
      false
    );
    expect(migrationOldHostSchema.safeParse("not a host").success).toBe(false);
    expect(migrationOldHostSchema.safeParse("").success).toBe(false);
  });

  it("credentialsSchemaFor picks per provider", () => {
    expect(credentialsSchemaFor("branch")).toBe(branchCredentialsSchema);
    expect(credentialsSchemaFor("appsflyer")).toBe(appsflyerCredentialsSchema);
  });
});
