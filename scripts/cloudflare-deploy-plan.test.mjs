import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTarget } from "./cloudflare-target.mjs";
import {
  buildDeploymentExecutionPlan,
  deploymentOrder,
} from "./cloudflare-deploy-plan.mjs";

test("full production deployment backs up and migrates every D1 before Workers", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildDeploymentExecutionPlan({
    target,
    environment: "production",
  });
  assert.equal(plan.fullDeployment, true);
  assert.equal(plan.migrationStrategy, "backup-and-migrate-all-before-workers");
  assert.deepEqual(
    plan.phases.map(({ id }) => id),
    ["d1-batch", "workers"],
  );
  assert.equal(plan.services.at(-1), "dashboard");
  assert.ok(plan.schemaServices.includes("api"));
  assert.ok(plan.schemaServices.includes("custom"));
  assert.deepEqual(plan.services, deploymentOrder(target));
});

test("production preflight uploads isolated versions without migrations", async () => {
  const { target } = await loadTarget("vocostar");
  const plan = buildDeploymentExecutionPlan({
    target,
    environment: "production",
    uploadOnly: true,
    preflight: true,
  });
  assert.equal(plan.migrationStrategy, "none");
  assert.equal(plan.phases[0].id, "worker-versions");
});

test("development and partial recovery preserve per-service convergence", async () => {
  const { target } = await loadTarget("mbza-development");
  const development = buildDeploymentExecutionPlan({
    target,
    environment: "development",
  });
  assert.equal(development.migrationStrategy, "per-service-before-worker");
  const recovery = buildDeploymentExecutionPlan({
    target,
    environment: "production",
    requestedServices: "email",
  });
  assert.equal(recovery.fullDeployment, false);
  assert.equal(recovery.migrationStrategy, "per-service-before-worker");
  assert.deepEqual(recovery.services, ["email"]);
});

test("partial production cannot interleave several services around D1 backups", async () => {
  const { target } = await loadTarget("vocostar");
  assert.throws(
    () =>
      buildDeploymentExecutionPlan({
        target,
        environment: "production",
        requestedServices: "observability,email,api",
      }),
    /only one D1 schema owner at a time/u,
  );
});

test("no production topology can use the skip-migrations escape hatch", async () => {
  const { target } = await loadTarget("vocostar");
  assert.throws(
    () =>
      buildDeploymentExecutionPlan({
        target,
        environment: "production",
        requestedServices: "dashboard",
        skipMigrations: true,
      }),
    /cannot skip migrations/u,
  );
});

test("the deploy orchestrator consumes a verified batch before its Worker loop", async () => {
  const deployAll = await readFile(
    new URL("./cloudflare-deploy-all.mjs", import.meta.url),
    "utf8",
  );
  const deployService = await readFile(
    new URL("./cloudflare-deploy.mjs", import.meta.url),
    "utf8",
  );
  const allowlist = await readFile(
    new URL("./opengrow-allowlist.mjs", import.meta.url),
    "utf8",
  );
  const batchIndex = deployAll.indexOf("await applyD1Convergence");
  const receiptIndex = deployAll.indexOf("await writeMigrationBatchReceipt");
  const workerLoopIndex = deployAll.indexOf("for (const service of services)");
  assert.ok(batchIndex > 0 && batchIndex < receiptIndex);
  assert.ok(receiptIndex < workerLoopIndex);
  assert.match(deployAll, /--migration-batch-receipt/u);
  assert.match(deployAll, /--migration-batch-sha256/u);
  assert.match(deployService, /await readMigrationBatchReceipt/u);
  assert.match(deployService, /!migrationsConvergedByBatch/u);
  assert.match(
    deployService,
    /args\["no-routes"\][\s\S]*\["--no-routes"\][\s\S]*opengrow-allowlist/u,
  );
  assert.match(allowlist, /args\["no-routes"\].*\["--no-routes"\]/u);
});
