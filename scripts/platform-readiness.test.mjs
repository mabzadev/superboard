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
  inspectGitHubTag,
  inspectSdkRemoteState,
  parseClientSources,
  parseGitState,
  referenceReadiness,
  requiredResourceIds,
  resolveReferenceRepositoryRoot,
  sdkReadiness,
  targetReadiness,
} from "./platform-readiness.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("reference workspace accepts an explicit absolute CI path", () => {
  assert.equal(
    resolveReferenceRepositoryRoot({
      referenceRoot: "/runner/work/contracts/superboard-reference",
      referenceRepositoryName: "superboard-reference",
      platformRoot: "/runner/work/platform",
    }),
    "/runner/work/contracts/superboard-reference",
  );
  assert.throws(
    () =>
      resolveReferenceRepositoryRoot({
        referenceRoot: "contracts/superboard-reference",
        referenceRepositoryName: "superboard-reference",
      }),
    /absolute path/u,
  );
});

test("target readiness distinguishes unresolved fixtures from provisioned targets", async () => {
  const { target: mbzaSource } = await loadTarget("mbza-development");
  const mbza = targetWithoutResourceIds(mbzaSource, "development");
  const { target: vocostar } = await loadTarget("vocostar");
  const mbzaResult = targetReadiness(mbza, "development");
  const vocostarResult = targetReadiness(vocostar, "production");

  assert.equal(requiredResourceIds(mbza, "development").length, 13);
  assert.equal(mbzaResult.resourceIds.missing.length, 13);
  assert.equal(mbzaResult.resourceIdentity.logicalName, "superboard");
  assert.equal(mbzaResult.resourceIdentity.physicalName, "superboard");
  assert.equal(
    requiredResourceIds(mbza, "development").every(
      ({ logicalName, physicalName, name }) =>
        logicalName.startsWith("superboard") && physicalName === name,
    ),
    true,
  );
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
      { id: "stable", lifecycle: "active", releaseStatus: "released" },
      {
        id: "pending",
        lifecycle: "active",
        releaseStatus: "pending-release",
        sourceVersion: "2.0.0",
        latestReleaseVersion: "1.0.0",
      },
      {
        id: "historical",
        lifecycle: "archived",
        releaseStatus: "released",
        sourceVersion: "1.0.0",
        latestReleaseVersion: "1.0.0",
      },
    ],
  });
  assert.equal(result.ready, false);
  assert.deepEqual(
    result.pending.map((entry) => entry.id),
    ["pending"],
  );
  assert.deepEqual(result.lifecycle, {
    active: 2,
    internal: 0,
    archived: 1,
  });
});

function githubSdkFixture({
  refs = {},
  tags = {},
  releases = [],
  packages = {},
} = {}) {
  const releaseSet = new Set(releases);
  return (args) => {
    const endpoint = args[1];
    const refMarker = "/git/ref/tags/";
    const tagMarker = "/git/tags/";
    const releaseMarker = "/releases/tags/";
    const packageMatch = endpoint.match(
      /(?:^|\/)(?:users|orgs)\/[^/]+\/packages\/([^/]+)\/([^/?]+)(\/versions\?per_page=100)?$/u,
    );
    if (packageMatch) {
      const [, packageType, encodedName, versionsPath] = packageMatch;
      const descriptor =
        packages[`${packageType}/${decodeURIComponent(encodedName)}`];
      if (!descriptor) return { ok: false, notFound: true };
      return versionsPath
        ? {
            ok: true,
            data: descriptor.versions.map((name) => ({ name })),
          }
        : {
            ok: true,
            data: {
              visibility: descriptor.visibility,
              repository: { full_name: descriptor.repository },
            },
          };
    }
    if (endpoint.includes(refMarker)) {
      const reference = decodeURIComponent(endpoint.split(refMarker)[1]);
      const object = refs[reference];
      return object
        ? { ok: true, data: { object } }
        : { ok: false, notFound: true };
    }
    if (endpoint.includes(tagMarker)) {
      const sha = endpoint.split(tagMarker)[1];
      const object = tags[sha];
      return object
        ? { ok: true, data: { object } }
        : { ok: false, notFound: true };
    }
    if (endpoint.includes(releaseMarker)) {
      const reference = decodeURIComponent(endpoint.split(releaseMarker)[1]);
      return releaseSet.has(reference)
        ? { ok: true, data: { tag_name: reference } }
        : { ok: false, notFound: true };
    }
    throw new Error(`Unexpected GitHub fixture endpoint: ${endpoint}`);
  };
}

