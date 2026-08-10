#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import {
  cloudflareAccountEnvName,
  loadTarget,
  parseArgs,
  root,
} from "./cloudflare-target.mjs";
import {
  inspectRepository,
  loadGitHubControlPlane,
} from "./github-readiness.mjs";
import {
  loadDeploymentMatrix,
  validateControlPlaneCoverage,
} from "./github-deployment-matrix.mjs";
import {
  DOMAIN_SERVICES,
  DOMAIN_SERVICE_REGISTRY,
} from "./cloudflare-services.mjs";
import { flutterFlowSourceEnvironmentName } from "./flutterflow-source-verify.mjs";
import { buildFlutterFlowMigrationPlan } from "./flutterflow-migration-plan.mjs";
import { validateFlutterFlowLibraryContract } from "./flutterflow-library-contract.mjs";
import { validateFlutterFlowApplicationWorkspaces } from "./flutterflow-application-dsl.mjs";
import { releaseCandidateTagFor, releaseTagFor } from "./sdk-catalog.mjs";
import {
  canonicalReleaseTag,
  immutableFailureFor,
} from "./sdk-release-history.mjs";

const uuidPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const kvPattern = /^[a-f0-9]{32}$/iu;

export function requiredResourceIds(target, environment) {
  const resources = target.environments?.[environment];
  if (!resources)
    throw new Error(`${target.target} does not define ${environment}`);
  const required = [
    resource("d1", "Central API D1", resources.d1, uuidPattern),
    resource("kv", "API KV", resources.kv, kvPattern),
    resource("emailD1", "Email D1", resources.emailD1, uuidPattern),
    resource("identityD1", "Identity D1", resources.identityD1, uuidPattern),
    resource("filesD1", "Files D1", resources.filesD1, uuidPattern),
  ];

  if (target.features?.messaging) {
    required.push(
      resource(
        "messagingD1",
        "Legacy Messaging D1",
        resources.messagingD1,
        uuidPattern,
      ),
    );
  }
  if (target.customWorker?.d1Binding) {
    required.push(
      resource("customD1", "Custom Worker D1", resources.customD1, uuidPattern),
    );
  }
  for (const service of DOMAIN_SERVICES.filter(
    (name) => target.features?.[name],
  )) {
    const resourceKey = DOMAIN_SERVICE_REGISTRY[service].resourceKey;
    required.push(
      resource(
        `moduleD1.${resourceKey}`,
        `${service} D1`,
        resources.moduleD1?.[resourceKey],
        uuidPattern,
      ),
    );
  }
  return required;
}

function resource(key, label, value, pattern) {
  const id = String(value?.id || "").trim();
  return {
    key,
    label,
    name: String(value?.name || ""),
    configured: pattern.test(id),
  };
}

export function targetReadiness(target, environment) {
  const resourceIds = requiredResourceIds(target, environment);
  const missing = resourceIds.filter((entry) => !entry.configured);
  const environmentResources = target.environments[environment];
  const identity = target.applicationIdentity || {};
  const acceptance = {
    googleAudienceConfigured:
      Array.isArray(identity.googleAudiences) &&
      identity.googleAudiences.length > 0,
    appleAudienceConfigured:
      Array.isArray(identity.appleAudiences) &&
      identity.appleAudiences.length > 0,
    supportProjectAllowlisted:
      !target.features?.support ||
      (target.environments[environment].supportProjectIds || []).length > 0,
    developmentMailCaptured:
      environment !== "development" || target.mail?.transport === "capture",
    legacyMessagingDisabled: target.features?.messaging === false,
    dashboardCacheIsolated:
      environmentResources.dashboardCache?.name !==
      environmentResources.r2?.name,
  };
  return {
    target: target.target,
    environment,
    manifestProvisioned: missing.length === 0,
    resourceIds: {
      required: resourceIds.length,
      configured: resourceIds.length - missing.length,
      missing: missing.map(({ key, label, name }) => ({ key, label, name })),
    },
    acceptance,
  };
}

