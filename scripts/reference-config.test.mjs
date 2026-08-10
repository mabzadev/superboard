import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv from "ajv";
import {
  buildReferenceWorkerConfig,
  evaluateReferenceDomainOwnership,
} from "./reference-cloudflare.mjs";
import {
  buildReferenceCiMetadata,
  githubRepositorySlug,
} from "./reference-ci-metadata.mjs";
import {
  assertCoordinatedReferenceConfig,
  assertDevelopmentDartDefineContract,
  assertReferenceEndpointContract,
  developmentDartDefineContract,
  developmentDartDefineKeys,
  referenceEndpointContract,
} from "./reference-config-contract.mjs";
import { buildFlutterDefines } from "./reference-flutter-build.mjs";

const root = new URL("../", import.meta.url);
const project = JSON.parse(
  await readFile(new URL("reference.project.json", root), "utf8"),
);
const catalog = JSON.parse(
  await readFile(new URL("flutterflow/custom-code-catalog.json", root), "utf8"),
);
const development = JSON.parse(
  await readFile(new URL("config/development.json", root), "utf8"),
);
const projectSchema = JSON.parse(
  await readFile(
    new URL("schemas/reference-project.schema.json", root),
    "utf8",
  ),
);
const workflow = await readFile(
  new URL(".github/workflows/ci.yml", root),
  "utf8",
);
const analysisOptions = await readFile(
  new URL("analysis_options.yaml", root),
  "utf8",
);
const dependabot = await readFile(
  new URL(".github/dependabot.yml", root),
  "utf8",
);
const codeowners = await readFile(new URL(".github/CODEOWNERS", root), "utf8");
const license = await readFile(new URL("LICENSE", root), "utf8");
const packageManifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);

test("the public reference project is explicitly MIT licensed", () => {
  assert.match(license, /^MIT License$/mu);
  assert.equal(packageManifest.license, "MIT");
});

test("CI dependencies stay pinned and receive automated update proposals", () => {
  const externalAction = /^\s*(?:-\s*)?uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gmu;
  for (const match of workflow.matchAll(externalAction)) {
    assert.match(
      match[2],
      /^[0-9a-f]{40}$/u,
      `${match[1]} must be pinned to a full commit SHA`,
    );
  }
  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: pub/);
});

test("reference analysis excludes the vendored platform checkout", () => {
  assert.match(analysisOptions, /analyzer:\n  exclude:\n    - vendor\/\*\*/);
});

test("reference project matches its strict versioned schema", () => {
  const validate = new Ajv({ allErrors: true }).compile(projectSchema);
  assert.equal(validate(project), true, JSON.stringify(validate.errors));
});

test("the project schema pins every MBZA endpoint to its exact public URL", () => {
  assert.equal(project.schemaVersion, 3);
  assert.equal(project.target, "mbza-development");
  assert.deepEqual(project.endpoints, referenceEndpointContract);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(projectSchema.properties.endpoints.properties).map(
        ([key, value]) => [key, value.const],
      ),
    ),
    referenceEndpointContract,
  );
  assertReferenceEndpointContract(project.endpoints);
});

test("endpoint contracts reject HTTP, credentials, query, fragment and paths", () => {
  const unsafeEndpoints = [
    ["referenceWeb", "http://reference.mbza.dev"],
    ["dashboard", "https://operator:secret@grow.mbza.dev"],
    ["api", "https://api.mbza.dev?debug=true"],
    ["sdk", "https://sdk.mbza.dev#unreviewed"],
    ["shortLinks", "https://in.mbza.dev/redirect"],
    ["files", "https://files.mbza.dev/upload"],
    ["mailPreview", "https://mail.mbza.dev/inbox"],
    ["support", "https://api.mbza.dev"],
    ["support", "https://api.mbza.dev/api/v1/support-admin"],
    ["support", "https://api.mbza.dev/api/v1/support-client?debug=true"],
  ];
  for (const [key, value] of unsafeEndpoints) {
    const drifted = structuredClone(project);
    drifted.endpoints[key] = value;
    const validate = new Ajv({ allErrors: true }).compile(projectSchema);
    assert.equal(validate(drifted), false, `${key} accepted ${value}`);
    assert.throws(
      () => assertReferenceEndpointContract(drifted.endpoints),
      new RegExp(`endpoints\\.${key} must be`, "u"),
    );
  }
});

