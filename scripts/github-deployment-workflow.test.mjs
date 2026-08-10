import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/deploy-cloudflare.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = await readFile(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const releaseWorkflow = await readFile(
  new URL("../.github/workflows/release-sdk.yml", import.meta.url),
  "utf8",
);
const prepareReleaseWorkflow = await readFile(
  new URL("../.github/workflows/prepare-sdk-release.yml", import.meta.url),
  "utf8",
);
const syncFlutterFlowWorkflow = await readFile(
  new URL("../.github/workflows/sync-flutterflow-library.yml", import.meta.url),
  "utf8",
);
const promoteReferenceSdkWorkflow = await readFile(
  new URL("../.github/workflows/promote-reference-sdk.yml", import.meta.url),
  "utf8",
);
const androidBuild = await readFile(
  new URL(
    "../sdks/android/OpenGrow/OpenGrow/build.gradle.kts",
    import.meta.url,
  ),
  "utf8",
);
const flutterPodspec = await readFile(
  new URL("../sdks/flutter/ios/opengrow_flutter.podspec", import.meta.url),
  "utf8",
);
const javascriptManifest = JSON.parse(
  await readFile(
    new URL("../sdks/javascript/package.json", import.meta.url),
    "utf8",
  ),
);

function workflowSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing workflow marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing workflow marker: ${endMarker}`);
  return source.slice(start, end);
}

async function readActionWorkflows(directory) {
  const names = (await readdir(directory)).filter(
    (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
  );
  return Promise.all(
    names.map(async (name) => ({
      name: new URL(name, directory).pathname,
      source: await readFile(new URL(name, directory), "utf8"),
    })),
  );
}

const actionWorkflows = [
  ...(await readActionWorkflows(
    new URL("../.github/workflows/", import.meta.url),
  )),
  ...(await readActionWorkflows(
    new URL("../apps/dashboard/.github/workflows/", import.meta.url),
  )),
];

test("every external GitHub Action is pinned to an immutable commit", () => {
  const externalAction = /^\s*(?:-\s*)?uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gmu;
  for (const actionWorkflow of actionWorkflows) {
    for (const match of actionWorkflow.source.matchAll(externalAction)) {
      assert.match(
        match[2],
        /^[0-9a-f]{40}$/u,
        `${actionWorkflow.name} must pin ${match[1]} to a full commit SHA`,
      );
    }
  }
});

test("pull request secret scanning receives only the read-scoped workflow token", () => {
  assert.match(ciWorkflow, /gitleaks\/gitleaks-action@[0-9a-f]{40}/u);
  assert.match(ciWorkflow, /GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
  assert.match(ciWorkflow, /permissions:\n  contents: read/u);
});

test("Cloudflare deployment is restricted, preflighted and target-driven", () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[dev, main\]/);
  assert.equal(/\n  push:/u.test(workflow), false);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /dev\|main\) ;;/);
  assert.match(workflow, /vars\.OPENGROW_TARGET/);
  assert.match(
    workflow,
    /OPENGROW_EXPECTED_TARGET: \$\{\{ matrix\.target \}\}/,
  );
  assert.match(
    workflow,
    /test "\$OPENGROW_TARGET" = "\$OPENGROW_EXPECTED_TARGET"/,
  );
  assert.match(workflow, /scripts\/github-deployment-matrix\.mjs/);
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.matrix\)/);
  assert.match(workflow, /environment: \$\{\{ matrix\.githubEnvironment \}\}/);
  assert.match(
    workflow,
    /OPENGROW_ENVIRONMENT: \$\{\{ matrix\.cloudflareEnvironment \}\}/,
  );
  assert.match(
    workflow,
    /OPENGROW_REFERENCE_ROOT: \$\{\{ github\.workspace \}\}\/\.ci-reference-contract/,
  );
  assert.match(
    workflow,
    /Resolve reference contract source[\s\S]*?node \.github\/scripts\/ci-reference-contract\.mjs/,
  );
  assert.match(
    workflow,
    /Check out reference contract[\s\S]*?repository: \$\{\{ steps\.reference-contract\.outputs\.repository \}\}[\s\S]*?ref: \$\{\{ steps\.reference-contract\.outputs\.ref \}\}[\s\S]*?path: \.ci-reference-contract/,
  );
  assert.match(workflow, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /cloudflare:domains:plan -- --strict/);
  assert.match(workflow, /npm run cloudflare:routing:check/);
  assert.match(workflow, /cloudflare:deploy:all -- --preflight --upload-only/);
  assert.match(workflow, /ref: \$\{\{ env\.DEPLOY_SHA \}\}/);
  assert.match(workflow, /Reject a superseded automatic revision/);
  assert.match(
    workflow,
    /Require successful aggregate CI for a manual deployment/,
  );
  assert.match(workflow, /actions\/workflows\/ci\.yml\/runs/);
  assert.match(workflow, /\.head_sha == \$sha/);
  assert.match(workflow, /\.conclusion == "success"/);
  assert.match(workflow, /git rev-parse FETCH_HEAD/);
  assert.match(
    workflow,
    /npm run cloudflare:types:check:target -- \\\n\s+--target "\$OPENGROW_TARGET" \\\n\s+--environment "\$OPENGROW_ENVIRONMENT"/u,
  );
  assert.doesNotMatch(workflow, /npm run cloudflare:types:check(?:\s|$)/u);
  assert.match(workflow, /npm run cloudflare:secrets:check/);
  assert.match(workflow, /npm run cloudflare:d1:key:check/);
  assert.match(workflow, /npm run custom:check/);
  assert.match(
    workflow,
    /backup-and-migrate-all-before-workers|cloudflare:deploy:all/,
  );
  assert.match(
    workflow,
    /Migrate, verify Identity project cutover receipt and deploy all enabled Workers/,
  );
  assert.match(workflow, /steps\.deploy-workers\.outcome != 'skipped'/);
  assert.match(workflow, /--require-batch-receipt/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.match(
    workflow,
    /opengrow-d1-backups-\$\{\{ matrix\.id \}\}-\$\{\{ github\.run_id \}\}/,
  );
  assert.match(workflow, /steps\.encrypt-backups\.outcome == 'failure'/);
  assert.match(workflow, /opengrow-d1-recovery-/);
  assert.match(
    workflow,
    /opengrow-d1-recovery-\$\{\{ matrix\.id \}\}-\$\{\{ github\.run_id \}\}/,
  );
  assert.match(workflow, /if-no-files-found: warn/);
  assert.doesNotMatch(
    workflow,
    /steps\.deploy-workers\.outcome == 'success'.*OPENGROW_ENVIRONMENT == 'production'/u,
  );
  assert.doesNotMatch(workflow, /custom-(?:reference|vocostar):check/);
  assert.ok(
    workflow.indexOf("npm run cloudflare:routing:check") <
      workflow.indexOf("cloudflare:domains:plan -- --strict"),
  );
  assert.ok(
    workflow.indexOf("npm run cloudflare:d1:key:check") <
      workflow.indexOf("npm run cloudflare:deploy:all -- --backup-directory"),
  );
});

test("deployment validation cannot inherit operational Cloudflare context", () => {
  const deployJobHeader = workflowSection(
    workflow,
    "\n  deploy:",
    "\n    steps:",
  );
  assert.doesNotMatch(
    deployJobHeader,
    /OPENGROW_(?:TARGET|EXPECTED_TARGET|ENVIRONMENT)|CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)/u,
  );

  const platformValidation = workflowSection(
    workflow,
    "      - name: Validate platform code",
    "      - name: Enforce staged or receipt-bound public routing",
  );
  assert.match(platformValidation, /npm run typecheck && npm test/u);
  assert.doesNotMatch(
    platformValidation,
    /OPENGROW_(?:TARGET|EXPECTED_TARGET|ENVIRONMENT)|CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN)/u,
  );

  for (const [start, end] of [
    [
      "      - name: Validate target, generated bindings and deployment order",
      "      - name: Validate custom Worker implementations",
    ],
    [
      "      - name: Validate custom Worker implementations",
      "      - name: Validate platform code",
    ],
    [
      "      - name: Enforce staged or receipt-bound public routing",
      "      - name: Verify public domain ownership without mutation",
    ],
    [
      "      - name: Verify public domain ownership without mutation",
      "      - name: Verify required Cloudflare secret names without exposing values",
    ],
    [
      "      - name: Verify required Cloudflare secret names without exposing values",
      "      - name: Validate the production backup encryption key before mutation",
    ],
    [
      "      - name: Upload isolated production preflight versions",
      "      - name: Migrate, verify Identity project cutover receipt and deploy all enabled Workers",
    ],
    [
      "      - name: Migrate, verify Identity project cutover receipt and deploy all enabled Workers",
      "      - name: Encrypt production D1 migration backups",
    ],
  ]) {
    const operationalStep = workflowSection(workflow, start, end);
    assert.match(
      operationalStep,
      /OPENGROW_TARGET: \$\{\{ vars\.OPENGROW_TARGET \}\}/u,
    );
    assert.match(
      operationalStep,
      /OPENGROW_ENVIRONMENT: \$\{\{ matrix\.cloudflareEnvironment \}\}/u,
    );
  }
});

test("development dispatches the exact deployed revision to the reference repository", () => {
  assert.match(workflow, /needs\.plan\.outputs\.branch == 'dev'/);
  assert.match(workflow, /needs\.plan\.outputs\.deploy == 'true'/);
  assert.match(workflow, /needs\.deploy\.result == 'success'/);
  assert.match(workflow, /vars\.OPENGROW_REFERENCE_REPOSITORY/);
  assert.match(workflow, /secrets\.OPENGROW_REFERENCE_DISPATCH_TOKEN/);
  assert.match(workflow, /event_type=platform-dev-updated/);
  assert.match(workflow, /DEPLOY_SHA: \$\{\{ needs\.plan\.outputs\.sha \}\}/);
  assert.match(workflow, /client_payload\[platform_sha\]=\$DEPLOY_SHA/);
});

test("branch protection can require one stable aggregate CI check", () => {
  assert.match(ciWorkflow, /validation-gate:/);
  assert.match(ciWorkflow, /name: CI gate/);
  assert.match(ciWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    ciWorkflow,
    /needs: \[plan, workers, dashboard, flutter, node_sdks, ios_sdk, android_sdk\]/,
  );
  assert.match(ciWorkflow, /success\|skipped/);
  assert.match(ciWorkflow, /Validate Cloudflare and GitHub control planes/);
  assert.match(
    ciWorkflow,
    /npm run migration:inventory && npm run migration:inventory:test/,
  );
  assert.match(
    ciWorkflow,
    /npm run cloudflare:test:targets && npm run cloudflare:test:services/,
  );
  assert.match(ciWorkflow, /Verify generated Cloudflare binding types/);
  assert.match(ciWorkflow, /npm run cloudflare:types:check/);
});

test("CI validates every maintained SDK family and the Chatwoot migration path", () => {
  assert.match(ciWorkflow, /npm run sdk:documentation:check/);
  assert.match(ciWorkflow, /node_sdks:/);
  assert.match(ciWorkflow, /npm ci && npm run check/);
  assert.match(
    ciWorkflow,
    /Install repository tooling for the React Native contract[\s\S]*npm ci --ignore-scripts[\s\S]*npm run react-native:native-contract:check/,
  );
  assert.match(ciWorkflow, /npm run react-native:native-contract:check/);
  assert.match(
    ciWorkflow,
    /yarn typecheck && yarn test --runInBand && yarn prepare/,
  );
  assert.match(ciWorkflow, /ios_sdk:/);
  assert.match(ciWorkflow, /\.\/scripts\/run_tests\.sh/);
  assert.match(ciWorkflow, /android_sdk:/);
  assert.match(ciWorkflow, /:OpenGrow:testDebugUnitTest/);
  assert.match(ciWorkflow, /npm run chatwoot:test/);
  assert.match(ciWorkflow, /npm run custom:check:all/);
  assert.doesNotMatch(ciWorkflow, /custom-(?:reference|vocostar):check/);
  assert.match(ciWorkflow, /NODE_SDKS_RESULT/);
  assert.match(ciWorkflow, /IOS_SDK_RESULT/);
  assert.match(ciWorkflow, /ANDROID_SDK_RESULT/);
});

test("JavaScript CI and releases execute the complete first-party package check", () => {
  assert.equal(
    javascriptManifest.scripts.test,
    "node --test test/opengrow.test.js",
  );
  assert.match(javascriptManifest.scripts.check, /^npm test && npm run build/);
  assert.match(javascriptManifest.scripts.check, /npm run test:package/);
  assert.match(javascriptManifest.scripts.check, /npm run pack:check$/);
  assert.match(ciWorkflow, /npm ci && npm run check/);
  assert.match(releaseWorkflow, /npm ci && npm run check/);
});

test("production routing cannot bypass client convergence through workflow dispatch", () => {
  assert.match(workflow, /Enforce staged or receipt-bound public routing/);
  assert.equal(
    (workflow.match(/npm run cloudflare:routing:check/gu) || []).length,
    1,
  );
  assert.ok(
    workflow.indexOf("npm run cloudflare:routing:check") <
      workflow.indexOf(
        "npm run cloudflare:deploy:all -- --preflight --upload-only",
      ),
  );
});

test("immutable SDK publication revalidates native and React Native packages", () => {
  assert.match(releaseWorkflow, /^name: Release OpenGrow SDK$/m);
  assert.match(releaseWorkflow, /workflow_dispatch:[\s\S]*?release_tag:/);
  assert.match(
    releaseWorkflow,
    /group: sdk-release-publication-\$\{\{ inputs\.release_tag \|\| github\.ref_name \}\}/,
  );
  assert.doesNotMatch(releaseWorkflow, /group: sdk-release-publication\s*$/m);
  assert.match(
    releaseWorkflow,
    /ref: \$\{\{ inputs\.release_tag \|\| github\.ref \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /git merge-base --is-ancestor "\$release_sha" FETCH_HEAD/,
  );
  assert.equal(
    (
      releaseWorkflow.match(
        /tag_name: \$\{\{ needs\.validate-tag\.outputs\.tag \}\}/gu,
      ) || []
    ).length,
    4,
  );
  assert.match(releaseWorkflow, /Build and test the tagged iOS SDK/);
  assert.match(releaseWorkflow, /\.\/scripts\/run_tests\.sh/);
  assert.match(
    releaseWorkflow,
    /yarn typecheck && yarn test --runInBand && yarn prepare/,
  );
  assert.match(releaseWorkflow, /npm ci && npm run check/);
  assert.match(
    releaseWorkflow,
    /Install repository tooling for the React Native contract[\s\S]*npm ci --ignore-scripts[\s\S]*npm run react-native:native-contract:check/,
  );
  assert.match(releaseWorkflow, /npm run react-native:native-contract:check/);
  assert.equal(
    (
      releaseWorkflow.match(
        /test "\$[A-Z_a-z]+" != "js" \|\| catalog_id="javascript"/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(releaseWorkflow, /:OpenGrow:testDebugUnitTest/);
  assert.match(
    releaseWorkflow,
    /publishReleasePublicationToGithubPackagesRepository/,
  );
  assert.doesNotMatch(releaseWorkflow, /PrivateRepository|private SDK/i);
  assert.match(androidBuild, /name = "GithubPackages"/);
  assert.doesNotMatch(androidBuild, /GithubPackagesPrivate/);
  assert.doesNotMatch(flutterPodspec, /Private Flutter SDK/);
  assert.match(
    releaseWorkflow,
    /sdk-catalog\.mjs check[\s\S]*?--release-tag "\$TAG"/,
  );
  assert.match(
    releaseWorkflow,
    /sdk-catalog\.mjs promote[\s\S]*?--sha "\$RELEASE_SHA"[\s\S]*?--write/,
  );
  assert.match(
    releaseWorkflow,
    /sdk-catalog\.mjs promote[\s\S]*?react-native-native-contract\.mjs write[\s\S]*?sdk-documentation\.mjs write[\s\S]*?react-native-native-contract\.mjs check[\s\S]*?sdk-documentation\.mjs check/,
  );
  assert.match(releaseWorkflow, /--release-sha "\$RELEASE_SHA"/);
  assert.match(
    releaseWorkflow,
    /propose-catalogue:[\s\S]*?if: \$\{\{ always\(\) && needs\.validate-tag\.result == 'success' && needs\.release-gate\.result == 'success' \}\}/,
  );
});

test("SDK publication proposes protected catalogue and reference promotions", () => {
  assert.equal(
    (
      prepareReleaseWorkflow.match(
        /Install repository tooling for the SDK catalogue/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    prepareReleaseWorkflow,
    /Install repository tooling for the SDK catalogue[\s\S]*?npm ci --ignore-scripts[\s\S]*?Verify complete SDK catalogue/,
  );
  assert.match(
    prepareReleaseWorkflow,
    /Install repository tooling for the SDK catalogue[\s\S]*?npm ci --ignore-scripts[\s\S]*?Revalidate the reviewed source and unused immutable refs/,
  );
  assert.equal(
    (
      releaseWorkflow.match(
        /Install repository tooling for the SDK catalogue/gu,
      ) ?? []
    ).length,
    2,
  );
  assert.match(
    releaseWorkflow,
    /validate-tag:[\s\S]*?Install repository tooling for the SDK catalogue[\s\S]*?npm ci --ignore-scripts[\s\S]*?sdk-catalog\.mjs candidate-ref/,
  );
  assert.match(
    releaseWorkflow,
    /propose-catalogue:[\s\S]*?Install repository tooling for the SDK catalogue[\s\S]*?npm ci --ignore-scripts[\s\S]*?sdk-catalog\.mjs promote/,
  );
  assert.equal(
    (
      promoteReferenceSdkWorkflow.match(
        /Install repository tooling for the SDK catalogue/gu,
      ) ?? []
    ).length,
    1,
  );
  assert.match(
    promoteReferenceSdkWorkflow,
    /Install repository tooling for the SDK catalogue[\s\S]*?npm ci --ignore-scripts[\s\S]*?Validate the complete SDK catalogue/,
  );
  assert.match(
    prepareReleaseWorkflow,
    /sdk-catalog\.mjs check --candidate-release-tag/,
  );
  assert.match(
    prepareReleaseWorkflow,
    /Verify complete SDK catalogue[\s\S]*?sdk-catalog\.mjs check[\s\S]*?sdk-documentation\.mjs check/,
  );
  assert.match(prepareReleaseWorkflow, /permissions:\n  contents: read/);
  assert.match(
    prepareReleaseWorkflow,
    /tag:[\s\S]*?permissions:\n      actions: write\n      contents: write/,
  );
  assert.match(
    prepareReleaseWorkflow,
    /gh workflow run release-sdk\.yml --ref "\$DEVELOPMENT_BRANCH" --field "release_tag=\$TAG"/,
  );
  assert.match(
    releaseWorkflow,
    /propose-catalogue:[\s\S]*?permissions:\n      actions: write\n      contents: write\n      pull-requests: write/,
  );
  assert.match(
    releaseWorkflow,
    /gh workflow run ci\.yml --ref "\$PROMOTION_BRANCH"/,
  );
  assert.match(prepareReleaseWorkflow, /needs: validate/);
  assert.match(
    prepareReleaseWorkflow,
    /test "\$\(git rev-parse FETCH_HEAD\)" = "\$SOURCE_SHA"/,
  );
  assert.match(prepareReleaseWorkflow, /git push --atomic origin/);
  assert.match(prepareReleaseWorkflow, /git ls-remote --exit-code --tags/);
  assert.match(releaseWorkflow, /name: SDK release gate/);
  assert.match(releaseWorkflow, /sdk-catalog\.mjs promote/);
  assert.match(
    releaseWorkflow,
    /git add config\/sdk-libraries\.json[\s\S]*?sdks\/react-native\/plugin\/native-contract\.json[\s\S]*?sdks\/\*\/README\.md/,
  );
  assert.match(releaseWorkflow, /permissions:\n  contents: read/);
  assert.match(releaseWorkflow, /pull-requests: write/);
  assert.match(releaseWorkflow, /gh pr create/);
  assert.match(releaseWorkflow, /gh pr reopen/);
  assert.match(
    releaseWorkflow,
    /git merge-base --is-ancestor HEAD "origin\/\$DEVELOPMENT_BRANCH"/,
  );
  assert.doesNotMatch(releaseWorkflow, /gh pr (?:merge|review)/);
  assert.doesNotMatch(
    releaseWorkflow,
    /HEAD:refs\/heads\/\$DEVELOPMENT_BRANCH/,
  );
  assert.match(
    promoteReferenceSdkWorkflow,
    /uses: \.\/\.github\/workflows\/sync-flutterflow-library\.yml/,
  );
  assert.match(promoteReferenceSdkWorkflow, /branches: \[dev\]/);
  assert.match(
    promoteReferenceSdkWorkflow,
    /for library in flutterflow flutterflow-support/,
  );
  assert.match(
    promoteReferenceSdkWorkflow,
    /Validate the complete SDK catalogue[\s\S]*?sdk-catalog\.mjs check[\s\S]*?sdk-documentation\.mjs check/,
  );
  assert.match(
    promoteReferenceSdkWorkflow,
    /event_type=sdk-release-set-published/,
  );
  assert.match(promoteReferenceSdkWorkflow, /client_payload\[catalogue_sha\]/);
  assert.doesNotMatch(promoteReferenceSdkWorkflow, /gh pr (?:merge|review)/);
  assert.match(syncFlutterFlowWorkflow, /workflow_call:/);
  assert.match(syncFlutterFlowWorkflow, /inputs\.source_ref/);
  assert.doesNotMatch(
    syncFlutterFlowWorkflow,
    /workflows: \[Release OpenGrow SDK\]/,
  );
});

test("reference promotion separates repository reads from cross-repository credentials", () => {
  const dispatchJobHeader = workflowSection(
    promoteReferenceSdkWorkflow,
    "\n  dispatch:",
    "\n    steps:",
  );
  assert.match(dispatchJobHeader, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.doesNotMatch(
    dispatchJobHeader,
    /secrets\.OPENGROW_REFERENCE_DISPATCH_TOKEN/u,
  );

  const releaseVerification = workflowSection(
    promoteReferenceSdkWorkflow,
    "      - name: Verify every immutable SDK tag and GitHub release",
    "      - name: Validate cross-repository dispatch destination",
  );
  assert.match(
    releaseVerification,
    /gh api "repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$tag"/u,
  );
  assert.doesNotMatch(
    releaseVerification,
    /OPENGROW_REFERENCE_DISPATCH_TOKEN/u,
  );

  const crossRepositoryDispatch = workflowSection(
    promoteReferenceSdkWorkflow,
    "      - name: Dispatch the verified SDK set",
    "\n\n  sync-development-library:",
  );
  assert.match(
    crossRepositoryDispatch,
    /GH_TOKEN: \$\{\{ secrets\.OPENGROW_REFERENCE_DISPATCH_TOKEN \}\}/u,
  );
  assert.match(
    crossRepositoryDispatch,
    /::error::OPENGROW_REFERENCE_DISPATCH_TOKEN is required in the sdk-release Environment for cross-repository dispatch\./u,
  );
  assert.equal(
    (
      promoteReferenceSdkWorkflow.match(
        /secrets\.OPENGROW_REFERENCE_DISPATCH_TOKEN/gu,
      ) ?? []
    ).length,
    1,
  );
});
