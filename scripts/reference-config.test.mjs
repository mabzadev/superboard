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

test("development endpoints are complete and short links use in.mbza.dev", () => {
  assert.equal(project.target, "mbza-development");
  assert.equal(project.endpoints.referenceWeb, "https://reference.mbza.dev");
  assert.equal(project.endpoints.api, "https://api.mbza.dev");
  assert.equal(project.endpoints.shortLinks, "https://in.mbza.dev");
  assert.equal(project.endpoints.mailPreview, "https://mail.mbza.dev");
  assert.notEqual(project.endpoints.api, project.endpoints.shortLinks);
});

test("every runtime endpoint is derived from the same reference project manifest", () => {
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
  assert.deepEqual(project.libraries.opengrow_flutterflow, {
    path: "sdks/flutterflow",
    developmentRef: "dev",
    sourceVersion: "2.2.4",
    releaseVersion: "2.1.6",
    releaseRef: "sdk-flutterflow-v2.1.6",
  });
  assert.deepEqual(project.libraries.opengrow_flutterflow_messaging, {
    path: "sdks/flutterflow_messaging",
    developmentRef: "dev",
    sourceVersion: "1.3.0",
    releaseVersion: "1.1.1",
    releaseRef: "sdk-flutterflow-messaging-v1.1.1",
  });
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

test("live Flutter builds require project identity and exact tested revisions", () => {
  const environment = {
    OPENGROW_PROJECT_KEY: "reference-public-sdk-key",
    OPENGROW_PROJECT_ID: "42",
    OPENGROW_PLATFORM_REVISION: "a".repeat(40),
    OPENGROW_REFERENCE_REVISION: "b".repeat(40),
  };
  const defines = buildFlutterDefines(development, environment, { live: true });
  assert.equal(defines.OPENGROW_LIVE_MODE, "true");
  assert.equal(defines.OPENGROW_PROJECT_KEY, environment.OPENGROW_PROJECT_KEY);
  assert.equal(defines.OPENGROW_PROJECT_ID, "42");
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
    { ...development, OPENGROW_PROJECT_KEY: "must-not-ship" },
    { OPENGROW_PROJECT_KEY: "also-must-not-ship" },
  );
  assert.equal(defines.OPENGROW_LIVE_MODE, "false");
  assert.equal(defines.OPENGROW_PROJECT_KEY, "");
  assert.equal(defines.OPENGROW_PROJECT_ID, "0");
  assert.equal(defines.OPENGROW_PLATFORM_REVISION, "local");
  assert.equal(defines.OPENGROW_REFERENCE_REVISION, "local");
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
    /HTTPS origin/,
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
  assert.match(workflow, /gitleaks\/gitleaks-action@[0-9a-f]{40}/);
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
  assert.match(
    workflow,
    /github\.ref_name == needs\.contract\.outputs\.deployment_branch/,
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
