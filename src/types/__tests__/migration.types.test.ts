import { describe, it, expect } from "vitest";
import type {
  CustomDomain,
  CustomDomainPurpose,
  MigrationProvider,
  MigrationHealth,
  MigrationSource,
  MigrationTestOutcome,
  MigrationTestResponse,
  MigrationCredentials,
} from "@/types";

describe("migration types", () => {
  it("CustomDomain carries purpose", () => {
    const d: CustomDomain = {
      hostname: "old.acme.com",
      purpose: "migration",
      status: "active",
      cname_target: "proxy-fallback.sqd.link",
      ssl_status: null,
      verification_errors: null,
      source: "saas",
    };
    expect(d.purpose).toBe("migration");
  });

  it("MigrationSource shape", () => {
    const s: MigrationSource = {
      id: 1,
      provider: "branch",
      old_host: "old.acme.com",
      enabled: true,
      health: "healthy",
      consecutive_failures: 0,
      first_failure_at: null,
      last_error_status: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    };
    expect(s.health).toBe("healthy");
  });

  it("MigrationCredentials union", () => {
    const branch: MigrationCredentials = { branch_key: "k" };
    const af: MigrationCredentials = { onelink_id: "x", api_token: "t" };
    expect(branch).toBeDefined();
    expect(af).toBeDefined();
  });

  it("test outcome enum", () => {
    const ok: MigrationTestOutcome = "credentials_ok";
    const bad: MigrationTestOutcome = "credentials_invalid";
    const rl: MigrationTestOutcome = "upstream_rate_limited";
    const un: MigrationTestOutcome = "upstream_unreachable";
    const wat: MigrationTestOutcome = "unexpected_success";
    expect([ok, bad, rl, un, wat]).toHaveLength(5);
  });

  it("CustomDomainPurpose", () => {
    const p: CustomDomainPurpose = "primary";
    const m: CustomDomainPurpose = "migration";
    expect(p).toBe("primary");
    expect(m).toBe("migration");
  });

  it("MigrationProvider", () => {
    const b: MigrationProvider = "branch";
    const a: MigrationProvider = "appsflyer";
    expect([b, a]).toEqual(["branch", "appsflyer"]);
  });

  it("MigrationHealth", () => {
    const h: MigrationHealth[] = ["healthy", "degraded", "disabled"];
    expect(h).toHaveLength(3);
  });

  it("MigrationTestResponse shape", () => {
    const r: MigrationTestResponse = {
      outcome: "credentials_ok",
      http_status: 404,
    };
    expect(r.http_status).toBe(404);
  });
});