export function inspectSdkRemoteState(
  catalogue,
  repository,
  run = runGitHubRead,
  releaseHistory = { immutableFailures: [] },
) {
  const publications = (catalogue.libraries || []).map((library) => {
    const pending = library.releaseStatus !== "released";
    const tag = pending
      ? releaseCandidateTagFor(catalogue, library.id)
      : releaseTagFor(catalogue, library.id);
    const packageRef = pending
      ? library.id === "ios"
        ? library.sourceVersion
        : tag
      : library.releaseRef;
    const tagState = inspectGitHubTag(repository, tag, run);
    const packageRefState =
      packageRef === tag
        ? tagState
        : inspectGitHubTag(repository, packageRef, run);
    const releaseExists = githubReleaseExists(repository, tag, run);
    const packageArtifact = inspectGitHubPackageArtifact(
      library,
      repository,
      run,
    );
    const failedCandidate = pending
      ? immutableFailureFor(releaseHistory, library.id, library.sourceVersion)
      : null;
    const candidateReady = pending
      ? failedCandidate === null &&
        !tagState.exists &&
        !packageRefState.exists &&
        !releaseExists &&
        !packageArtifact?.versions.includes(library.sourceVersion)
      : null;
    const baseline = pending
      ? inspectPublishedBaseline(library, repository, run, packageArtifact)
      : null;
    const blockers = [];
    if (pending) {
      if (failedCandidate) blockers.push("failed-immutable-version");
      else {
        if (tagState.exists) blockers.push("candidate-tag-exists");
        if (packageRefState.exists && packageRef !== tag)
          blockers.push("candidate-package-ref-exists");
        if (releaseExists) blockers.push("candidate-release-exists");
        if (packageArtifact?.versions.includes(library.sourceVersion))
          blockers.push("candidate-package-version-exists");
      }
      blockers.push(...baseline.blockers);
    } else {
      if (!tagState.exists) blockers.push("release-tag-missing");
      else if (tagState.sha !== library.releaseSha)
        blockers.push("release-tag-sha-mismatch");
      if (!packageRefState.exists) blockers.push("package-ref-missing");
      else if (packageRefState.sha !== library.releaseSha)
        blockers.push("package-ref-sha-mismatch");
      if (!releaseExists) blockers.push("github-release-missing");
      blockers.push(
        ...packageArtifactBlockers(
          packageArtifact,
          library.latestReleaseVersion,
        ),
      );
    }
    return {
      id: library.id,
      status: library.releaseStatus,
      tag,
      expectedSha: pending ? null : library.releaseSha,
      tagExists: tagState.exists,
      tagSha: tagState.sha,
      tagObjectType: tagState.objectType,
      releaseExists,
      packageRef,
      packageRefExists: packageRefState.exists,
      packageRefSha: packageRefState.sha,
      candidateReady,
      failedCandidate: failedCandidate
        ? {
            releaseTag: failedCandidate.releaseTag,
            workflowRunId: failedCandidate.workflowRunId,
          }
        : null,
      baseline,
      packageArtifact,
      blockers,
      ready: pending ? candidateReady && baseline.ready : blockers.length === 0,
    };
  });
  const failedReleases = releaseHistoryRemoteState(
    releaseHistory,
    repository,
    run,
  );
  return {
    inspected: true,
    ready:
      publications.every((publication) => publication.ready) &&
      failedReleases.ready,
    publications,
    failedReleases,
  };
}

export function inspectGitHubTag(repository, reference, run = runGitHubRead) {
  const seen = new Set();
  const initial = run([
    "api",
    `repos/${repository}/git/ref/tags/${encodeURIComponent(reference)}`,
  ]);
  if (!initial.ok) {
    return {
      ref: reference,
      exists: false,
      sha: null,
      objectType: null,
      valid: initial.notFound === true,
    };
  }
  let object = responseData(initial)?.object;
  const objectType = object?.type ?? null;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!object || !/^[0-9a-f]{40}$/u.test(object.sha ?? "")) {
      return {
        ref: reference,
        exists: true,
        sha: null,
        objectType,
        valid: false,
      };
    }
    if (object.type === "commit") {
      return {
        ref: reference,
        exists: true,
        sha: object.sha,
        objectType,
        valid: true,
      };
    }
    if (object.type !== "tag" || seen.has(object.sha)) break;
    seen.add(object.sha);
    const tag = run(["api", `repos/${repository}/git/tags/${object.sha}`]);
    if (!tag.ok) break;
    object = responseData(tag)?.object;
  }
  return {
    ref: reference,
    exists: true,
    sha: null,
    objectType,
    valid: false,
  };
}

function inspectPublishedBaseline(library, repository, run, packageArtifact) {
  const tag = canonicalReleaseTag(library.id, library.latestReleaseVersion);
  const tagState = inspectGitHubTag(repository, tag, run);
  const packageRefState =
    library.releaseRef === tag
      ? tagState
      : inspectGitHubTag(repository, library.releaseRef, run);
  const releaseExists = githubReleaseExists(repository, tag, run);
  const blockers = [];
  if (!library.releaseSha) blockers.push("baseline-release-sha-unrecorded");
  if (!tagState.exists) blockers.push("baseline-release-tag-missing");
  else if (library.releaseSha && tagState.sha !== library.releaseSha)
    blockers.push("baseline-release-tag-sha-mismatch");
  if (!packageRefState.exists) blockers.push("baseline-package-ref-missing");
  else if (library.releaseSha && packageRefState.sha !== library.releaseSha)
    blockers.push("baseline-package-ref-sha-mismatch");
  if (!releaseExists) blockers.push("baseline-github-release-missing");
  blockers.push(
    ...packageArtifactBlockers(
      packageArtifact,
      library.latestReleaseVersion,
      "baseline-",
    ),
  );
  return {
    tag,
    expectedSha: library.releaseSha ?? null,
    tagExists: tagState.exists,
    tagSha: tagState.sha,
    packageRef: library.releaseRef,
    packageRefExists: packageRefState.exists,
    packageRefSha: packageRefState.sha,
    releaseExists,
    packageArtifact,
    blockers,
    ready: blockers.length === 0,
  };
}

