import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateDomainPlan,
  evaluateOrphanWorkerDomains,
  evaluateRetiredDomainPlan,
  expectedDomainOwners,
  retiredDomainOwners,
  targetWorkerNames,
} from "./cloudflare-domain-plan-core.mjs";

const target = {
  features: { messaging: false },
  environments: { development: { publicRouting: "active" } },
  domains: {
    api: "api.example.test",
    auth: "auth.example.test",
    shortlinks: "in.example.test",
    sdk: "sdk.example.test",
    files: "files.example.test",
    dashboard: "grow.example.test",
    mcp: "mcp.example.test",
    mailPreview: "mail.example.test",
  },
  retiredDomains: [
    {
      hostname: "old-grow.example.test",
      formerSurface: "dashboard",
      policy: "must-be-unassigned",
    },
  ],
  workers: {
    api: { development: "opengrow-api-dev" },
    dashboard: { development: "opengrow-dashboard-dev" },
    mcp: { development: "opengrow-mcp-dev" },
    email: { development: "opengrow-email-dev" },
  },
};

test("the domain plan assigns every public surface to one explicit Worker", () => {
  const expected = expectedDomainOwners(target, "development");
  assert.equal(expected.length, 8);
  assert.deepEqual(
    expected
      .filter((entry) => entry.service === "opengrow-api-dev")
      .map((entry) => entry.surface),
    ["api", "auth", "shortlinks", "sdk", "files"],
  );
  assert.throws(
    () =>
      expectedDomainOwners(
        {
          ...target,
          domains: { ...target.domains, sdk: target.domains.api },
        },
        "development",
      ),
    /assigned more than once/,
  );
});

test("mail preview is optional for SMTP targets", () => {
  const smtpTarget = {
    ...target,
    domains: Object.fromEntries(
      Object.entries(target.domains).filter(([name]) => name !== "mailPreview"),
    ),
  };
  const expected = expectedDomainOwners(smtpTarget, "development");
  assert.equal(expected.length, 7);
  assert.equal(
    expected.some((entry) => entry.surface === "mailPreview"),
    false,
  );
});

test("staged routing never plans a public hostname takeover", () => {
  const staged = {
    ...target,
    environments: { production: { publicRouting: "staged" } },
  };
  assert.deepEqual(expectedDomainOwners(staged, "production"), []);
});

test("available and already managed domains are non-blocking", () => {
  const expected = expectedDomainOwners(target, "development");
  const result = evaluateDomainPlan({
    expected,
    zones: [{ id: "zone", name: "example.test" }],
    workerDomains: [
      { hostname: "api.example.test", service: "opengrow-api-dev" },
    ],
    dnsRecordsByHostname: {
      "api.example.test": [{ type: "AAAA", proxied: true }],
    },
  });
  assert.equal(
    result.find((entry) => entry.surface === "api").status,
    "managed",
  );
  assert.equal(
    result.find((entry) => entry.surface === "sdk").status,
    "available",
  );
  assert.equal(
    result.some((entry) => entry.blocking),
    false,
  );
});

test("an occupied DNS name or a different Worker blocks deployment", () => {
  const expected = expectedDomainOwners(target, "development");
  const result = evaluateDomainPlan({
    expected,
    zones: [{ id: "zone", name: "example.test" }],
    workerDomains: [{ hostname: "api.example.test", service: "legacy-api" }],
    dnsRecordsByHostname: {
      "in.example.test": [{ type: "A", proxied: false }],
    },
  });
  assert.equal(
    result.find((entry) => entry.surface === "api").status,
    "wrong-worker",
  );
  assert.equal(
    result.find((entry) => entry.surface === "shortlinks").status,
    "dns-conflict",
  );
  assert.equal(result.filter((entry) => entry.blocking).length, 2);
  assert.equal(JSON.stringify(result).includes("94.130.22.22"), false);
});

test("a hostname outside every accessible zone blocks deployment", () => {
  const [expected] = expectedDomainOwners(target, "development");
  const [result] = evaluateDomainPlan({
    expected: [expected],
    zones: [],
    workerDomains: [],
    dnsRecordsByHostname: {},
  });
  assert.equal(result.status, "zone-missing");
  assert.equal(result.blocking, true);
});

test("an unreadable DNS name blocks takeover unless the desired Worker already owns it", () => {
  const expected = expectedDomainOwners(target, "development");
  const result = evaluateDomainPlan({
    expected,
    zones: [{ id: "zone", name: "example.test" }],
    workerDomains: [
      { hostname: "api.example.test", service: "opengrow-api-dev" },
    ],
    dnsRecordsByHostname: {},
    dnsInspectionErrorsByHostname: {
      "api.example.test": "Cloudflare DNS read denied",
      "in.example.test": "Cloudflare DNS read denied",
    },
  });
  const api = result.find((entry) => entry.surface === "api");
  const shortlinks = result.find((entry) => entry.surface === "shortlinks");
  assert.equal(api.status, "managed");
  assert.equal(api.blocking, false);
  assert.equal(shortlinks.status, "dns-unverified");
  assert.equal(shortlinks.blocking, true);
  assert.equal(shortlinks.dnsInspectionError, "Cloudflare DNS read denied");
});

test("retired domains fail closed until Worker and DNS ownership are removed", () => {
  const retired = retiredDomainOwners(target);
  const occupied = evaluateRetiredDomainPlan({
    retired,
    zones: [{ id: "zone", name: "example.test" }],
    workerDomains: [
      {
        hostname: "old-grow.example.test",
        service: "opengrow-dashboard-dev",
      },
    ],
    dnsRecordsByHostname: {},
  });
  assert.equal(occupied[0].status, "retired-worker-domain");
  assert.equal(occupied[0].blocking, true);

  const clean = evaluateRetiredDomainPlan({
    retired,
    zones: [{ id: "zone", name: "example.test" }],
    workerDomains: [],
    dnsRecordsByHostname: { "old-grow.example.test": [] },
  });
  assert.equal(clean[0].status, "retired-clean");
  assert.equal(clean[0].blocking, false);
});

test("unregistered domains attached to a target Worker are blocking orphans", () => {
  const expected = expectedDomainOwners(target, "development");
  const retired = retiredDomainOwners(target);
  const orphaned = evaluateOrphanWorkerDomains({
    expected,
    retired,
    workerDomains: [
      {
        hostname: "forgotten.example.test",
        service: "opengrow-api-dev",
      },
      { hostname: "unrelated.example.test", service: "another-worker" },
    ],
    managedServices: targetWorkerNames(target, "development"),
  });
  assert.deepEqual(orphaned, [
    {
      hostname: "forgotten.example.test",
      status: "orphan-worker-domain",
      blocking: true,
      currentServices: ["opengrow-api-dev"],
    },
  ]);
});
