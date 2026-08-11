import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { nonNodeSecurityAuditContract } from "./non-node-security-audit.mjs";

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
  new URL("../sdks/flutter/ios/superboard_flutter.podspec", import.meta.url),
  "utf8",
);
const javascriptManifest = JSON.parse(
  await readFile(
    new URL("../sdks/javascript/package.json", import.meta.url),
    "utf8",
  ),
);
const rootManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
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

test("production Cloudflare deployment is restricted, preflighted and target-driven", () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[CI\]/);
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /branches: \[dev, main\]/);
  assert.equal(/\n  push:/u.test(workflow), false);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /actions: read/);
  assert.doesNotMatch(workflow, /dev\|main\) ;;/);
  assert.match(workflow, /--authority github-actions/);
  assert.match(workflow, /vars\.SUPERBOARD_TARGET/);
  assert.match(
    workflow,
    /SUPERBOARD_EXPECTED_TARGET: \$\{\{ matrix\.target \}\}/,
  );
  assert.match(
    workflow,
    /test "\$SUPERBOARD_TARGET" = "\$SUPERBOARD_EXPECTED_TARGET"/,
  );
  assert.match(
    workflow,
    /test "\$SUPERBOARD_DEPLOYMENT_AUTHORITY" = "github-actions"/,
  );
  assert.match(workflow, /scripts\/github-deployment-matrix\.mjs/);
  assert.match(workflow, /fromJSON\(needs\.plan\.outputs\.matrix\)/);
  assert.match(workflow, /environment: \$\{\{ matrix\.githubEnvironment \}\}/);
  assert.match(
    workflow,
    /SUPERBOARD_ENVIRONMENT: \$\{\{ matrix\.cloudflareEnvironment \}\}/,
  );
  assert.match(
    workflow,
    /SUPERBOARD_REFERENCE_ROOT: \$\{\{ github\.workspace \}\}\/apps\/reference/,
  );
  assert.doesNotMatch(workflow, /ci-reference-contract|\.ci-reference-contract/u);
  assert.doesNotMatch(ciWorkflow, /ci-reference-contract|\.ci-reference-contract/u);
  assert.match(ciWorkflow, /working-directory: apps\/reference/u);
  assert.match(ciWorkflow, /name: Reference application/u);
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
    /npm run cloudflare:types:check:target -- \\\n\s+--target "\$SUPERBOARD_TARGET" \\\n\s+--environment "\$SUPERBOARD_ENVIRONMENT"/u,
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
    /superboard-d1-backups-\$\{\{ matrix\.id \}\}-\$\{\{ github\.run_id \}\}/,
  );
  assert.match(workflow, /steps\.encrypt-backups\.outcome == 'failure'/);
  assert.match(workflow, /superboard-d1-recovery-/);
  assert.match(
    workflow,
    /superboard-d1-recovery-\$\{\{ matrix\.id \}\}-\$\{\{ github\.run_id \}\}/,
  );
  assert.match(workflow, /if-no-files-found: warn/);
  assert.doesNotMatch(
    workflow,
    /steps\.deploy-workers\.outcome == 'success'.*SUPERBOARD_ENVIRONMENT == 'production'/u,
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
      /SUPERBOARD_TARGET: \$\{\{ vars\.SUPERBOARD_TARGET \|\| vars\.OPENGROW_TARGET \}\}/u,
    );
    assert.match(
      operationalStep,
      /SUPERBOARD_ENVIRONMENT: \$\{\{ matrix\.cloudflareEnvironment \}\}/u,
    );
  }
});

test("development deployment is absent from GitHub Actions", () => {
  assert.doesNotMatch(workflow, /trigger-reference-acceptance/u);
  assert.doesNotMatch(workflow, /event_type=platform-dev-updated/u);
  assert.doesNotMatch(
    workflow,
    /secrets\.SUPERBOARD_REFERENCE_DISPATCH_TOKEN/u,
  );
  assert.doesNotMatch(workflow, /environment: development/u);
});