test("remote SDK readiness peels lightweight, annotated and SwiftPM tags", () => {
  const flutterSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const iosSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const canonicalTagObject = "cccccccccccccccccccccccccccccccccccccccc";
  const aliasTagObject = "dddddddddddddddddddddddddddddddddddddddd";
  const catalogue = {
    libraries: [
      {
        id: "flutter",
        sourceVersion: "2.1.3",
        latestReleaseVersion: "2.1.3",
        releaseRef: "sdk-flutter-v2.1.3",
        releaseStatus: "released",
        releaseSha: flutterSha,
      },
      {
        id: "ios",
        sourceVersion: "1.0.0",
        latestReleaseVersion: "1.0.0",
        releaseRef: "1.0.0",
        releaseStatus: "released",
        releaseSha: iosSha,
      },
    ],
  };
  const fixture = {
    refs: {
      "sdk-flutter-v2.1.3": { type: "commit", sha: flutterSha },
      "sdk-ios-v1.0.0": { type: "tag", sha: canonicalTagObject },
      "1.0.0": { type: "tag", sha: aliasTagObject },
    },
    tags: {
      [canonicalTagObject]: { type: "commit", sha: iosSha },
      [aliasTagObject]: { type: "commit", sha: iosSha },
    },
    releases: ["sdk-flutter-v2.1.3", "sdk-ios-v1.0.0"],
  };
  const run = githubSdkFixture(fixture);
  const remote = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    run,
  );
  assert.equal(remote.ready, true);
  assert.equal(remote.publications[1].packageRefExists, true);
  assert.equal(remote.publications[1].tagSha, iosSha);
  assert.equal(remote.publications[1].packageRefSha, iosSha);
  assert.equal(sdkReadiness(catalogue, remote).ready, true);
  assert.deepEqual(
    inspectGitHubTag("mbzadev/superboard-platform", "sdk-flutter-v2.1.3", run),
    {
      ref: "sdk-flutter-v2.1.3",
      exists: true,
      sha: flutterSha,
      objectType: "commit",
      valid: true,
    },
  );

  const aliasMismatch = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture({
      ...fixture,
      tags: {
        ...fixture.tags,
        [aliasTagObject]: {
          type: "commit",
          sha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        },
      },
    }),
  );
  assert.equal(aliasMismatch.ready, false);
  assert.ok(
    aliasMismatch.publications[1].blockers.includes("package-ref-sha-mismatch"),
  );
});