function packageDescriptor(library) {
  if (["javascript", "react-native"].includes(library.id)) {
    return {
      packageType: "npm",
      packageName: String(library.packageName ?? "").replace(/^@[^/]+\//u, ""),
    };
  }
  if (library.id === "android") {
    return {
      packageType: "maven",
      packageName: String(library.packageName ?? "").replace(":", "."),
    };
  }
  return null;
}

function inspectGitHubPackageArtifact(library, repository, run) {
  const descriptor = packageDescriptor(library);
  if (!descriptor) return null;
  const [owner] = repository.split("/");
  let selected = null;
  let packageResult = null;
  for (const scope of ["users", "orgs"]) {
    const root = `${scope}/${owner}/packages/${descriptor.packageType}/${encodeURIComponent(descriptor.packageName)}`;
    const result = run(["api", root]);
    if (result.ok) {
      selected = root;
      packageResult = result;
      break;
    }
    if (result.notFound !== true) {
      return {
        ...descriptor,
        expectedRepository: repository,
        exists: false,
        valid: false,
        visibility: null,
        repository: null,
        versions: [],
      };
    }
  }
  if (!selected) {
    return {
      ...descriptor,
      expectedRepository: repository,
      exists: false,
      valid: true,
      visibility: null,
      repository: null,
      versions: [],
    };
  }
  const details = responseData(packageResult);
  const versionsResult = run(["api", `${selected}/versions?per_page=100`]);
  const versionsData = responseData(versionsResult);
  return {
    ...descriptor,
    expectedRepository: repository,
    exists: true,
    valid: versionsResult.ok && Array.isArray(versionsData),
    visibility: details?.visibility ?? null,
    repository: details?.repository?.full_name ?? null,
    versions: Array.isArray(versionsData)
      ? versionsData
          .map((version) => version?.name)
          .filter((version) => typeof version === "string")
      : [],
  };
}

function packageArtifactBlockers(artifact, version, prefix = "") {
  if (!artifact) return [];
  const blockers = [];
  if (!artifact.exists) blockers.push(`${prefix}package-artifact-missing`);
  else {
    if (!artifact.valid) blockers.push(`${prefix}package-artifact-invalid`);
    if (artifact.visibility !== "public")
      blockers.push(`${prefix}package-artifact-not-public`);
    if (artifact.repository !== artifact.expectedRepository)
      blockers.push(`${prefix}package-artifact-repository-mismatch`);
    if (!artifact.versions.includes(version))
      blockers.push(`${prefix}package-version-missing`);
  }
  return blockers;
}

function releaseHistoryRemoteState(history, repository, run) {
  const failures = (history?.immutableFailures ?? []).map((failure) => {
    const refs = [failure.releaseTag, ...failure.packageRefs].map(
      (reference) => {
        const state = inspectGitHubTag(repository, reference, run);
        return {
          ref: reference,
          exists: state.exists,
          sha: state.sha,
          ready: state.exists && state.sha === failure.releaseSha,
        };
      },
    );
    const releaseExists = githubReleaseExists(
      repository,
      failure.releaseTag,
      run,
    );
    const blockers = [];
    for (const reference of refs) {
      if (!reference.exists)
        blockers.push(`failed-ref-missing:${reference.ref}`);
      else if (reference.sha !== failure.releaseSha)
        blockers.push(`failed-ref-sha-mismatch:${reference.ref}`);
    }
    if (releaseExists) blockers.push("failed-release-has-github-release");
    return {
      libraryId: failure.libraryId,
      version: failure.version,
      releaseTag: failure.releaseTag,
      expectedSha: failure.releaseSha,
      refs,
      releaseExists,
      blockers,
      ready: blockers.length === 0,
    };
  });
  return {
    ready: failures.every((failure) => failure.ready),
    failures,
  };
}

function githubReleaseExists(repository, tag, run) {
  return run([
    "api",
    `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
  ]).ok;
}

function responseData(result) {
  if (result?.data && typeof result.data === "object") return result.data;
  try {
    return JSON.parse(result?.stdout ?? "");
  } catch {
    return null;
  }
}

export function sdkReadiness(catalogue, remoteState = null) {
  const pending = (catalogue.libraries || [])
    .filter((library) => library.releaseStatus !== "released")
    .map((library) => ({
      id: library.id,
      sourceVersion: library.sourceVersion,
      latestReleaseVersion: library.latestReleaseVersion,
      releaseStatus: library.releaseStatus,
    }));
  return {
    ready:
      pending.length === 0 &&
      (remoteState === null || remoteState.ready === true),
    total: (catalogue.libraries || []).length,
    pending,
    remote: remoteState ?? {
      inspected: false,
      ready: null,
      publications: null,
    },
  };
}

function runGitHubRead(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    notFound: result.status === 1 && /HTTP 404|Not Found/iu.test(result.stderr),
    stdout: result.stdout,
  };
}

export function referenceReadiness(
  project,
  developmentTarget,
  sdkCatalogue,
  repositories,
) {
  const expectedLibraries = new Map(
    (sdkCatalogue.libraries || []).map((library) => [library.id, library]),
  );
  const referenceSurface = developmentTarget.publicSurfaceMonitors?.find(
    (surface) => surface.id === "reference",
  );
  const referenceUrl = referenceSurface?.url || null;
  const referenceHostname = referenceUrl
    ? new URL(referenceUrl).hostname
    : null;
  const repositoryUrl = (repository) =>
    repository?.nameWithOwner
      ? `https://github.com/${repository.nameWithOwner}`
      : null;
  const checks = [
    check("target", project.target === developmentTarget.target),
    check("environment", project.environment === "development"),
    check("deployment_branch", project.deployment?.branch === "dev"),
    check(
      "deployment_environment",
      project.deployment?.environment === "development",
    ),
    check(
      "deployment_worker",
      /^[a-z0-9][a-z0-9-]*$/u.test(project.deployment?.workerName || ""),
    ),
    check(
      "platform_repository",
      project.platformRepository === repositoryUrl(repositories?.platform),
    ),
    check(
      "reference_repository",
      project.referenceRepository === repositoryUrl(repositories?.reference),
    ),
    check("sdk_platform", project.sdkApplication?.platform === "web"),
    check(
      "sdk_identifier",
      Boolean(referenceHostname) &&
        project.sdkApplication?.identifier === referenceHostname,
    ),
    check(
      "sdk_environment",
      project.sdkApplication?.projectEnvironment === "test",
    ),
    check(
      "reference_domain",
      Boolean(referenceUrl) && project.endpoints?.referenceWeb === referenceUrl,
    ),
    check(
      "dashboard_domain",
      project.endpoints?.dashboard ===
        `https://${developmentTarget.domains.dashboard}`,
    ),
    check(
      "api_domain",
      project.endpoints?.api === `https://${developmentTarget.domains.api}`,
    ),
    check(
      "sdk_domain",
      project.endpoints?.sdk === `https://${developmentTarget.domains.sdk}`,
    ),
    check(
      "short_links_domain",
      project.endpoints?.shortLinks ===
        `https://${developmentTarget.domains.shortlinks}`,
    ),
    check(
      "files_domain",
      project.endpoints?.files === `https://${developmentTarget.domains.files}`,
    ),
    check(
      "mail_preview_domain",
      project.endpoints?.mailPreview ===
        `https://${developmentTarget.domains.mailPreview}`,
    ),
    check(
      "support_domain",
      project.endpoints?.support ===
        `https://${developmentTarget.domains.api}/api/v1/support-client`,
    ),
    check(
      "flutterflow_source_version",
      project.libraries?.opengrow_flutterflow?.sourceVersion ===
        expectedLibraries.get("flutterflow")?.sourceVersion,
    ),
    check(
      "flutterflow_release_version",
      project.libraries?.opengrow_flutterflow?.releaseVersion ===
        expectedLibraries.get("flutterflow")?.latestReleaseVersion,
    ),
    check(
      "flutterflow_release_ref",
      project.libraries?.opengrow_flutterflow?.releaseRef ===
        expectedLibraries.get("flutterflow")?.releaseRef,
    ),
    check(
      "support_source_version",
      project.libraries?.opengrow_flutterflow_messaging?.sourceVersion ===
        expectedLibraries.get("flutterflow-support")?.sourceVersion,
    ),
    check(
      "support_release_version",
      project.libraries?.opengrow_flutterflow_messaging?.releaseVersion ===
        expectedLibraries.get("flutterflow-support")?.latestReleaseVersion,
    ),
    check(
      "support_release_ref",
      project.libraries?.opengrow_flutterflow_messaging?.releaseRef ===
        expectedLibraries.get("flutterflow-support")?.releaseRef,
    ),
  ];
  return { ready: checks.every((entry) => entry.ready), checks };
}

function check(id, ready) {
  return { id, ready: Boolean(ready) };
}

export function parseGitState({ branch, head, remote, status }, expected) {
  const changes = String(status || "")
    .split(/\r?\n/u)
    .filter(Boolean);
  const counts = { modified: 0, deleted: 0, untracked: 0, other: 0 };
  for (const row of changes) {
    const code = row.slice(0, 2);
    if (code === "??") counts.untracked += 1;
    else if (code.includes("D")) counts.deleted += 1;
    else if (code.includes("M")) counts.modified += 1;
    else counts.other += 1;
  }
  const normalizedRemote = String(remote || "").replace(/\.git$/u, "");
  const normalizedExpected = `https://github.com/${expected.nameWithOwner}`;
  return {
    ready:
      Boolean(head) &&
      changes.length === 0 &&
      Object.hasOwn(expected.branches, branch) &&
      normalizedRemote === normalizedExpected,
    branch: branch || null,
    hasCommit: Boolean(head),
    clean: changes.length === 0,
    expectedBranch: Object.hasOwn(expected.branches, branch),
    remoteConfigured: normalizedRemote === normalizedExpected,
    changes: { total: changes.length, ...counts },
  };
}

export function credentialReadiness(target, environment, env = process.env) {
  const scopedAccountName = cloudflareAccountEnvName(target);
  const required = [
    {
      name: scopedAccountName,
      configured: Boolean(
        String(
          env[scopedAccountName] || env.CLOUDFLARE_ACCOUNT_ID || "",
        ).trim(),
      ),
    },
    {
      name: "CLOUDFLARE_API_TOKEN",
      configured: Boolean(String(env.CLOUDFLARE_API_TOKEN || "").trim()),
    },
  ];
  if (environment === "production") {
    required.push({
      name: "OPENGROW_BACKUP_ENCRYPTION_KEY",
      configured: Boolean(
        String(env.OPENGROW_BACKUP_ENCRYPTION_KEY || "").trim(),
      ),
    });
  }
  return { ready: required.every((entry) => entry.configured), required };
}

function inspectGit(directory, expected) {
  const run = (args) =>
    spawnSync("git", ["-C", directory, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  const branch = run(["branch", "--show-current"]);
  const head = run(["rev-parse", "--verify", "HEAD"]);
  const remote = run(["remote", "get-url", "origin"]);
  const status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  return parseGitState(
    {
      branch: branch.status === 0 ? branch.stdout.trim() : "",
      head: head.status === 0 ? head.stdout.trim() : "",
      remote: remote.status === 0 ? remote.stdout.trim() : "",
      status: status.status === 0 ? status.stdout : "",
    },
    expected,
  );
}

function addBlocker(blockers, condition, id, scope, detail, action) {
  if (condition) blockers.push({ id, scope, detail, action });
}

export const clientSourceEnvironmentName = flutterFlowSourceEnvironmentName;

export function classifySnapshotVerificationError(error) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/last run timestamp does not match/u.test(detail)) {
    return "reviewed-export-receipt-replaced";
  }
  if (/fingerprint does not match/u.test(detail)) {
    return "reviewed-metadata-changed";
  }
  if (/generated hash does not match/u.test(detail)) {
    return "generated-source-changed";
  }
  if (/Unable to read|is missing|does not exist/u.test(detail)) {
    return "source-metadata-missing";
  }
  return "snapshot-verification-failed";
}

export function parseClientSources(value) {
  if (!value) return {};
  const result = {};
  for (const entry of String(value).split(";")) {
    const separator = entry.indexOf("=");
    const application = entry.slice(0, separator).trim();
    const source = entry.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^[a-z0-9][a-z0-9-]*$/u.test(application) ||
      !isAbsolute(source) ||
      Object.hasOwn(result, application)
    ) {
      throw new Error(
        "--client-sources must contain unique application=/absolute/path entries separated by semicolons",
      );
    }
    result[application] = source;
  }
  return result;
}

async function applicationClientReadiness({ clientSources, env }) {
  const directory = resolve(root, "config/flutterflow-sources");
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const clients = {};
  for (const name of files) {
    const manifestPath = resolve(directory, name);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const application = manifest.application;
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(application || "")) {
      throw new Error(`Invalid FlutterFlow application in ${name}`);
    }
    if (clients[application]) {
      throw new Error(
        `Duplicate FlutterFlow application snapshot: ${application}`,
      );
    }
    const environmentName = clientSourceEnvironmentName(application);
    const migrationManifestPath = resolve(
      root,
      "config/flutterflow-migrations",
      `${application}.json`,
    );
    if (!existsSync(migrationManifestPath)) {
      clients[application] = {
        ready: false,
        inspected: false,
        snapshotVerified: false,
        convergenceReady: false,
        sourceEnvironment: environmentName,
        blockers: ["migration-plan-missing"],
      };
      continue;
    }
    const contractPlan = await buildFlutterFlowMigrationPlan({
      manifestPath: migrationManifestPath,
    });
    const sourcePath = clientSources[application] || env[environmentName];
    if (!sourcePath) {
      clients[application] = {
        ready: false,
        inspected: false,
        snapshotVerified: false,
        convergenceReady: false,
        sourceEnvironment: environmentName,
        blockers: ["source-not-inspected"],
        migration: migrationReadiness(contractPlan),
      };
      continue;
    }
    if (!isAbsolute(sourcePath)) {
      clients[application] = {
        ready: false,
        inspected: false,
        snapshotVerified: false,
        convergenceReady: false,
        sourceEnvironment: environmentName,
        blockers: ["source-path-not-absolute"],
        migration: migrationReadiness(contractPlan),
      };
      continue;
    }
    try {
      const migration = await buildFlutterFlowMigrationPlan({
        manifestPath: migrationManifestPath,
        sourcePath,
      });
      const convergenceReady = migration.convergenceReady === true;
      clients[application] = {
        ready: migration.snapshotVerified === true && convergenceReady,
        inspected: true,
        snapshotVerified: migration.snapshotVerified === true,
        convergenceReady,
        sourceEnvironment: environmentName,
        project: migration.project,
        inventory: migration.inventory,
        diagnostics: migration.diagnostics,
        convergence: migration.convergence,
        migration: migrationReadiness(migration),
        blockers: migration.convergenceBlockers || [
          "convergence-contract-missing",
        ],
      };
    } catch (error) {
      const verificationIssue = classifySnapshotVerificationError(error);
      clients[application] = {
        ready: false,
        inspected: true,
        snapshotVerified: false,
        convergenceReady: false,
        sourceEnvironment: environmentName,
        verificationIssue,
        blockers: [verificationIssue],
        migration: migrationReadiness(contractPlan),
      };
    }
  }
  const unknownSources = Object.keys(clientSources).filter(
    (application) => !Object.hasOwn(clients, application),
  );
  if (unknownSources.length > 0) {
    throw new Error(
      `Unknown FlutterFlow application source: ${unknownSources.sort().join(", ")}`,
    );
  }
  return clients;
}

function migrationReadiness(plan) {
  return {
    contractReady: plan.contractReady,
    sourceInspected: plan.sourceInspected,
    ready: plan.ready,
    target: plan.target,
    environment: plan.environment,
    contract: plan.contract,
    phases: plan.phases,
    workItems: plan.workItems,
    blockedWorkItems: plan.blockedWorkItems,
  };
}

export async function buildReadiness({
  remote = false,
  referenceRoot = process.env.OPENGROW_REFERENCE_ROOT || null,
  clientSources = {},
  env = process.env,
} = {}) {
  const controlPlane = await loadGitHubControlPlane();
  const deploymentConfiguration = await loadDeploymentMatrix();
  validateControlPlaneCoverage(deploymentConfiguration, controlPlane);
  const deploymentMatrix = {
    ready: true,
    schemaVersion: deploymentConfiguration.schemaVersion,
    entries: deploymentConfiguration.deployments.map((deployment) => ({
      id: deployment.id,
      branch: deployment.branch,
      githubEnvironment: deployment.githubEnvironment,
      cloudflareEnvironment: deployment.cloudflareEnvironment,
      target:
        controlPlane.repositories.platform.environments[
          deployment.githubEnvironment
        ].variables.OPENGROW_TARGET,
      referenceAcceptance: deployment.referenceAcceptance,
    })),
  };
  const referenceRepositoryName =
    controlPlane.repositories.reference.nameWithOwner.split("/").at(-1);
  const resolvedReferenceRoot = resolveReferenceRepositoryRoot({
    referenceRoot,
    referenceRepositoryName,
  });
  const targetNames = [
    ...new Set(deploymentMatrix.entries.map((entry) => entry.target)),
  ];
  const targets = {};
  const loadedTargets = {};
  for (const targetName of targetNames) {
    const { target } = await loadTarget(targetName);
    loadedTargets[targetName] = target;
    const environment = Object.keys(target.environments)[0];
    targets[targetName] = {
      ...targetReadiness(target, environment),
      credentials: credentialReadiness(target, environment, env),
    };
  }

  const catalogue = JSON.parse(
    await readFile(resolve(root, "config/sdk-libraries.json"), "utf8"),
  );
  const sdkReleaseHistory = JSON.parse(
    await readFile(resolve(root, "config/sdk-release-history.json"), "utf8"),
  );
  const sdkRemote = remote
    ? inspectSdkRemoteState(
        catalogue,
        controlPlane.repositories.platform.nameWithOwner,
        runGitHubRead,
        sdkReleaseHistory,
      )
    : null;
  const sdk = sdkReadiness(catalogue, sdkRemote);
  const flutterFlowLibrary = await validateFlutterFlowLibraryContract();
  const flutterFlowApplications =
    await validateFlutterFlowApplicationWorkspaces();
  const governance = JSON.parse(
    await readFile(resolve(root, "config/platform-governance.json"), "utf8"),
  );
  const governanceSchema = JSON.parse(
    await readFile(
      resolve(root, "schemas/platform-governance.schema.json"),
      "utf8",
    ),
  );
  const validateGovernance = new Ajv2020({ allErrors: true }).compile(
    governanceSchema,
  );
  if (!validateGovernance(governance)) {
    throw new Error(
      `Invalid platform governance: ${JSON.stringify(validateGovernance.errors)}`,
    );
  }
  if (
    governance.canonicalRepository !==
      controlPlane.repositories.platform.nameWithOwner ||
    governance.referenceRepository !==
      controlPlane.repositories.reference.nameWithOwner
  ) {
    throw new Error(
      "Platform governance repositories must match the GitHub control plane",
    );
  }
  const referenceProject = JSON.parse(
    await readFile(
      resolve(resolvedReferenceRoot, "reference.project.json"),
      "utf8",
    ),
  );
  const referenceDeployment = deploymentMatrix.entries.find(
    (deployment) => deployment.referenceAcceptance,
  );
  if (!referenceDeployment) {
    throw new Error("Deployment matrix does not declare reference acceptance");
  }
  const developmentTargetName = referenceDeployment.target;
  const reference = referenceReadiness(
    referenceProject,
    loadedTargets[developmentTargetName],
    catalogue,
    controlPlane.repositories,
  );
  const git = {
    platform: inspectGit(root, controlPlane.repositories.platform),
    reference: inspectGit(
      resolvedReferenceRoot,
      controlPlane.repositories.reference,
    ),
  };
  const repositories = remote
    ? Object.values(controlPlane.repositories).map((repository) =>
        inspectRepository(repository),
      )
    : null;
  const disconnectedBranchHistories = remote
    ? repositories.filter(
        (repository) => repository.branchHistory?.ready === false,
      )
    : [];
  const github = {
    inspected: remote,
    ready: remote ? repositories.every((repository) => repository.ready) : null,
    branchHistoryReady: remote
      ? disconnectedBranchHistories.length === 0
      : null,
    repositories,
  };
  const historicalSourceAvailable = existsSync(
    resolve(root, "upstream/opengrow/backend"),
  );
  const governanceEvidenceReady =
    existsSync(resolve(root, governance.historicalUpstream.decision)) &&
    existsSync(resolve(root, governance.historicalUpstream.provenance));
  const historicalParity = {
    ready:
      governance.historicalUpstream.releasePolicy === "retired" &&
      governanceEvidenceReady,
    releasePolicy: governance.historicalUpstream.releasePolicy,
    sourceAvailable: historicalSourceAvailable,
    optionalComparisonCommand:
      governance.historicalUpstream.optionalComparisonCommand,
    decision: governance.historicalUpstream.decision,
    provenance: governance.historicalUpstream.provenance,
  };
  const securityContracts = {
    oauthDashboardRotation: {
      ready:
        existsSync(
          resolve(
            root,
            "workers/api/migrations/0056_oauth_client_secret_overlap.sql",
          ),
        ) && existsSync(resolve(root, "scripts/cloudflare-rotate-oauth.mjs")),
      migration: "0056_oauth_client_secret_overlap.sql",
      overlapMinutes: 30,
      remoteMigrationState: "not-inspected-by-platform-readiness",
      activation: "inactive-tagged-version-with-database-rollback",
    },
    workerSecretBundles: {
      ready: [
        "scripts/cloudflare-secret-inventory.mjs",
        "scripts/cloudflare-secret-bundle.mjs",
        "scripts/cloudflare-secret-promote.mjs",
        "scripts/cloudflare-secret-retire.mjs",
        "scripts/cloudflare-set-secret.mjs",
      ].every((path) => existsSync(resolve(root, path))),
      isolation: "one-contract-graph-per-target-environment",
      nativeValidation: "wrangler-secrets-required",
      upload: "exact-stdin-bundle-to-inactive-tagged-versions",
      promotion:
        "account-bound-version-and-rollback-ids-with-reverse-order-recovery",
      sharedCutover:
        "current-plus-previous-consumers-before-new-token-only-producers",
      retirement:
        "account-and-version-bound-after-minimum-thirty-minute-overlap",
      legacySingleBindingMutation: "disabled",
    },
  };
  const applicationClients = await applicationClientReadiness({
    clientSources,
    env,
  });

  const blockers = [];
  for (const target of Object.values(targets)) {
    addBlocker(
      blockers,
      !target.manifestProvisioned,
      `${target.target}.resource_ids`,
      target.environment,
      `${target.resourceIds.missing.length} required resource identifiers are unresolved.`,
      `Run the reviewed Cloudflare bootstrap for ${target.target}/${target.environment}.`,
    );
    addBlocker(
      blockers,
      !target.credentials.ready,
      `${target.target}.credentials`,
      target.environment,
      "Required credential names are not all present in this process environment.",
      "Provide the scoped account id, least-privilege token and production backup key where required.",
    );
  }
  const development = targets[developmentTargetName];
  addBlocker(
    blockers,
    !development.acceptance.googleAudienceConfigured,
    "development.google",
    "development",
    "No Google application audience is configured.",
    `Register the reference Google client, then run npm run target:configure-application -- --target ${development.target} --environment ${development.environment} --google-audiences <public-google-client-id>.`,
  );
  addBlocker(
    blockers,
    !development.acceptance.appleAudienceConfigured,
    "development.apple",
    "development",
    "No Apple application audience is configured.",
    `Register the reference Apple client, then run npm run target:configure-application -- --target ${development.target} --environment ${development.environment} --apple-audiences <public-apple-service-id>.`,
  );
  addBlocker(
    blockers,
    !development.acceptance.supportProjectAllowlisted,
    "development.support_project",
    "development",
    "No reference Support project id is allowlisted.",
    `Create the reference Support project, then run npm run target:configure-application -- --target ${development.target} --environment ${development.environment} --support-project-ids <numeric-project-id>.`,
  );
  addBlocker(
    blockers,
    !sdk.ready,
    "sdk.releases",
    "source-control",
    `${sdk.pending.length} SDK releases are pending.`,
    "Review, tag and publish the pending immutable SDK versions.",
  );
  addBlocker(
    blockers,
    remote && sdk.remote.ready !== true,
    "sdk.remote_publication",
    "source-control",
    `${sdk.remote.publications?.filter((publication) => !publication.ready).length ?? 0} SDK tag or GitHub release records are absent, orphaned or incomplete.`,
    "Publish each reviewed immutable tag through the SDK release workflow and reconcile the catalogue only after its release gate succeeds.",
  );
  addBlocker(
    blockers,
    flutterFlowLibrary.status !== "ok",
    "flutterflow.library_contract",
    "source-control",
    `${flutterFlowLibrary.errors.length} Git-owned FlutterFlow library contract checks failed.`,
    "Run npm run flutterflow-library:check and repair the declared DSL, immutable dependencies or sync workflow.",
  );
  addBlocker(
    blockers,
    flutterFlowApplications.status !== "ok",
    "flutterflow.application_configuration",
    "source-control",
    `${flutterFlowApplications.errors.length} Git-owned FlutterFlow application configuration checks failed.`,
    "Run npm run flutterflow-applications:check and regenerate the application bindings before any FlutterFlow deployment.",
  );
  addBlocker(
    blockers,
    !git.platform.ready,
    "git.platform",
    "source-control",
    "The platform checkout is not a clean committed dev/main revision with the declared remote.",
    "Review, commit and push the platform migration through a protected branch.",
  );
  addBlocker(
    blockers,
    !git.reference.ready,
    "git.reference",
    "source-control",
    "The reference checkout is not a clean committed dev/main revision with the declared remote.",
    "Create the reference history, configure origin and push dev.",
  );
  addBlocker(
    blockers,
    !reference.ready,
    "reference.contract",
    "development",
    "The reference project contract is inconsistent with the development target or SDK catalogue.",
    "Reconcile reference.project.json with the canonical manifests.",
  );
  addBlocker(
    blockers,
    !remote,
    "github.not_inspected",
    "source-control",
    "GitHub state was not inspected in offline mode.",
    "Run npm run platform:readiness:remote for a name-only remote inspection.",
  );
  addBlocker(
    blockers,
    remote && !github.ready,
    "github.incomplete",
    "source-control",
    "The declared repositories, branches, protections, Environments, variables or secret names are incomplete.",
    "Run the read-only GitHub bootstrap plan, explicitly create or grant the repositories, push both branches, reconcile structure and supply encrypted secrets.",
  );
  addBlocker(
    blockers,
    remote && disconnectedBranchHistories.length > 0,
    "github.main_dev_history",
    "source-control",
    `${disconnectedBranchHistories.length} repositories do not have a verified main/dev merge base.`,
    "Run npm run github:history:bridge:plan, preserve each exact pre-bridge main audit ref, and execute the separately reviewed protected bridge procedure before production promotion.",
  );
  addBlocker(
    blockers,
    !historicalParity.ready,
    "governance.historical_upstream",
    "governance",
    "The historical upstream release policy is not backed by its declared decision and provenance files.",
    "Restore the governance evidence or adopt a new reviewed ADR.",
  );
  addBlocker(
    blockers,
    !securityContracts.oauthDashboardRotation.ready,
    "security.oauth_rotation",
    "source-control",
    "The bounded Dashboard OAuth rotation contract is incomplete.",
    "Restore migration 0056 and the confirmed tagged-version rotation tool.",
  );
  addBlocker(
    blockers,
    !securityContracts.workerSecretBundles.ready,
    "security.worker_secret_bundles",
    "source-control",
    "The coordinated Worker secret upload/promotion contract is incomplete.",
    "Restore the inventory, inactive bundle uploader, account-bound promoter and disabled legacy guard.",
  );
  for (const [application, client] of Object.entries(applicationClients)) {
    const receiptReplaced =
      client.verificationIssue === "reviewed-export-receipt-replaced";
    addBlocker(
      blockers,
      !client.ready,
      `${application}.flutterflow_convergence`,
      "application-client",
      client.inspected
        ? receiptReplaced
          ? "The reviewed FlutterFlow export receipt was replaced by a later local run; generated source is not recertified by that dry run."
          : `${client.blockers.length} FlutterFlow convergence checks remain blocked or the reviewed snapshot is stale (${client.verificationIssue || "convergence-incomplete"}).`
        : `The reviewed FlutterFlow source was not inspected; provide ${client.sourceEnvironment}.`,
      receiptReplaced
        ? "After the immutable SDK set is published and the authorized FlutterFlow migration runs, export a fresh pushed source snapshot and review its new receipt."
        : `Run platform readiness with ${client.sourceEnvironment} or --client-sources, then remove every reported legacy coupling and wire the common authorities.`,
    );
  }

  const localContractsReady =
    flutterFlowLibrary.status === "ok" &&
    flutterFlowApplications.status === "ok" &&
    reference.ready &&
    historicalParity.ready &&
    securityContracts.oauthDashboardRotation.ready &&
    securityContracts.workerSecretBundles.ready &&
    Object.values(applicationClients).every((client) => client.ready) &&
    Object.values(targets).every(
      (target) =>
        target.acceptance.developmentMailCaptured &&
        target.acceptance.legacyMessagingDisabled &&
        target.acceptance.dashboardCacheIsolated,
    );
  const sourceControlReady =
    git.platform.ready && git.reference.ready && github.ready === true;
  const deploymentPrerequisitesReady =
    Object.values(targets).every(
      (target) => target.manifestProvisioned && target.credentials.ready,
    ) &&
    development.acceptance.googleAudienceConfigured &&
    development.acceptance.appleAudienceConfigured &&
    development.acceptance.supportProjectAllowlisted &&
    sdk.ready;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: remote ? "remote-read-only" : "offline-read-only",
    ready:
      localContractsReady && sourceControlReady && deploymentPrerequisitesReady,
    stages: {
      localContracts: { ready: localContractsReady },
      flutterFlowLibrary: {
        ready: flutterFlowLibrary.status === "ok",
      },
      flutterFlowApplications: {
        ready: flutterFlowApplications.status === "ok",
      },
      clientConvergence: {
        ready: Object.values(applicationClients).every(
          (client) => client.ready,
        ),
      },
      sourceControl: { ready: sourceControlReady },
      deploymentPrerequisites: { ready: deploymentPrerequisitesReady },
      historicalParity,
    },
    targets,
    sdk,
    flutterFlowLibrary,
    flutterFlowApplications,
    governance,
    deploymentMatrix,
    securityContracts,
    reference,
    applicationClients,
    git,
    github,
    blockers,
    note: "Only credential names and presence flags are reported; secret values are never read into the result.",
  };
}

export function resolveReferenceRepositoryRoot({
  referenceRoot = null,
  referenceRepositoryName,
  platformRoot = root,
}) {
  if (referenceRoot !== null && referenceRoot !== undefined) {
    const configuredRoot = String(referenceRoot).trim();
    if (!configuredRoot || !isAbsolute(configuredRoot)) {
      throw new Error(
        "OpenGrow reference root must be a non-empty absolute path",
      );
    }
    return resolve(configuredRoot);
  }

  const candidates = [
    resolve(platformRoot, `../${referenceRepositoryName}`),
    resolve(platformRoot, "../grow-reference"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

async function main() {
  const args = parseArgs();
  const report = await buildReadiness({
    remote: Boolean(args.remote),
    clientSources: parseClientSources(args["client-sources"]),
    referenceRoot: args["reference-root"]
      ? String(args["reference-root"])
      : undefined,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.strict && !report.ready) process.exitCode = 2;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
