import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  flutterFlowSourceEnvironmentName,
  flutterFlowSourceEvidence,
  resolveFlutterFlowSourcePath,
  verifyFlutterFlowSource,
} from "./flutterflow-source-verify.mjs";
import {
  createFlutterFlowClientReceipt,
  verifyFlutterFlowClientReceipt,
} from "./flutterflow-client-release.mjs";

test("a reviewed FlutterFlow snapshot verifies every declared generated file", (t) => {
  const fixture = createFixture(t);
  const result = verifyFlutterFlowSource(fixture);

  assert.equal(result.ready, true);
  assert.equal(result.project.id, "project-test");
  assert.equal(result.generatedFilesVerified, 7);
  assert.deepEqual(result.inventory, fixture.inventory);
});

test("the application source resolves from one portable environment contract", (t) => {
  const fixture = createFixture(t);
  assert.equal(
    flutterFlowSourceEnvironmentName("sample-app"),
    "OPENGROW_CLIENT_SOURCE_SAMPLE_APP",
  );
  assert.equal(
    resolveFlutterFlowSourcePath({
      manifestPath: fixture.manifestPath,
      env: { OPENGROW_CLIENT_SOURCE_TEST: fixture.sourcePath },
    }),
    fixture.sourcePath,
  );
  assert.equal(
    resolveFlutterFlowSourcePath({
      manifestPath: fixture.manifestPath,
      explicitSource: "/explicit/source",
      env: { OPENGROW_CLIENT_SOURCE_TEST: fixture.sourcePath },
    }),
    "/explicit/source",
  );
  assert.throws(
    () =>
      resolveFlutterFlowSourcePath({
        manifestPath: fixture.manifestPath,
        env: {},
      }),
    /--source or OPENGROW_CLIENT_SOURCE_TEST is required/u,
  );
});

test("a generated source change invalidates the reviewed snapshot", (t) => {
  const fixture = createFixture(t);
  writeFileSync(
    join(fixture.sourcePath, "lib/flutterflow_project/schemas.dart"),
    "tampered",
  );

  assert.throws(
    () => verifyFlutterFlowSource(fixture),
    /generated hash does not match the reviewed snapshot/u,
  );
});