test("every runtime endpoint is derived from the same reference project manifest", () => {
  assertCoordinatedReferenceConfig(project, development);
  assert.deepEqual(
    {
      api: development.OPENGROW_API_URL,
      sdk: development.OPENGROW_SDK_URL,
      support: development.OPENGROW_SUPPORT_URL,
      shortLinks: development.OPENGROW_SHORT_LINKS_URL,
      files: development.OPENGROW_FILES_URL,
      mailPreview: development.OPENGROW_MAIL_PREVIEW_URL,
    },
    {
      api: project.endpoints.api,
      sdk: project.endpoints.sdk,
      support: project.endpoints.support,
      shortLinks: project.endpoints.shortLinks,
      files: project.endpoints.files,
      mailPreview: project.endpoints.mailPreview,
    },
  );
});

test("coordinated project and development drift still fails closed", () => {
  const driftedProject = structuredClone(project);
  const driftedDevelopment = structuredClone(development);
  driftedProject.endpoints.api = "https://api-next.mbza.dev";
  driftedProject.endpoints.support =
    "https://api-next.mbza.dev/api/v1/support-client";
  driftedDevelopment.OPENGROW_API_URL = driftedProject.endpoints.api;
  driftedDevelopment.OPENGROW_SUPPORT_URL = driftedProject.endpoints.support;

  assert.equal(
    driftedDevelopment.OPENGROW_API_URL,
    driftedProject.endpoints.api,
  );
  assert.equal(
    driftedDevelopment.OPENGROW_SUPPORT_URL,
    driftedProject.endpoints.support,
  );
  const validate = new Ajv({ allErrors: true }).compile(projectSchema);
  assert.equal(validate(driftedProject), false);
  assert.throws(
    () => assertCoordinatedReferenceConfig(driftedProject, driftedDevelopment),
    /endpoints\.api must be "https:\/\/api\.mbza\.dev"/u,
  );
});

