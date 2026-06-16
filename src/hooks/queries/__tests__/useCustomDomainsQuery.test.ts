import { describe, it, expect, vi } from "vitest";
import type { CustomDomain } from "@/types";

vi.mock("@/api/configurations/redirect/configRedirectService", () => ({
  getProjectRedirectsAPICall: vi.fn(),
}));
vi.mock("@/api/configurations/domains/configDomainsService", () => ({
  getProjectDomainAPICall: vi.fn(),
  getDomainDefaultsAPICall: vi.fn(),
  getCustomDomainAPICall: vi.fn(),
  getCustomDomainsAPICall: vi.fn(),
}));

const {
  customDomainRefetchInterval,
  customDomainsRefetchInterval,
  normalizeCustomDomainPreflight,
} = await import("@/hooks/queries/useConfigurationQueries");
const { preflightCnameVerdict } = await import("@/lib/customDomainStatus");

const make = (status: CustomDomain["status"]): CustomDomain => ({
  hostname: "h",
  purpose: "migration",
  status,
  ssl_status: null,
  verification_errors: null,
  source: "saas",
  cname_target: "c",
});

describe("customDomainRefetchInterval", () => {
  it("polls while the domain is pending", () => {
    expect(customDomainRefetchInterval(make("pending"))).toBe(30000);
  });
  it("polls while the domain is provisioning", () => {
    expect(customDomainRefetchInterval(make("provisioning"))).toBe(30000);
  });
  it("stops when the domain is active or missing", () => {
    expect(customDomainRefetchInterval(make("active"))).toBe(false);
    expect(customDomainRefetchInterval(null)).toBe(false);
    expect(customDomainRefetchInterval(undefined)).toBe(false);
  });
});

describe("customDomainsRefetchInterval", () => {
  it("polls when a row is pending", () => {
    expect(customDomainsRefetchInterval([make("pending")])).toBe(15000);
  });
  it("polls when a row is provisioning", () => {
    expect(customDomainsRefetchInterval([make("provisioning")])).toBe(15000);
  });
  it("stops when all rows active", () => {
    expect(customDomainsRefetchInterval([make("active")])).toBe(false);
  });
  it("stops when no rows", () => {
    expect(customDomainsRefetchInterval([])).toBe(false);
    expect(customDomainsRefetchInterval(undefined)).toBe(false);
  });
  it("stops when all rows in terminal states", () => {
    expect(customDomainsRefetchInterval([make("failed"), make("active")])).toBe(
      false
    );
  });
});

describe("preflightCnameVerdict", () => {
  const base = { hostname: "links.acme.com" };

  it("returns matched when cname_matches is true", () => {
    expect(preflightCnameVerdict({ ...base, cname_matches: true })).toBe(
      "matched"
    );
  });

  it("returns not_pointed for a clean false answer", () => {
    expect(preflightCnameVerdict({ ...base, cname_matches: false })).toBe(
      "not_pointed"
    );
  });

  it("treats NXDOMAIN (Resolv::ResolvError) as a definitive not_pointed", () => {
    expect(
      preflightCnameVerdict({
        ...base,
        cname_matches: false,
        dns_error: "Resolv::ResolvError",
      })
    ).toBe("not_pointed");
  });

  it("treats resolver timeouts and transport failures as inconclusive", () => {
    for (const dnsError of [
      "Resolv::ResolvTimeout",
      "IOError",
      "Errno::ECONNREFUSED",
      "SocketError",
    ]) {
      expect(
        preflightCnameVerdict({
          ...base,
          cname_matches: false,
          dns_error: dnsError,
        })
      ).toBe("inconclusive");
    }
  });

  it("is inconclusive without a preflight or a boolean cname_matches", () => {
    expect(preflightCnameVerdict(null)).toBe("inconclusive");
    expect(preflightCnameVerdict(undefined)).toBe("inconclusive");
    expect(preflightCnameVerdict({ ...base } as never)).toBe("inconclusive");
  });
});

describe("normalizeCustomDomainPreflight", () => {
  it("returns null instead of undefined when the response has no preflight envelope", () => {
    expect(normalizeCustomDomainPreflight(undefined)).toBeNull();
    expect(normalizeCustomDomainPreflight({})).toBeNull();
    expect(normalizeCustomDomainPreflight({ preflight: null })).toBeNull();
  });

  it("returns the preflight object when present", () => {
    const preflight = {
      hostname: "branch.tabkeep.uk",
      cname_matches: false,
      cname_actual: null,
      dns_error: null,
    };
    expect(normalizeCustomDomainPreflight({ preflight })).toBe(preflight);
  });

  it("rejects an envelope payload without a boolean cname_matches", () => {
    // A partial object must read as "no preflight", never as "not pointed".
    expect(
      normalizeCustomDomainPreflight({
        preflight: { hostname: "branch.tabkeep.uk" } as never,
      })
    ).toBeNull();
  });

  it("returns the flat preflight response when present", () => {
    const preflight = {
      hostname: "branch.tabkeep.uk",
      cname_expected: "proxy-fallback.grovs.link",
      cname_actual: "proxy-fallback.grovs.link",
      cname_matches: true,
      checked_at: "2026-06-02T12:43:00Z",
    };
    expect(normalizeCustomDomainPreflight(preflight)).toBe(preflight);
  });
});
