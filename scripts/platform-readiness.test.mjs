import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadTarget } from "./cloudflare-target.mjs";
import { targetWithoutResourceIds } from "./cloudflare-test-fixtures.mjs";
import {
  buildReadiness,
  classifySnapshotVerificationError,
  clientSourceEnvironmentName,
  credentialReadiness,
  inspectSdkRemoteState,
  parseClientSources,
  parseGitState,
  referenceReadiness,
  requiredResourceIds,
  sdkReadiness,
  targetReadiness,
} from "./platform-readiness.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("target readiness distinguishes unresolved fixtures from provisioned targets", async () => {
  const { target: mbzaSource } = await loadTarget("mbza-development");
  const mbza = targetWithoutResourceIds(mbzaSource, "development");
  const { target: vocostar } = await loadTarget("vocostar");
  const mbzaResult = targetReadiness(mbza, "development");
  const vocostarResult = targetReadiness(vocostar, "production");

  assert.equal(requiredResourceIds(mbza, "development").length, 13);
  assert.equal(mbzaResult.resourceIds.missing.length, 13);
  assert.equal(mbzaResult.manifestProvisioned, false);
  assert.equal(mbzaResult.acceptance.dashboardCacheIsolated, true);
  assert.equal(mbzaResult.acceptance.legacyMessagingDisabled, true);
  assert.equal(vocostarResult.resourceIds.required, 13);
  assert.equal(vocostarResult.resourceIds.missing.length, 0);
  assert.equal(vocostarResult.manifestProvisioned, true);
});

test("SDK readiness keeps unreleased source versions visible", () => {
  const result = sdkReadiness({
    libraries: [
      { id: "stable", releaseStatus: "released" },
      {
        id: "pending",
        releaseStatus: "pending-release",
        sourceVersion: "2.0.0",
        latestReleaseVersion: "1.0.0",
      },
    ],
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.pending.map((entry) => entry.id),
    ["pending"],
  );
});

test("remote SDK readiness requires tags, package refs and GitHub releases", () => {
  const catalogue = {
    libraries: [
      {
        id: "flutter",
        sourceVersion: "2.1.3",
        latestReleaseVersion: "2.1.3",
        releaseRef: "sdk-flutter-v2.1.3",
        releaseStatus: "released",
      },
      {
        id: "ios",
        sourceVersion: "1.0.0",
        latestReleaseVersion: "1.0.0",
        releaseRef: "1.0.0",
        releaseStatus: "released",
      },
      {
        id: "flutterflow",
        sourceVersion: "2.2.4",
        latestReleaseVersion: "2.1.6",
        releaseRef: "sdk-flutterflow-v2.1.6",
        releaseStatus: "pending-release",
      },
    ],
  };
  const present = new Set(["sdk-flutter-v2.1.3", "sdk-ios-v1.0.0", "1.0.0"]);
  const run = (args) => {
    const value = decodeURIComponent(args.at(-1).split("/").at(-1));
    const isRelease = args.at(-1).includes("/releases/tags/");
    return {
      ok: present.has(value) && (!isRelease || value !== "1.0.0"),
    };
  };
  const remote = inspectSdkRemoteState(
    catalogue,
    "mbzadev/opengrow-platform",
    run,
  );
  assert.equal(remote.ready, true);
  assert.equal(remote.publications[1].packageRefExists, true);
  assert.equal(remote.publications[2].tagExists, false);
  assert.equal(sdkReadiness(catalogue, remote).ready, false);

  present.delete("sdk-flutter-v2.1.3");
  const incomplete = inspectSdkRemoteState(
    catalogue,
    "mbzadev/opengrow-platform",
    run,
  );
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.publications[0].releaseExists, false);
});

test("governance schema accepts repositories owned by another GitHub account", async () => {
  const schema = JSON.parse(
    await readFile(
      resolve(root, "schemas/platform-governance.schema.json"),
      "utf8",
    ),
  );
  const governance = JSON.parse(
    await readFile(resolve(root, "config/platform-governance.json"), "utf8"),
  );
  governance.canonicalRepository = "example/opengrow-platform";
  governance.referenceRepository = "example/opengrow-reference";

  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(governance), true, JSON.stringify(validate.errors));
});