test("libraries come from opengrow-platform and custom code is not copied", async () => {
  assert.equal(
    project.platformRepository,
    "https://github.com/mbzadev/opengrow-platform",
  );
  assert.equal(catalog.policy, "reference-only-no-copied-implementation");
  assert.equal(catalog.schemaVersion, 3);
  assert.equal(catalog.sourceManifestVersion, 1);
  assert.match(
    catalog.source,
    /opengrow-platform\/blob\/dev\/config\/flutterflow-custom-code\.json$/,
  );
  assert.equal(catalog.widgets, undefined);
  assert.equal(catalog.actions, undefined);
  assert.deepEqual(catalog.referenceAdapters, {});
  const libraryContracts = {
    opengrow_flutterflow: {
      path: "sdks/flutterflow",
      releasePrefix: "sdk-flutterflow-v",
    },
    opengrow_flutterflow_messaging: {
      path: "sdks/flutterflow_messaging",
      releasePrefix: "sdk-flutterflow-messaging-v",
    },
  };
  assert.deepEqual(
    Object.keys(project.libraries).sort(),
    Object.keys(libraryContracts).sort(),
  );
  for (const [packageName, contract] of Object.entries(libraryContracts)) {
    const library = project.libraries[packageName];
    assert.equal(library.path, contract.path);
    assert.equal(library.developmentRef, "dev");
    assert.match(library.sourceVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
    assert.match(library.releaseVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/u);
    assert.equal(
      library.releaseRef,
      `${contract.releasePrefix}${library.releaseVersion}`,
    );
  }
  for (const [packageName, library] of Object.entries(project.libraries)) {
    const ref = pubspecDependencyRef(
      await readFile(new URL("pubspec.yaml", root), "utf8"),
      packageName,
    );
    assert.equal(
      ref,
      library.sourceVersion === library.releaseVersion
        ? library.releaseRef
        : library.developmentRef,
    );
  }
  const actions = await readFile(
    new URL("lib/src/services/reference_actions.dart", root),
    "utf8",
  );
  assert.match(actions, /opengrowApplicationMarketingPreferencesJson/);
  assert.match(actions, /opengrowApplicationUpdateMarketingConsentJson/);
  assert.doesNotMatch(actions, /\/api\/v1\/marketing-admin/);
});

test("the executable development profile has public endpoints but no credential", () => {
  assert.deepEqual(development, developmentDartDefineContract);
  assert.deepEqual(
    Object.keys(development).sort(),
    [...developmentDartDefineKeys].sort(),
  );
  assertDevelopmentDartDefineContract(development);
  assert.equal(development.OPENGROW_SHORT_LINKS_URL, "https://in.mbza.dev");
  assert.equal(
    development.OPENGROW_SUPPORT_URL,
    "https://api.mbza.dev/api/v1/support-client",
  );
  assert.equal(development.OPENGROW_LIVE_MODE, "false");
  assert.equal(development.OPENGROW_PROJECT_KEY, "");
  assert.equal(development.OPENGROW_PLATFORM_REVISION, "local");
  assert.equal(development.OPENGROW_REFERENCE_REVISION, "local");
  assert.equal(
    development.OPENGROW_SDK_PLATFORM,
    project.sdkApplication.platform,
  );
  assert.equal(
    development.OPENGROW_SDK_IDENTIFIER,
    project.sdkApplication.identifier,
  );
  assert.equal(
    development.OPENGROW_PROJECT_ENVIRONMENT,
    project.sdkApplication.projectEnvironment,
  );
  assert.ok(
    !Object.keys(development).some((key) => /TOKEN|SECRET|PASSWORD/.test(key)),
  );
});

test("development Dart defines use a strict, complete key allowlist", () => {
  for (const key of developmentDartDefineKeys) {
    const incomplete = structuredClone(development);
    delete incomplete[key];
    assert.throws(
      () => assertDevelopmentDartDefineContract(incomplete),
      new RegExp(`missing: ${key}`, "u"),
    );
  }

  assert.throws(
    () =>
      assertDevelopmentDartDefineContract({
        ...development,
        OPENGROW_API_TOKEN: "must-never-be-a-Dart-define",
      }),
    /unexpected: OPENGROW_API_TOKEN/u,
  );
  assert.throws(
    () =>
      assertDevelopmentDartDefineContract({
        ...development,
        OPENGROW_PROJECT_ID: 0,
      }),
    /OPENGROW_PROJECT_ID must be a string/u,
  );
  assert.throws(
    () =>
      assertDevelopmentDartDefineContract({
        ...development,
        OPENGROW_FILES_URL: "https://files.mbza.dev/private",
      }),
    /OPENGROW_FILES_URL must be "https:\/\/files\.mbza\.dev"/u,
  );
});

test("live Flutter builds require project identity and exact tested revisions", () => {
  const environment = {
    OPENGROW_PROJECT_KEY: "reference-public-sdk-key",
    OPENGROW_PROJECT_ID: "42",
    OPENGROW_PLATFORM_REVISION: "a".repeat(40),
    OPENGROW_REFERENCE_REVISION: "b".repeat(40),
    OPENGROW_API_URL: "https://attacker.example",
    OPENGROW_UNREVIEWED_DEFINE: "must-not-ship",
  };
  const defines = buildFlutterDefines(development, environment, { live: true });
  assert.deepEqual(
    Object.keys(defines).sort(),
    [...developmentDartDefineKeys].sort(),
  );
  assert.equal(defines.OPENGROW_LIVE_MODE, "true");
  assert.equal(defines.OPENGROW_PROJECT_KEY, environment.OPENGROW_PROJECT_KEY);
  assert.equal(defines.OPENGROW_PROJECT_ID, "42");
  assert.equal(defines.OPENGROW_API_URL, referenceEndpointContract.api);
  assert.equal(defines.OPENGROW_UNREVIEWED_DEFINE, undefined);
  assert.equal(
    defines.OPENGROW_PLATFORM_REVISION,
    environment.OPENGROW_PLATFORM_REVISION,
  );
  assert.equal(
    defines.OPENGROW_REFERENCE_REVISION,
    environment.OPENGROW_REFERENCE_REVISION,
  );
  assert.throws(
    () => buildFlutterDefines(development, {}, { live: true }),
    /OPENGROW_PLATFORM_REVISION/,
  );
  assert.throws(
    () =>
      buildFlutterDefines(
        development,
        { ...environment, OPENGROW_PROJECT_ID: "0" },
        { live: true },
      ),
    /positive integer/,
  );
});

test("demo Flutter builds discard credentials and mark unproven revisions local", () => {
  const defines = buildFlutterDefines(
    development,
    { OPENGROW_PROJECT_KEY: "also-must-not-ship" },
  );
  assert.equal(defines.OPENGROW_LIVE_MODE, "false");
  assert.equal(defines.OPENGROW_PROJECT_KEY, "");
  assert.equal(defines.OPENGROW_PROJECT_ID, "0");
  assert.equal(defines.OPENGROW_PLATFORM_REVISION, "local");
  assert.equal(defines.OPENGROW_REFERENCE_REVISION, "local");
  assert.deepEqual(
    Object.keys(defines).sort(),
    [...developmentDartDefineKeys].sort(),
  );
  assert.throws(
    () =>
      buildFlutterDefines({
        ...development,
        OPENGROW_PROJECT_KEY: "must-not-ship",
      }),
    /OPENGROW_PROJECT_KEY must be ""/u,
  );
});

test("reference deployment is restricted to the development branch and custom domain", () => {
  const config = buildReferenceWorkerConfig(project);

  assert.equal(project.deployment.branch, "dev");
  assert.equal(project.deployment.environment, "development");
  assert.equal(
    new URL(project.endpoints.referenceWeb).hostname,
    project.sdkApplication.identifier,
  );
  assert.equal(config.name, "opengrow-reference-app-dev");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.assets, {
    directory: "./build/web",
    not_found_handling: "single-page-application",
  });
  assert.deepEqual(config.routes, [
    { pattern: "reference.mbza.dev", custom_domain: true },
  ]);
  assert.equal(config.account_id, undefined);
  assert.ok(!JSON.stringify(config).match(/TOKEN|SECRET|PASSWORD/));
});