test("package-backed SDK readiness verifies public ownership and exact versions", () => {
  const androidSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const jsSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const catalogue = {
    libraries: [
      {
        id: "android",
        lifecycle: "active",
        packageName: "io.opengrow:opengrow-android-sdk",
        sourceVersion: "1.0.2",
        latestReleaseVersion: "1.0.2",
        releaseRef: "sdk-android-v1.0.2",
        releaseStatus: "released",
        releaseSha: androidSha,
      },
      {
        id: "javascript",
        lifecycle: "active",
        packageName: "@mbzadev/opengrow-js-sdk",
        sourceVersion: "1.0.2",
        latestReleaseVersion: "1.0.1",
        releaseRef: "sdk-js-v1.0.1",
        releaseStatus: "pending-release",
        releaseSha: jsSha,
      },
    ],
  };
  const fixture = {
    refs: {
      "sdk-android-v1.0.2": { type: "commit", sha: androidSha },
      "sdk-js-v1.0.1": { type: "commit", sha: jsSha },
    },
    releases: ["sdk-android-v1.0.2", "sdk-js-v1.0.1"],
    packages: {
      "maven/io.opengrow.opengrow-android-sdk": {
        visibility: "public",
        repository: "mbzadev/superboard-platform",
        versions: ["1.0.2"],
      },
      "npm/opengrow-js-sdk": {
        visibility: "public",
        repository: "mbzadev/superboard-platform",
        versions: ["1.0.1"],
      },
    },
  };
  const ready = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture(fixture),
  );
  assert.equal(ready.ready, true);
  assert.equal(ready.publications[0].packageArtifact.visibility, "public");
  assert.equal(ready.publications[1].candidateReady, true);
  assert.equal(ready.publications[1].baseline.ready, true);

  const occupiedCandidate = structuredClone(fixture);
  occupiedCandidate.packages["npm/opengrow-js-sdk"].versions.push("1.0.2");
  const occupied = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture(occupiedCandidate),
  );
  assert.equal(occupied.ready, false);
  assert.ok(
    occupied.publications[1].blockers.includes(
      "candidate-package-version-exists",
    ),
  );

  const wrongOwner = structuredClone(fixture);
  wrongOwner.packages["maven/io.opengrow.opengrow-android-sdk"].repository =
    "mbzadev/opengrow";
  const mismatched = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture(wrongOwner),
  );
  assert.ok(
    mismatched.publications[0].blockers.includes(
      "package-artifact-repository-mismatch",
    ),
  );
});

test("pending SDK readiness checks both the baseline and unused candidate", () => {
  const baselineSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const catalogue = {
    libraries: [
      {
        id: "flutterflow",
        lifecycle: "active",
        sourceVersion: "2.2.4",
        latestReleaseVersion: "2.1.6",
        releaseRef: "sdk-flutterflow-v2.1.6",
        releaseStatus: "pending-release",
        releaseSha: baselineSha,
      },
    ],
  };
  const run = githubSdkFixture({
    refs: {
      "sdk-flutterflow-v2.1.6": { type: "commit", sha: baselineSha },
    },
    releases: ["sdk-flutterflow-v2.1.6"],
  });
  const remote = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    run,
  );
  assert.equal(remote.ready, true);
  assert.equal(remote.publications[0].candidateReady, true);
  assert.equal(remote.publications[0].baseline.ready, true);
  assert.equal(sdkReadiness(catalogue, remote).ready, false);

  const missingBaseline = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture(),
  );
  assert.equal(missingBaseline.ready, false);
  assert.ok(
    missingBaseline.publications[0].blockers.includes(
      "baseline-release-tag-missing",
    ),
  );
});

test("remote SDK readiness verifies every immutable failed ref and no release", () => {
  const failedSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const canonicalObject = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const aliasObject = "cccccccccccccccccccccccccccccccccccccccc";
  const history = {
    immutableFailures: [
      {
        libraryId: "ios",
        version: "1.0.1",
        releaseTag: "sdk-ios-v1.0.1",
        packageRefs: ["1.0.1"],
        releaseSha: failedSha,
        workflowRunId: 1,
      },
    ],
  };
  const fixture = {
    refs: {
      "sdk-ios-v1.0.1": { type: "tag", sha: canonicalObject },
      "1.0.1": { type: "tag", sha: aliasObject },
    },
    tags: {
      [canonicalObject]: { type: "commit", sha: failedSha },
      [aliasObject]: { type: "commit", sha: failedSha },
    },
  };
  const remote = inspectSdkRemoteState(
    { libraries: [] },
    "mbzadev/superboard-platform",
    githubSdkFixture(fixture),
    history,
  );
  assert.equal(remote.ready, true);
  assert.equal(remote.failedReleases.failures[0].refs.length, 2);

  const unexpectedRelease = inspectSdkRemoteState(
    { libraries: [] },
    "mbzadev/superboard-platform",
    githubSdkFixture({
      ...fixture,
      releases: ["sdk-ios-v1.0.1"],
    }),
    history,
  );
  assert.equal(unexpectedRelease.ready, false);
  assert.ok(
    unexpectedRelease.failedReleases.failures[0].blockers.includes(
      "failed-release-has-github-release",
    ),
  );
});