test("reference readiness binds short links and source versions to the target", async () => {
  const { target } = await loadTarget("mbza-development");
  const repositories = {
    platform: { nameWithOwner: "mbzadev/opengrow-platform" },
    reference: { nameWithOwner: "mbzadev/opengrow-reference" },
  };
  const project = {
    platformRepository: "https://github.com/mbzadev/opengrow-platform",
    referenceRepository: "https://github.com/mbzadev/opengrow-reference",
    target: "mbza-development",
    environment: "development",
    sdkApplication: {
      platform: "web",
      identifier: "reference.mbza.dev",
      projectEnvironment: "test",
    },
    deployment: {
      branch: "dev",
      environment: "development",
      workerName: "opengrow-reference-app-dev",
    },
    endpoints: {
      referenceWeb: "https://reference.mbza.dev",
      dashboard: "https://grow.mbza.dev",
      api: "https://api.mbza.dev",
      sdk: "https://sdk.mbza.dev",
      shortLinks: "https://in.mbza.dev",
      files: "https://files.mbza.dev",
      mailPreview: "https://mail.mbza.dev",
      support: "https://api.mbza.dev/api/v1/support-client",
    },
    libraries: {
      opengrow_flutterflow: {
        sourceVersion: "2.2.4",
        releaseVersion: "2.2.3",
        releaseRef: "sdk-flutterflow-v2.2.3",
      },
      opengrow_flutterflow_messaging: {
        sourceVersion: "1.3.0",
        releaseVersion: "1.3.0",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      },
    },
  };
  const catalogue = {
    libraries: [
      {
        id: "flutterflow",
        sourceVersion: "2.2.4",
        latestReleaseVersion: "2.2.3",
        releaseRef: "sdk-flutterflow-v2.2.3",
      },
      {
        id: "flutterflow-support",
        sourceVersion: "1.3.0",
        latestReleaseVersion: "1.3.0",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      },
    ],
  };
  assert.equal(
    referenceReadiness(project, target, catalogue, repositories).ready,
    true,
  );
  project.endpoints.shortLinks = "https://wrong.example";
  assert.equal(
    referenceReadiness(project, target, catalogue, repositories).ready,
    false,
  );
});

test("reference readiness derives application URLs and repositories from manifests", async () => {
  const { target: sourceTarget } = await loadTarget("mbza-development");
  const target = structuredClone(sourceTarget);
  target.target = "sample-development";
  target.domains = {
    ...target.domains,
    api: "api.sample.dev",
    shortlinks: "in.sample.dev",
    sdk: "sdk.sample.dev",
    dashboard: "grow.sample.dev",
    files: "files.sample.dev",
    mailPreview: "mail.sample.dev",
  };
  target.publicSurfaceMonitors = [
    {
      id: "reference",
      url: "https://reference.sample.dev",
      healthUrl: "https://reference.sample.dev/",
      description: "Sample acceptance application",
    },
  ];
  const project = {
    platformRepository: "https://github.com/example/platform",
    referenceRepository: "https://github.com/example/reference",
    target: "sample-development",
    environment: "development",
    sdkApplication: {
      platform: "web",
      identifier: "reference.sample.dev",
      projectEnvironment: "test",
    },
    deployment: {
      branch: "dev",
      environment: "development",
      workerName: "sample-reference-dev",
    },
    endpoints: {
      referenceWeb: "https://reference.sample.dev",
      dashboard: "https://grow.sample.dev",
      api: "https://api.sample.dev",
      sdk: "https://sdk.sample.dev",
      shortLinks: "https://in.sample.dev",
      files: "https://files.sample.dev",
      mailPreview: "https://mail.sample.dev",
      support: "https://api.sample.dev/api/v1/support-client",
    },
    libraries: {
      opengrow_flutterflow: {
        sourceVersion: "2.2.4",
        releaseVersion: "2.2.3",
        releaseRef: "sdk-flutterflow-v2.2.3",
      },
      opengrow_flutterflow_messaging: {
        sourceVersion: "1.3.0",
        releaseVersion: "1.3.0",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      },
    },
  };
  const catalogue = {
    libraries: [
      {
        id: "flutterflow",
        sourceVersion: "2.2.4",
        latestReleaseVersion: "2.2.3",
        releaseRef: "sdk-flutterflow-v2.2.3",
      },
      {
        id: "flutterflow-support",
        sourceVersion: "1.3.0",
        latestReleaseVersion: "1.3.0",
        releaseRef: "sdk-flutterflow-messaging-v1.3.0",
      },
    ],
  };

  assert.equal(
    referenceReadiness(project, target, catalogue, {
      platform: { nameWithOwner: "example/platform" },
      reference: { nameWithOwner: "example/reference" },
    }).ready,
    true,
  );
});