test("private reference bootstrap cannot expose a route or workers.dev URL", () => {
  const config = buildReferenceWorkerConfig(project, { includeRoutes: false });

  assert.equal(config.name, "opengrow-reference-app-dev");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.assets, {
    directory: "./build/web",
    not_found_handling: "single-page-application",
  });
});

test("reference deployment rejects a branch or hostname that escapes the manifest", () => {
  assert.throws(
    () =>
      buildReferenceWorkerConfig({
        ...project,
        deployment: { ...project.deployment, branch: "main" },
      }),
    /dev branch/,
  );
  assert.throws(
    () =>
      buildReferenceWorkerConfig({
        ...project,
        endpoints: {
          ...project.endpoints,
          referenceWeb: "https://elsewhere.example/path",
        },
      }),
    /endpoints\.referenceWeb must be "https:\/\/reference\.mbza\.dev"/u,
  );
});

test("GitHub CI deploys only development and accepts exact platform revisions", () => {
  assert.match(
    workflow,
    /types: \[platform-dev-updated, sdk-release-set-published\]/,
  );
  assert.match(workflow, /gh pr create/);
  assert.match(workflow, /gh pr reopen/);
  assert.match(
    workflow,
    /git merge-base --is-ancestor HEAD "origin\/\$DEPLOYMENT_BRANCH"/,
  );
  assert.doesNotMatch(workflow, /gh pr (?:merge|review)/);
  assert.match(workflow, /name: Secret scan/);
  assert.match(
    workflow,
    /name: Validate exact MBZA endpoints and the Dart-define allowlist/,
  );
  assert.match(workflow, /gitleaks\/gitleaks-action@[0-9a-f]{40}/);
  assert.match(
    workflow,
    /if: \$\{\{ github\.event_name != 'repository_dispatch' \}\}/,
  );
  assert.match(
    workflow,
    /name: Verify dispatch starts from the protected default branch head/,
  );
  assert.match(
    workflow,
    /test "\$\(git rev-parse HEAD\)" = "\$\(git rev-parse FETCH_HEAD\)"/,
  );
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(workflow, /SECURITY_RESULT/);
  assert.match(
    workflow,
    /if: \$\{\{ always\(\) && needs\.contract\.result == 'success' \}\}/,
  );
  assert.match(workflow, /client_payload\.platform_sha/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /refs\/heads\/\$DEPLOYMENT_BRANCH/);
  assert.match(workflow, /Resolve fail-closed development deployment gate/);
  assert.match(
    workflow,
    /deployment_eligible: \$\{\{ steps\.deployment-gate\.outputs\.eligible \}\}/u,
  );
  assert.match(
    workflow,
    /OPENGROW_GITHUB_EVENT_NAME: \$\{\{ github\.event_name \}\}/u,
  );
  assert.match(
    workflow,
    /OPENGROW_GITHUB_REF_NAME: \$\{\{ github\.ref_name \}\}/u,
  );
  assert.match(
    workflow,
    /OPENGROW_GITHUB_EVENT_ACTION: \$\{\{ github\.event\.action \}\}/u,
  );
  assert.match(workflow, /environment: development/);
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /secrets\.OPENGROW_PROJECT_KEY/);
  assert.match(workflow, /secrets\.OPENGROW_PROJECT_ID/);
  assert.doesNotMatch(workflow, /OPENGROW_PLATFORM_READ_TOKEN/);
  assert.match(workflow, /node scripts\/reference-ci-metadata\.mjs/);
  assert.match(
    workflow,
    /repository: \$\{\{ needs\.contract\.outputs\.platform_repository \}\}/,
  );
  assert.doesNotMatch(workflow, /repository:\s*mbzadev\/opengrow-platform/);
  assert.ok((workflow.match(/persist-credentials: false/g) ?? []).length >= 6);
  assert.doesNotMatch(workflow, /environment: production/);
  assert.match(workflow, /validation-gate:/);
  assert.match(workflow, /name: Reference gate/);
  assert.match(workflow, /build-development:/);
  assert.equal(
    (
      workflow.match(
        /!cancelled\(\) &&\n\s+needs\.contract\.result == 'success' &&\n\s+needs\.validation-gate\.result == 'success' &&\n\s+needs\.flutter\.result == 'success' &&/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    workflow,
    /needs\.build-development\.result == 'success' &&\n\s+needs\.contract\.outputs\.deployment_eligible == 'true'/u,
  );
  assert.doesNotMatch(
    workflow,
    /\|\| github\.event_name == 'repository_dispatch'/u,
  );
  assert.match(workflow, /npm run flutter:web:live/);
  assert.match(
    workflow,
    /OPENGROW_PLATFORM_REVISION: \$\{\{ needs\.flutter\.outputs\.platform_sha \}\}/,
  );
  assert.match(
    workflow,
    /OPENGROW_REFERENCE_REVISION: \$\{\{ needs\.flutter\.outputs\.reference_sha \}\}/,
  );
  assert.match(
    workflow,
    /needs: \[contract, validation-gate, flutter, build-development\]/,
  );
  assert.match(
    workflow,
    /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/,
  );
  assert.match(workflow, /promote-sdk:/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /reference-sdk-promotion\.mjs/);
  assert.match(workflow, /--library all/);
  assert.match(workflow, /Regenerate the application lockfile from immutable SDK tags/);
  assert.match(workflow, /':!pubspec\.lock'/);
  assert.match(
    workflow,
    /git diff --quiet -- reference\.project\.json pubspec\.yaml pubspec\.lock flutterflow\/dependency-snippet\.yaml/,
  );
  assert.match(
    workflow,
    /git add reference\.project\.json pubspec\.yaml pubspec\.lock flutterflow\/dependency-snippet\.yaml/,
  );
  assert.match(workflow, /refs\/tags\/\$tag\^\{\}/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /gh pr create/);
  assert.match(workflow, /gh workflow run ci\.yml --ref "\$PROMOTION_BRANCH"/);
  assert.doesNotMatch(workflow, /gh pr (?:merge|review)/);
  assert.ok(
    workflow.indexOf("Verify the official development catalogue") <
      workflow.indexOf("Propose the immutable SDK set"),
  );
  assert.match(workflow, /Require every fully published dependency tag/);
  assert.match(workflow, /git ls-remote --exit-code --tags/);
  assert.match(workflow, /Verify locked immutable SDK tags before local overrides/);
  assert.match(workflow, /reference-sdk-lock\.mjs verify-remote/);
  assert.match(workflow, /flutter pub get --enforce-lockfile/);
  assert.match(workflow, /OPENGROW_FLUTTER_VERSION: "3\.44\.9"/);
  assert.equal(
    (workflow.match(/flutter-version: \$\{\{ env\.OPENGROW_FLUTTER_VERSION \}\}/gu) ?? [])
      .length,
    3,
  );
  assert.match(
    workflow,
    /Restore the reviewed lockfile after local override resolution/,
  );
  assert.match(
    workflow,
    /git restore --source=HEAD --worktree -- pubspec\.lock/,
  );
  assert.ok(
    workflow.indexOf("Verify locked immutable SDK tags before local overrides") <
      workflow.indexOf('dart tool/use_local_platform.dart "$GITHUB_WORKSPACE/vendor/opengrow-platform"'),
  );
});

function pubspecDependencyRef(source, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = source.match(
    new RegExp(`^  ${escaped}:\\n(?: {4,}.*\\n)*? {6}ref: ([^\\s]+)$`, "mu"),
  );
  assert.ok(match, `Missing Git dependency ${packageName}`);
  return match[1];
}

test("reference changes require the declared owner review", () => {
  assert.match(codeowners, /^\* @mbzadev$/mu);
  assert.match(codeowners, /^\/\.github\/workflows\/ @mbzadev$/mu);
  assert.match(codeowners, /^\/reference\.project\.json @mbzadev$/mu);
  assert.match(codeowners, /^\/pubspec\.yaml @mbzadev$/mu);
  assert.match(codeowners, /^\/pubspec\.lock @mbzadev$/mu);
});

test("GitHub CI metadata is derived from the strict project manifest", () => {
  assert.deepEqual(buildReferenceCiMetadata(project), {
    platform_repository: "mbzadev/opengrow-platform",
    deployment_branch: "dev",
  });
  assert.equal(
    githubRepositorySlug("https://github.com/example/reference"),
    "example/reference",
  );
  assert.throws(
    () => githubRepositorySlug("https://github.com/example/reference/extra"),
    /canonical GitHub HTTPS URL/,
  );
  assert.throws(
    () =>
      buildReferenceCiMetadata({
        ...project,
        platformRepository: "https://example.test/owner/repository",
      }),
    /canonical GitHub HTTPS URL/,
  );
});

test("reference custom domain deployment refuses DNS or Worker takeover", () => {
  const common = {
    hostname: "reference.mbza.dev",
    service: "opengrow-reference-app-dev",
    zones: [{ id: "zone", name: "mbza.dev" }],
  };
  assert.deepEqual(
    evaluateReferenceDomainOwnership({
      ...common,
      workerDomains: [],
      dnsRecords: [],
    }),
    { status: "available", blocking: false },
  );
  assert.deepEqual(
    evaluateReferenceDomainOwnership({
      ...common,
      workerDomains: [{ hostname: common.hostname, service: common.service }],
      dnsRecords: [{ type: "AAAA" }],
    }),
    { status: "managed", blocking: false },
  );
  assert.deepEqual(
    evaluateReferenceDomainOwnership({
      ...common,
      workerDomains: [],
      dnsRecords: [{ type: "A", content: "redacted" }],
    }),
    { status: "dns-conflict", blocking: true },
  );
  assert.equal(
    evaluateReferenceDomainOwnership({
      ...common,
      workerDomains: [{ hostname: common.hostname, service: "legacy-worker" }],
      dnsRecords: [],
    }).status,
    "wrong-worker",
  );
});