test("branch protection can require one stable aggregate CI check", () => {
  assert.match(ciWorkflow, /validation-gate:/);
  assert.match(ciWorkflow, /name: CI gate/);
  assert.match(ciWorkflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(
    ciWorkflow,
    /needs:\s*\[\s*plan,\s*non_node_security,\s*workers,\s*dashboard,\s*flutter,\s*node_sdks,\s*ios_sdk,\s*android_sdk,\s*reference,?\s*\]/u,
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

test("required CI executes pinned Python and Ruby dependency audits", () => {
  const auditJob = workflowSection(
    ciWorkflow,
    "\n  non_node_security:",
    "\n  workers:",
  );
  assert.equal(
    rootManifest.scripts["security:audit:non-node"],
    "node scripts/non-node-security-audit.mjs",
  );
  assert.deepEqual(nonNodeSecurityAuditContract, {
    python: {
      runtimeVersion: "3.13.7",
      tool: "pip-audit",
      toolVersion: "2.10.1",
      requirements:
        "workers/custom/vocostar/orchestrators/vocals/container/requirements.txt",
    },
    ruby: {
      runtimeVersion: "3.4.9",
      bundlerVersion: "2.7.2",
      tool: "bundler-audit",
      toolVersion: "0.9.3",
      lockfile: "sdks/react-native/example/Gemfile.lock",
    },
  });
  assert.match(auditJob, /SUPERBOARD_PIP_AUDIT_VERSION: "2\.10\.1"/u);
  assert.match(auditJob, /SUPERBOARD_BUNDLER_VERSION: "2\.7\.2"/u);
  assert.match(auditJob, /SUPERBOARD_BUNDLER_AUDIT_VERSION: "0\.9\.3"/u);
  assert.match(auditJob, /actions\/setup-python@[0-9a-f]{40}/u);
  assert.match(auditJob, /python-version: "3\.13\.7"/u);
  assert.match(auditJob, /ruby\/setup-ruby@[0-9a-f]{40}/u);
  assert.match(auditJob, /ruby-version: "3\.4\.9"/u);
  assert.match(
    auditJob,
    /python3 -m pip install --disable-pip-version-check "pip-audit==\$SUPERBOARD_PIP_AUDIT_VERSION"/u,
  );
  assert.match(
    auditJob,
    /gem install bundler --version "\$SUPERBOARD_BUNDLER_VERSION" --no-document/u,
  );
  assert.match(
    auditJob,
    /gem install bundler-audit --version "\$SUPERBOARD_BUNDLER_AUDIT_VERSION" --no-document/u,
  );
  assert.match(auditJob, /npm run security:audit:non-node/u);
  assert.match(
    ciWorkflow,
    /NON_NODE_SECURITY_RESULT: \$\{\{ needs\.non_node_security\.result \}\}/u,
  );
  assert.match(ciWorkflow, /test "\$NON_NODE_SECURITY_RESULT" = "success"/u);
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
  assert.match(ciWorkflow, /run: yarn check/);
  assert.match(ciWorkflow, /ios_sdk:/);
  assert.match(
    ciWorkflow,
    /ios_sdk:[\s\S]*?Verify Flutter links to every internal iOS source[\s\S]*?flutter-ios-embedded-sources\.test\.mjs[\s\S]*?\.\/scripts\/run_tests\.sh/u,
  );
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
  assert.equal(
    javascriptManifest.scripts["audit:production"],
    "npm audit --omit=dev --workspaces=false --audit-level=low",
  );
  assert.equal(
    javascriptManifest.scripts["audit:development"],
    "npm audit --include=dev --workspaces=false --audit-level=low",
  );
  assert.match(
    javascriptManifest.scripts.check,
    /^npm run audit && npm test && npm run build/,
  );
  assert.match(javascriptManifest.scripts.check, /npm run test:package/);
  assert.match(javascriptManifest.scripts.check, /npm run pack:check$/);
  assert.match(ciWorkflow, /npm ci && npm run check/);
  assert.doesNotMatch(releaseWorkflow, /working-directory: sdks\/javascript/u);
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

test("immutable SDK publication is restricted to active Flutter packages", () => {
  assert.match(releaseWorkflow, /^name: Release SuperBoard SDK$/m);
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
  assert.match(
    releaseWorkflow,
    /authorize-publication:[\s\S]*?name: Authorize immutable SDK publication[\s\S]*?needs: validate-tag[\s\S]*?environment: sdk-release[\s\S]*?Bind approval to the validated immutable release/u,
  );
  assert.match(
    releaseWorkflow,
    /\n  flutter:[\s\S]*?needs: \[validate-tag, authorize-publication\]/u,
  );
  assert.equal(
    (
      releaseWorkflow.match(
        /tag_name: \$\{\{ needs\.validate-tag\.outputs\.tag \}\}/gu,
      ) || []
    ).length,
    1,
  );
  assert.doesNotMatch(releaseWorkflow, /\n  (?:ios|android|npm):/u);
  assert.doesNotMatch(releaseWorkflow, /sdk-flutterflow-messaging-v/u);
  assert.doesNotMatch(
    releaseWorkflow,
    /sdk-(?:ios|android|js|react-native)-v/u,
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
    /sdk-catalog\.mjs promote[\s\S]*?sdk-documentation\.mjs write[\s\S]*?sdk-documentation\.mjs check/,
  );
  assert.doesNotMatch(releaseWorkflow, /react-native-native-contract/u);
  assert.match(releaseWorkflow, /--release-sha "\$RELEASE_SHA"/);
  assert.match(
    releaseWorkflow,
    /propose-catalogue:[\s\S]*?if: \$\{\{ always\(\) && needs\.validate-tag\.result == 'success' && needs\.release-gate\.result == 'success' && needs\.publish-release\.result == 'success' \}\}/,
  );
});

test("Flutter SDK release gates compile both native wrappers without a named simulator", () => {
  const prepareAndroid = workflowSection(
    prepareReleaseWorkflow,
    "\n  flutter-android-native:",
    "\n  flutter-ios-native:",
  );
  const prepareIos = workflowSection(
    prepareReleaseWorkflow,
    "\n  flutter-ios-native:",
    "\n  native-candidate-gate:",
  );
  const prepareGate = workflowSection(
    prepareReleaseWorkflow,
    "\n  native-candidate-gate:",
    "\n  tag:",
  );
  const prepareTag = workflowSection(
    prepareReleaseWorkflow,
    "\n  tag:",
    "\n      - name: Create reviewed SDK tag",
  );
  const releaseAndroid = workflowSection(
    releaseWorkflow,
    "\n  flutter-android-native:",
    "\n  flutter-ios-native:",
  );
  const releaseIos = workflowSection(
    releaseWorkflow,
    "\n  flutter-ios-native:",
    "\n  release-gate:",
  );
  const releaseGate = workflowSection(
    releaseWorkflow,
    "\n  release-gate:",
    "\n  publish-release:",
  );
  const publication = workflowSection(
    releaseWorkflow,
    "\n  publish-release:",
    "\n  propose-catalogue:",
  );

  assert.match(prepareAndroid, /if: inputs\.library == 'flutter'/u);
  assert.match(
    prepareAndroid,
    /ref: \$\{\{ needs\.validate\.outputs\.source_sha \}\}/u,
  );
  assert.match(prepareAndroid, /actions\/setup-java@[0-9a-f]{40}/u);
  assert.match(prepareAndroid, /flutter build apk --debug/u);
  assert.match(prepareIos, /runs-on: macos-latest/u);
  assert.match(prepareIos, /pod install --project-directory=ios --deployment/u);
  assert.match(
    prepareIos,
    /pod ipc spec sdks\/flutter\/ios\/superboard_flutter\.podspec/u,
  );
  assert.match(
    prepareIos,
    /-project sdks\/flutter\/example\/ios\/Pods\/Pods\.xcodeproj/u,
  );
  assert.match(prepareIos, /-target superboard_flutter/u);
  assert.match(prepareIos, /CODE_SIGNING_ALLOWED=NO/u);
  assert.doesNotMatch(prepareIos, /-destination|iPhone [0-9]/u);
  assert.match(prepareIos, /-showdestinations/u);
  assert.match(prepareIos, /EXCLUDED_SOURCE_FILE_NAMES=\*\.xib/u);
  assert.match(prepareIos, /flutter-ios-embedded-sources\.test\.mjs/u);
  assert.match(
    prepareGate,
    /needs: \[validate, flutter-android-native, flutter-ios-native\]/u,
  );
  assert.match(prepareGate, /test "\$ANDROID_RESULT" = "success"/u);
  assert.match(prepareGate, /test "\$IOS_RESULT" = "success"/u);
  assert.match(prepareTag, /needs: \[validate, native-candidate-gate\]/u);

  assert.match(
    releaseAndroid,
    /ref: \$\{\{ needs\.validate-tag\.outputs\.tag \}\}/u,
  );
  assert.match(releaseAndroid, /flutter build apk --debug/u);
  assert.match(releaseIos, /runs-on: macos-latest/u);
  assert.match(releaseIos, /pod install --project-directory=ios --deployment/u);
  assert.match(
    releaseIos,
    /-project sdks\/flutter\/example\/ios\/Pods\/Pods\.xcodeproj/u,
  );
  assert.match(releaseIos, /-target superboard_flutter/u);
  assert.match(releaseIos, /CODE_SIGNING_ALLOWED=NO/u);
  assert.doesNotMatch(releaseIos, /-destination|iPhone [0-9]/u);
  assert.match(releaseIos, /-showdestinations/u);
  assert.match(releaseIos, /EXCLUDED_SOURCE_FILE_NAMES=\*\.xib/u);
  assert.match(releaseIos, /flutter-ios-embedded-sources\.test\.mjs/u);
  assert.match(
    releaseGate,
    /needs: \[validate-tag, authorize-publication, flutter, flutter-android-native, flutter-ios-native\]/u,
  );
  assert.match(releaseGate, /test "\$ANDROID_RESULT" = "success"/u);
  assert.match(releaseGate, /test "\$IOS_RESULT" = "success"/u);
  assert.match(publication, /needs: \[validate-tag, release-gate\]/u);
  assert.match(publication, /permissions:\n      contents: write/u);
  assert.match(publication, /softprops\/action-gh-release@[0-9a-f]{40}/u);
});

test("FlutterFlow v3 tag and publication are bound to the published Flutter v3 source", () => {
  const prepareValidation = workflowSection(
    prepareReleaseWorkflow,
    "      - name: Bind FlutterFlow to the published Flutter v3 source",
    "\n  flutter-android-native:",
  );
  const tagRevalidation = workflowSection(
    prepareReleaseWorkflow,
    "      - name: Revalidate the reviewed source and unused immutable refs",
    "      - name: Create reviewed SDK tag",
  );
  const publicationValidation = workflowSection(
    releaseWorkflow,
    "      - name: Bind FlutterFlow to the already-published Flutter v3 source",
    "\n  authorize-publication:",
  );

  for (const [section, expectedSha] of [
    [prepareValidation, "SOURCE_SHA"],
    [tagRevalidation, "SOURCE_SHA"],
    [publicationValidation, "RELEASE_SHA"],
  ]) {
    assert.match(section, /sdk-catalog\.mjs candidate-ref --library flutter/u);
    assert.match(section, /\^sdk-flutter-v3\\\./u);
    assert.match(
      section,
      /git fetch --no-tags origin "refs\/tags\/\$flutter_tag:refs\/tags\/\$flutter_tag"/u,
    );
    assert.match(
      section,
      /flutter_sha="\$\(git rev-list -n 1 "\$flutter_tag"\)"/u,
    );
    assert.match(
      section,
      new RegExp(`test "\\$flutter_sha" = "\\$${expectedSha}"`, "u"),
    );
    assert.match(
      section,
      new RegExp(
        `git rev-parse "\\$flutter_tag:sdks/flutter"[\\s\\S]*?git rev-parse "\\$${expectedSha}:sdks/flutter"`,
        "u",
      ),
    );
    assert.match(
      section,
      /gh api "repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$flutter_tag" --jq \.tag_name/u,
    );
  }
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
  assert.match(
    releaseWorkflow,
    /needs: \[validate-tag, authorize-publication, flutter, flutter-android-native, flutter-ios-native\]/u,
  );
  assert.match(
    releaseWorkflow,
    /AUTHORIZATION_RESULT: \$\{\{ needs\.authorize-publication\.result \}\}[\s\S]*?test "\$AUTHORIZATION_RESULT" = "success"/u,
  );
  assert.match(releaseWorkflow, /sdk-catalog\.mjs promote/);
  assert.match(
    releaseWorkflow,
    /git add config\/sdk-libraries\.json sdks\/\*\/README\.md/,
  );
  assert.match(releaseWorkflow, /permissions:\n  contents: read/);
  assert.match(releaseWorkflow, /pull-requests: write/);
  assert.match(
    releaseWorkflow,
    /propose-catalogue:[\s\S]*?needs: \[validate-tag, release-gate, publish-release\]/u,
  );
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
    /library\.lifecycle === 'active'[\s\S]*?library\.ecosystem === 'FlutterFlow'/,
  );
  assert.match(
    promoteReferenceSdkWorkflow,
    /Validate the complete SDK catalogue[\s\S]*?sdk-catalog\.mjs check[\s\S]*?sdk-documentation\.mjs check/,
  );
  assert.match(promoteReferenceSdkWorkflow, /Promote the embedded reference application/);
  assert.match(promoteReferenceSdkWorkflow, /apps\/reference\/scripts\/reference-sdk-promotion\.mjs/);
  assert.match(promoteReferenceSdkWorkflow, /gh pr create/);
  assert.doesNotMatch(promoteReferenceSdkWorkflow, /gh pr (?:merge|review)/);
  assert.match(syncFlutterFlowWorkflow, /workflow_call:/);
  assert.match(syncFlutterFlowWorkflow, /inputs\.source_ref/);
  assert.doesNotMatch(
    syncFlutterFlowWorkflow,
    /workflows: \[Release OpenGrow SDK\]/,
  );
});

test("reference promotion is local to the monorepo and requires no cross-repository credential", () => {
  const dispatchJobHeader = workflowSection(
    promoteReferenceSdkWorkflow,
    "\n  dispatch:",
    "\n    steps:",
  );
  assert.match(dispatchJobHeader, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.doesNotMatch(
    dispatchJobHeader,
    /secrets\.SUPERBOARD_REFERENCE_DISPATCH_TOKEN/u,
  );

  const releaseVerification = workflowSection(
    promoteReferenceSdkWorkflow,
    "      - name: Verify every immutable SDK tag and GitHub release",
    "      - uses: subosito/flutter-action@",
  );
  assert.match(
    releaseVerification,
    /gh api "repos\/\$GITHUB_REPOSITORY\/releases\/tags\/\$tag"/u,
  );
  assert.doesNotMatch(
    releaseVerification,
    /SUPERBOARD_REFERENCE_DISPATCH_TOKEN/u,
  );

  const embeddedPromotion = workflowSection(
    promoteReferenceSdkWorkflow,
    "      - name: Promote the embedded reference application",
    "\n\n  sync-development-library:",
  );
  assert.match(embeddedPromotion, /git add apps\/reference/u);
  assert.match(embeddedPromotion, /gh pr create/u);
  assert.doesNotMatch(
    promoteReferenceSdkWorkflow,
    /SUPERBOARD_REFERENCE_(?:REPOSITORY|DISPATCH_TOKEN)|OPENGROW_REFERENCE_/u,
  );
});