test("git readiness requires a clean committed declared branch and remote", () => {
  const expected = {
    nameWithOwner: "mbzadev/opengrow-platform",
    branches: { dev: {}, main: {} },
  };
  assert.equal(
    parseGitState(
      {
        branch: "dev",
        head: "a".repeat(40),
        remote: "https://github.com/mbzadev/opengrow-platform.git",
        status: "",
      },
      expected,
    ).ready,
    true,
  );
  const dirty = parseGitState(
    {
      branch: "dev",
      head: "a".repeat(40),
      remote: "https://github.com/mbzadev/opengrow-platform.git",
      status: " M file.ts\n?? new.ts\n",
    },
    expected,
  );
  assert.equal(dirty.ready, false);
  assert.deepEqual(dirty.changes, {
    total: 2,
    modified: 1,
    deleted: 0,
    untracked: 1,
    other: 0,
  });
});

test("credential readiness reports names and presence without secret values", async () => {
  const { target } = await loadTarget("mbza-development");
  const secret = "must-never-be-returned";
  const result = credentialReadiness(target, "development", {
    CLOUDFLARE_ACCOUNT_ID_MBZA_DEVELOPMENT: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: secret,
  });
  assert.equal(result.ready, true);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("application client sources are generic, absolute and environment-addressable", () => {
  assert.deepEqual(
    parseClientSources("vocostar=/work/vocostar;sample-app=/work/sample-app"),
    {
      vocostar: "/work/vocostar",
      "sample-app": "/work/sample-app",
    },
  );
  assert.equal(
    clientSourceEnvironmentName("sample-app"),
    "OPENGROW_CLIENT_SOURCE_SAMPLE_APP",
  );
  assert.throws(
    () => parseClientSources("vocostar=relative/path"),
    /absolute\/path/u,
  );
  assert.throws(
    () => parseClientSources("vocostar=/one;vocostar=/two"),
    /unique/u,
  );
});

test("snapshot verification failures are classified without source contents", () => {
  assert.equal(
    classifySnapshotVerificationError(
      new Error("last run timestamp does not match the reviewed snapshot"),
    ),
    "reviewed-export-receipt-replaced",
  );
  assert.equal(
    classifySnapshotVerificationError(
      new Error("generated hash does not match the reviewed snapshot"),
    ),
    "generated-source-changed",
  );
  assert.equal(
    classifySnapshotVerificationError(new Error("unexpected failure")),
    "snapshot-verification-failed",
  );
});

test("platform readiness rejects a source for an undeclared application", async () => {
  await assert.rejects(
    () =>
      buildReadiness({ clientSources: { unknown: "/work/unknown" }, env: {} }),
    /Unknown FlutterFlow application source/u,
  );
});

test("current offline report is fail-closed and contains actionable blockers", async () => {
  const report = await buildReadiness({ env: {} });
  assert.equal(report.ready, false);
  assert.equal(report.mode, "offline-read-only");
  assert.equal(
    report.blockers.some(
      (blocker) => blocker.id === "mbza-development.resource_ids",
    ),
    false,
  );
  assert.equal(
    report.blockers.some((blocker) => blocker.id === "vocostar.resource_ids"),
    false,
  );
  assert.ok(
    report.blockers.some((blocker) => blocker.id === "vocostar.credentials"),
  );
  assert.ok(
    report.blockers.some((blocker) => blocker.id === "github.not_inspected"),
  );
  assert.ok(
    report.blockers.some(
      (blocker) => blocker.id === "vocostar.flutterflow_convergence",
    ),
  );
  for (const id of [
    "development.google",
    "development.apple",
    "development.support_project",
  ]) {
    const blocker = report.blockers.find((entry) => entry.id === id);
    assert.match(blocker?.action || "", /target:configure-application/u);
    assert.match(blocker?.action || "", /--target mbza-development/u);
    assert.match(blocker?.action || "", /--environment development/u);
  }
  assert.equal(report.stages.historicalParity.ready, true);
  assert.equal(report.stages.historicalParity.releasePolicy, "retired");
  assert.equal(report.stages.historicalParity.sourceAvailable, false);
  assert.equal(
    report.governance.canonicalRepository,
    "mbzadev/opengrow-platform",
  );
  assert.equal(report.stages.localContracts.ready, false);
  assert.deepEqual(report.stages.flutterFlowLibrary, { ready: true });
  assert.deepEqual(report.stages.flutterFlowApplications, { ready: true });
  assert.deepEqual(report.flutterFlowLibrary, {
    schemaVersion: 1,
    status: "ok",
    displayName: "OpenGrow",
    dependencies: 2,
    libraryValues: 11,
    widgets: 5,
    pages: 3,
    actions: 64,
    errors: [],
  });
  assert.deepEqual(report.flutterFlowApplications, {
    schemaVersion: 1,
    status: "ok",
    applications: 1,
    bindings: 11,
    errors: [],
  });
  assert.equal(report.stages.clientConvergence.ready, false);
  const vocostarClient = report.applicationClients.vocostar;
  assert.deepEqual(
    {
      ready: vocostarClient.ready,
      inspected: vocostarClient.inspected,
      snapshotVerified: vocostarClient.snapshotVerified,
      convergenceReady: vocostarClient.convergenceReady,
      sourceEnvironment: vocostarClient.sourceEnvironment,
      blockers: vocostarClient.blockers,
    },
    {
      ready: false,
      inspected: false,
      snapshotVerified: false,
      convergenceReady: false,
      sourceEnvironment: "OPENGROW_CLIENT_SOURCE_VOCOSTAR",
      blockers: ["source-not-inspected"],
    },
  );
  assert.equal(vocostarClient.migration.contractReady, true);
  assert.equal(vocostarClient.migration.contract.convergenceChecks, 35);
  assert.equal(vocostarClient.migration.contract.workItems, 10);
  assert.equal(vocostarClient.migration.contract.replacementSymbols, 36);
  assert.equal(report.deploymentMatrix.ready, true);
  assert.deepEqual(report.securityContracts.oauthDashboardRotation, {
    ready: true,
    migration: "0056_oauth_client_secret_overlap.sql",
    overlapMinutes: 30,
    remoteMigrationState: "not-inspected-by-platform-readiness",
    activation: "inactive-tagged-version-with-database-rollback",
  });
  assert.deepEqual(report.securityContracts.workerSecretBundles, {
    ready: true,
    isolation: "one-contract-graph-per-target-environment",
    nativeValidation: "wrangler-secrets-required",
    upload: "exact-stdin-bundle-to-inactive-tagged-versions",
    promotion:
      "account-bound-version-and-rollback-ids-with-reverse-order-recovery",
    sharedCutover:
      "current-plus-previous-consumers-before-new-token-only-producers",
    retirement: "account-and-version-bound-after-minimum-thirty-minute-overlap",
    legacySingleBindingMutation: "disabled",
  });
  assert.deepEqual(
    report.deploymentMatrix.entries.map(({ id, branch, target }) => ({
      id,
      branch,
      target,
    })),
    [
      {
        id: "mbza-development",
        branch: "dev",
        target: "mbza-development",
      },
      {
        id: "vocostar-production",
        branch: "main",
        target: "vocostar",
      },
    ],
  );
  assert.equal(
    JSON.stringify(report).includes("must-never-be-returned"),
    false,
  );
});

test("strict CLI exits non-zero while operational prerequisites are incomplete", () => {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "scripts/platform-readiness.mjs"), "--strict"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 2, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ready, false);
});
