import assert from "node:assert/strict";
import test from "node:test";

import {
  flutterFlowApplicationMatrix,
  renderFlutterFlowApplicationBindings,
  sourceForbiddenLiterals,
  validateFlutterFlowApplicationWorkspaces,
} from "./flutterflow-application-dsl.mjs";
import { resolveFlutterFlowApplications } from "./flutterflow-application-config.mjs";

test("the Git-owned VocoStar workspace binds all SuperBoard parameters", async () => {
  const output = await resolveFlutterFlowApplications();
  const application = output.applications[0];
  const dart = renderFlutterFlowApplicationBindings(application);
  assert.equal((dart.match(/\n    name: /gu) || []).length, 11);
  assert.match(dart, /name: "supportBaseUrl"/u);
  assert.match(
    dart,
    /value: "https:\/\/api\.vocostar\.com\/api\/v1\/support-client"/u,
  );
  assert.match(dart, /name: "shortLinkHost"/u);
  assert.match(dart, /value: "go\.vocostar\.com"/u);
  assert.match(dart, /environmentSecret: "SUPERBOARD_PROJECT_KEY"/u);
  assert.doesNotMatch(dart, /projectKey[^\n]*[A-Fa-f0-9]{32}/u);
  assert.doesNotMatch(dart, /FF_API_KEY|open-grow-private/u);
});

test("the workflow matrix is derived from the registry", async () => {
  const output = await resolveFlutterFlowApplications();
  assert.deepEqual(flutterFlowApplicationMatrix(output), {
    include: [
      {
        id: "vocostar",
        githubEnvironment: "flutterflow-vocostar",
        workspace: "tools/flutterflow-applications/vocostar",
      },
    ],
  });
});

test("the checked-in FlutterFlow application workspace is current", async () => {
  const result = await validateFlutterFlowApplicationWorkspaces();
  assert.deepEqual(result, {
    schemaVersion: 1,
    status: "ok",
    applications: 1,
    bindings: 11,
    errors: [],
  });
});

test("a changed target makes checked-in Dart fail closed", async () => {
  const output = await resolveFlutterFlowApplications();
  const changed = structuredClone(output);
  changed.applications[0].values.sdkBaseUrl = "https://sdk.changed.example";
  const result = await validateFlutterFlowApplicationWorkspaces({
    output: changed,
  });
  assert.equal(result.status, "blocked");
  assert.match(result.errors.join("\n"), /generated bindings are stale/u);
});

test("migration source literals come from the convergence manifest", () => {
  assert.deepEqual(
    sourceForbiddenLiterals({
      convergence: {
        checks: [
          { kind: "symbol-absent", value: "legacyAction" },
          { kind: "literal-absent", value: "legacy.example" },
          { kind: "literal-absent", value: "legacy.example" },
          { kind: "literal-absent", value: "old.example" },
        ],
      },
    }),
    ["legacy.example", "old.example"],
  );
  assert.throws(
    () => sourceForbiddenLiterals({}),
    /convergence checks are unavailable/u,
  );
});