test("a reviewed snapshot can remain authentic while client convergence is blocked", (t) => {
  const fixture = createFixture(t);
  write(
    fixture.sourcePath,
    "generated_code/lib/custom_code/legacy.dart",
    "const origin = 'https://legacy.example.test';\nvoid oldSupport() {}\n",
  );
  write(
    fixture.sourcePath,
    "generated_code/lib/main.dart",
    "void canonicalBootstrap() {}\n",
  );
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
  manifest.convergence = {
    schemaVersion: 1,
    checks: [
      {
        id: "legacy-origin",
        kind: "literal-absent",
        value: "legacy.example.test",
        paths: ["generated_code/lib"],
      },
      {
        id: "legacy-action",
        kind: "symbol-absent",
        value: "oldSupport",
        paths: ["generated_code/lib"],
      },
      {
        id: "canonical-bootstrap",
        kind: "symbol-present",
        value: "canonicalBootstrap",
        paths: ["generated_code/lib"],
      },
      {
        id: "clean-diagnostics",
        kind: "diagnostics-max",
        maximum: 0,
      },
      {
        id: "clean-validation",
        kind: "validation-errors-max",
        maximum: 0,
      },
    ],
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

  const result = verifyFlutterFlowSource(fixture);
  assert.equal(result.snapshotVerified, true);
  assert.equal(result.ready, false);
  assert.deepEqual(result.convergence.blockers, [
    "legacy-origin",
    "legacy-action",
    "clean-diagnostics",
    "clean-validation",
  ]);
  assert.equal(result.convergence.checks[0].matches, 1);
  assert.deepEqual(result.convergence.checks[0].files, [
    "generated_code/lib/custom_code/legacy.dart",
  ]);
  assert.equal(result.convergence.checks[2].ready, true);
});

test("an absent scan path fails closed instead of proving a literal absent", (t) => {
  const fixture = createFixture(t);
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
  manifest.convergence = {
    schemaVersion: 1,
    checks: [
      {
        id: "required-runtime-source",
        kind: "literal-absent",
        value: "legacy.example.test",
        paths: ["generated_code/lib"],
      },
    ],
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

  const result = verifyFlutterFlowSource(fixture);
  assert.equal(result.ready, false);
  assert.deepEqual(result.convergence.blockers, ["required-runtime-source"]);
  assert.deepEqual(result.convergence.checks[0].missingPaths, [
    "generated_code/lib",
  ]);
});

test("bounded FlutterFlow analyzer defects do not hide new diagnostics", (t) => {
  const fixture = createFixture(t);
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
  manifest.convergence = {
    schemaVersion: 1,
    checks: [
      {
        id: "actionable-diagnostics",
        kind: "diagnostics-unwaived-max",
        maximum: 0,
        allowedByCode: { R18: 2 },
      },
    ],
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

  const accepted = verifyFlutterFlowSource(fixture);
  const check = accepted.convergence.checks[0];
  assert.equal(check.ready, true);
  assert.equal(check.actual, 0);
  assert.deepEqual(check.waivedByCode, { R18: 2 });

  const sourceRunPath = join(
    fixture.sourcePath,
    ".flutterflow/last_run.json",
  );
  const lastRun = JSON.parse(readFileSync(sourceRunPath, "utf8"));
  lastRun.diagnostics.push({ code: "R18", severity: "warning" });
  writeFileSync(sourceRunPath, JSON.stringify(lastRun));
  manifest.diagnostics.total = 3;
  manifest.diagnostics.byCode.R18 = 3;
  manifest.fingerprints[".flutterflow/last_run.json"] = hash(sourceRunPath);
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

  const blocked = verifyFlutterFlowSource(fixture);
  assert.equal(blocked.convergence.ready, false);
  assert.equal(blocked.convergence.checks[0].actual, 1);
  assert.deepEqual(blocked.convergence.blockers, ["actionable-diagnostics"]);
});

test("the snapshot schema rejects undeclared fields and escaping convergence paths", (t) => {
  const fixture = createFixture(t);
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
  manifest.unreviewed = true;
  manifest.convergence = {
    schemaVersion: 1,
    checks: [
      {
        id: "escape",
        kind: "literal-absent",
        value: "legacy",
        paths: ["../outside"],
      },
    ],
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));

  assert.throws(
    () => verifyFlutterFlowSource(fixture),
    /Invalid FlutterFlow snapshot manifest/u,
  );
});

test("convergence evidence binds every declared external source file", (t) => {
  const fixture = createFixture(t);
  write(fixture.sourcePath, "generated_code/lib/one.dart", "one\n");
  write(fixture.sourcePath, "generated_code/lib/two.dart", "two\n");
  const policy = {
    schemaVersion: 1,
    checks: [
      {
        id: "canonical",
        kind: "symbol-present",
        value: "one",
        paths: ["generated_code/lib"],
      },
      {
        id: "duplicate-path",
        kind: "literal-absent",
        value: "legacy",
        paths: ["generated_code/lib"],
      },
    ],
  };

  const first = flutterFlowSourceEvidence({
    sourceRoot: fixture.sourcePath,
    policy,
  });
  assert.equal(first.files, 2);
  assert.match(first.sha256, /^[a-f0-9]{64}$/u);
  write(fixture.sourcePath, "generated_code/lib/two.dart", "changed\n");
  const second = flutterFlowSourceEvidence({
    sourceRoot: fixture.sourcePath,
    policy,
  });
  assert.notEqual(second.sha256, first.sha256);
});

test("an accepted client receipt binds the reviewed snapshot, policy and source tree", (t) => {
  const fixture = createFixture(t);
  write(
    fixture.sourcePath,
    "generated_code/lib/main.dart",
    "void canonicalBootstrap() {}\n",
  );
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8"));
  manifest.convergence = {
    schemaVersion: 1,
    checks: [
      {
        id: "legacy-absent",
        kind: "literal-absent",
        value: "legacy.example.test",
        paths: ["generated_code/lib"],
      },
      {
        id: "canonical-present",
        kind: "symbol-present",
        value: "canonicalBootstrap",
        paths: ["generated_code/lib"],
      },
      {
        id: "diagnostics-reviewed",
        kind: "diagnostics-max",
        maximum: 2,
      },
    ],
  };
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
  const receipt = createFlutterFlowClientReceipt({
    manifestPath: fixture.manifestPath,
    sourcePath: fixture.sourcePath,
    issuedAt: "2026-08-09T18:00:00.000Z",
  });
  const receiptPath = join(fixture.sourcePath, "receipt.json");
  writeFileSync(receiptPath, JSON.stringify(receipt));

  assert.equal(receipt.status, "accepted");
  assert.deepEqual(receipt.checks, { total: 3, passed: 3, blocked: 0 });
  assert.equal(receipt.sourceEvidence.files, 1);
  assert.equal(
    verifyFlutterFlowClientReceipt({
      manifestPath: fixture.manifestPath,
      receiptPath,
      sourcePath: fixture.sourcePath,
    }).ready,
    true,
  );

  write(
    fixture.sourcePath,
    "generated_code/lib/main.dart",
    "void canonicalBootstrap() {}\n// changed after acceptance\n",
  );
  assert.throws(
    () =>
      verifyFlutterFlowClientReceipt({
        manifestPath: fixture.manifestPath,
        receiptPath,
        sourcePath: fixture.sourcePath,
      }),
    /source evidence does not match/u,
  );
});

function createFixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), "opengrow-flutterflow-source-"));
  const sourcePath = join(temporary, "source");
  const manifestPath = join(temporary, "snapshot.json");
  t.after(() => rmSync(temporary, { recursive: true, force: true }));

  const generated = {
    "lib/flutterflow_project/project.dart": "project fixture\n",
    "lib/flutterflow_project/schemas.dart": `
abstract final class Structs {
  static final ffai.StructHandle first = value;
  static final ffai.StructHandle second = value;
}
abstract final class CustomCode {
  static const functions = <String>["oneFunction"];
  static const actions = <String>["oneAction", "twoAction"];
  static const widgets = <String>["oneWidget"];
}
`,
    "lib/flutterflow_project/app_state.dart": `
static const first = ffai.ProjectAppStateFieldHandle();
static const second = ffai.ProjectAppStateFieldHandle();
`,
    "lib/flutterflow_project/apis.dart": `
abstract final class ApiGroups {
  static const all = <String>["group"];
}
abstract final class ActionBlocks {
  static const all = <String>["firstBlock", "secondBlock"];
}
`,
    "lib/flutterflow_project/pages/first.dart": "first page\n",
    "lib/flutterflow_project/pages/second.dart": "second page\n",
    "lib/flutterflow_project/components/first.dart": "first component\n",
  };
  for (const [relativePath, content] of Object.entries(generated)) {
    write(sourcePath, relativePath, content);
  }

  const files = {
    project: descriptor(sourcePath, "lib/flutterflow_project/project.dart"),
    schemas: descriptor(sourcePath, "lib/flutterflow_project/schemas.dart"),
    app_state: descriptor(sourcePath, "lib/flutterflow_project/app_state.dart"),
    apis: descriptor(sourcePath, "lib/flutterflow_project/apis.dart"),
    "page:first": descriptor(
      sourcePath,
      "lib/flutterflow_project/pages/first.dart",
    ),
    "page:second": descriptor(
      sourcePath,
      "lib/flutterflow_project/pages/second.dart",
    ),
    "component:first": descriptor(
      sourcePath,
      "lib/flutterflow_project/components/first.dart",
    ),
  };
  const lastRun = {
    projectId: "project-test",
    timestamp: "2026-08-09T00:00:00.000Z",
    commitId: "commit-test",
    commitMessage: "Test snapshot",
    success: true,
    pushed: true,
    dryRun: false,
    tasks: [{ validationErrors: ["warning"] }],
    diagnostics: [
      { code: "R18", severity: "warning" },
      { code: "R18", severity: "warning" },
    ],
  };
  const generatedState = {
    projectId: "project-test",
    status: "fresh",
    lastExportedAt: "2026-08-09T00:00:01.000Z",
  };
  const sdkMeta = {
    projectId: "project-test",
    projectName: "Test",
    generatedAt: "2026-08-09T00:00:00.500Z",
    projectUpdatedAtMs: 1,
    files,
  };
  write(sourcePath, ".flutterflow/last_run.json", JSON.stringify(lastRun));
  write(
    sourcePath,
    ".flutterflow/generated_code_state.json",
    JSON.stringify(generatedState),
  );
  write(
    sourcePath,
    ".flutterflow/project_sdk_meta.json",
    JSON.stringify(sdkMeta),
  );

  const inventory = {
    pages: 2,
    components: 1,
    actionBlocks: 2,
    appEventsReported: 1,
    apiCallsReported: 3,
    customActions: 2,
    customFunctions: 1,
    customWidgets: 1,
    dataStructs: 2,
    appStateFields: 2,
  };
  const manifest = {
    schemaVersion: 1,
    application: "test",
    project: { id: "project-test", name: "Test" },
    export: {
      timestamp: lastRun.timestamp,
      commitId: lastRun.commitId,
      commitMessage: lastRun.commitMessage,
      success: true,
      pushed: true,
      dryRun: false,
      generatedAt: sdkMeta.generatedAt,
      lastExportedAt: generatedState.lastExportedAt,
      projectUpdatedAtMs: 1,
    },
    fingerprints: Object.fromEntries(
      [
        ".flutterflow/last_run.json",
        ".flutterflow/generated_code_state.json",
        ".flutterflow/project_sdk_meta.json",
      ].map((relativePath) => [
        relativePath,
        hash(join(sourcePath, relativePath)),
      ]),
    ),
    inventory,
    diagnostics: {
      total: 2,
      validationErrors: 1,
      byCode: { R18: 2 },
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { manifestPath, sourcePath, inventory };
}

function descriptor(sourcePath, path) {
  return { path, sha: hash(join(sourcePath, path)) };
}

function write(sourcePath, relativePath, content) {
  const path = join(sourcePath, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
