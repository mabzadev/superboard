import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadTarget } from "./cloudflare-target.mjs";
import {
  buildFlutterFlowMigrationPlan,
  migrationPlanStatus,
  validateFlutterFlowMigrationContract,
} from "./flutterflow-migration-plan.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));

test("VocoStar migration maps every convergence gate to public SDK symbols", async () => {
  const result = await buildFlutterFlowMigrationPlan({
    manifestPath: resolve(root, "config/flutterflow-migrations/vocostar.json"),
  });
  assert.equal(result.contractReady, true);
  assert.equal(result.sourceInspected, false);
  assert.equal(result.ready, false);
  assert.equal(result.sourceEnvironment, "SUPERBOARD_CLIENT_SOURCE_VOCOSTAR");
  assert.deepEqual(result.sourceEnvironmentAliases, [
    "OPENGROW_CLIENT_SOURCE_VOCOSTAR",
  ]);
  assert.deepEqual(result.contract, {
    phases: 7,
    workItems: 10,
    convergenceChecks: 35,
    replacementSymbols: 36,
  });
  assert.equal(result.workItems.length, 10);
  assert.equal(result.phases.at(-1).id, "quality");
});

test("migration status joins blocked source checks to work items and phases", async () => {
  const plan = await json("config/flutterflow-migrations/vocostar.json");
  const status = migrationPlanStatus({
    plan,
    contract: {
      phases: 7,
      workItems: 10,
      convergenceChecks: 31,
      replacementSymbols: 34,
    },
    verification: {
      snapshotVerified: true,
      ready: false,
      diagnostics: { total: 1, validationErrors: 1, byCode: { SAMPLE: 1 } },
      convergence: {
        checks: plan.workItems.flatMap((item) =>
          item.convergenceChecks.map((id) => ({
            id,
            ready: id !== "flutterflow-validation-errors-cleared",
          })),
        ),
        blockers: ["flutterflow-validation-errors-cleared"],
      },
    },
  });
  assert.equal(status.ready, false);
  assert.deepEqual(status.blockedWorkItems, ["flutterflow-quality"]);
  assert.equal(status.phases.at(-1).ready, false);
  assert.deepEqual(status.phases.at(-1).blockedWorkItems, [
    "flutterflow-quality",
  ]);
});

test("migration contract rejects duplicate gates, unknown symbols and forward dependencies", async () => {
  const plan = await json("config/flutterflow-migrations/vocostar.json");
  const snapshot = await json("config/flutterflow-sources/vocostar.json");
  const surface = await json("config/flutterflow-custom-code.json");
  const { target } = await loadTarget("vocostar");

  const duplicate = structuredClone(plan);
  duplicate.workItems[1].convergenceChecks.push(
    duplicate.workItems[0].convergenceChecks[0],
  );
  assert.throws(
    () =>
      validateFlutterFlowMigrationContract({
        plan: duplicate,
        snapshot,
        surface,
        target,
      }),
    /mapped by both/u,
  );

  const unknownSymbol = structuredClone(plan);
  unknownSymbol.workItems[0].replacementSymbols.push("missingPublicAction");
  assert.throws(
    () =>
      validateFlutterFlowMigrationContract({
        plan: unknownSymbol,
        snapshot,
        surface,
        target,
      }),
    /unknown public symbol/u,
  );

  const forwardDependency = structuredClone(plan);
  forwardDependency.phases[0].dependsOn.push("quality");
  assert.throws(
    () =>
      validateFlutterFlowMigrationContract({
        plan: forwardDependency,
        snapshot,
        surface,
        target,
      }),
    /earlier phase/u,
  );
});

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}