test("remote readiness distinguishes a recorded failure from an unknown occupied tag", () => {
  const baselineSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const failedSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const catalogue = {
    libraries: [
      {
        id: "ios",
        lifecycle: "active",
        sourceVersion: "1.0.1",
        latestReleaseVersion: "1.0.0",
        releaseRef: "1.0.0",
        releaseStatus: "pending-release",
        releaseSha: baselineSha,
      },
    ],
  };
  const refs = {
    "sdk-ios-v1.0.0": { type: "commit", sha: baselineSha },
    "1.0.0": { type: "commit", sha: baselineSha },
    "sdk-ios-v1.0.1": { type: "commit", sha: failedSha },
    "1.0.1": { type: "commit", sha: failedSha },
  };
  const history = {
    immutableFailures: [
      {
        libraryId: "ios",
        version: "1.0.1",
        releaseTag: "sdk-ios-v1.0.1",
        packageRefs: ["1.0.1"],
        releaseSha: failedSha,
        workflowRunId: 123,
      },
    ],
  };
  const recorded = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture({ refs, releases: ["sdk-ios-v1.0.0"] }),
    history,
  );
  assert.equal(recorded.publications[0].candidateReady, false);
  assert.deepEqual(recorded.publications[0].failedCandidate, {
    releaseTag: "sdk-ios-v1.0.1",
    workflowRunId: 123,
  });
  assert.ok(
    recorded.publications[0].blockers.includes("failed-immutable-version"),
  );

  const unknown = inspectSdkRemoteState(
    catalogue,
    "mbzadev/superboard-platform",
    githubSdkFixture({ refs, releases: ["sdk-ios-v1.0.0"] }),
  );
  assert.equal(unknown.publications[0].failedCandidate, null);
  assert.ok(unknown.publications[0].blockers.includes("candidate-tag-exists"));
  assert.ok(
    unknown.publications[0].blockers.includes("candidate-package-ref-exists"),
  );
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
  governance.canonicalRepository = "example/superboard-platform";
  governance.referenceRepository = "example/superboard-reference";

  const validate = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validate(governance), true, JSON.stringify(validate.errors));
});

test("reference readiness binds short links and source versions to the target", async () => {
  const { target } = await loadTarget("mbza-development");
  const repositories = {
    platform: { nameWithOwner: "mbzadev/superboard-platform" },
    reference: { nameWithOwner: "mbzadev/superboard-reference" },
  };
  const project = {
    platformRepository: "https://github.com/mbzadev/superboard-platform",
    referenceRepository: "https://github.com/mbzadev/superboard-reference",
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
      workerName: "superboard-reference-app-dev",
    },
    endpoints: {
      referenceWeb: "https://reference.mbza.dev",
      dashboard: "https://board.mbza.dev",
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
    nameWithOwner: "mbzadev/superboard-platform",
    branches: { dev: {}, main: {} },
  };
  assert.equal(
    parseGitState(
      {
        branch: "dev",
        head: "a".repeat(40),
        remote: "https://github.com/mbzadev/superboard-platform.git",
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
      remote: "https://github.com/mbzadev/superboard-platform.git",
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
    "SUPERBOARD_CLIENT_SOURCE_SAMPLE_APP",
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
    "mbzadev/superboard-platform",
  );
  assert.equal(report.stages.localContracts.ready, false);
  assert.deepEqual(report.stages.flutterFlowLibrary, { ready: true });
  assert.deepEqual(report.stages.flutterFlowApplications, { ready: true });
  assert.deepEqual(report.flutterFlowLibrary, {
    schemaVersion: 1,
    status: "ok",
    displayName: "SuperBoard",
    dependencies: 1,
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
      sourceEnvironment: "SUPERBOARD_CLIENT_SOURCE_VOCOSTAR",
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
