import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTarget } from "./cloudflare-target.mjs";
import {
  buildDeploymentExecutionPlan,
  deploymentOrder,
  runtimeBridgeDeploymentBlockers,
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
    ["d1-batch", "identity-cutover", "workers"],
  );
  assert.equal(plan.identityCutover, true);
  assert.equal(plan.services.at(-1), "dashboard");
  assert.ok(plan.schemaServices.includes("api"));
  assert.ok(plan.schemaServices.includes("custom"));
  assert.deepEqual(
    plan.services.filter((service) => service.startsWith("managed-")),
    ["managed-vocals-orchestrator", "managed-medias-orchestrator"],
  );
  assert.ok(
    plan.services.indexOf("managed-medias-orchestrator") <
      plan.services.indexOf("custom"),
  );
  assert.deepEqual(plan.services, deploymentOrder(target));
  assert.deepEqual(
    plan.blockers.map(({ id }) => id),
    [
      "runtime-bridge-unverified",
      "files-input-routing-inactive",
      "gateway-callback-owner-mismatch",
    ],
  );
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
  assert.deepEqual(plan.blockers, []);
});

test("runtime bridge deployment opens only after routing, callback ownership, and review converge", async () => {
  const original = (await loadTarget("vocostar")).target;
  const target = structuredClone(original);
  const services = ["managed-vocals-orchestrator", "custom"];
  assert.equal(
    runtimeBridgeDeploymentBlockers({
      target,
      environment: "production",
      services,
    }).length,
    3,
  );

  target.environments.production.publicRouting = "active";
  target.customWorker.runtimeBridge.deploymentStatus = "verified";
  target.customWorker.runtimeBridge.gatewayWorker =
    target.workers.api.production;
  assert.deepEqual(
    runtimeBridgeDeploymentBlockers({
      target,
      environment: "production",
      services,
    }),
    [],
  );
  assert.deepEqual(
    runtimeBridgeDeploymentBlockers({
      target: original,
      environment: "production",
      services,
      uploadOnly: true,
    }),
    [],
  );
});

test("development and partial recovery preserve per-service convergence", async () => {
  const { target } = await loadTarget("mbza-development");
  const development = buildDeploymentExecutionPlan({
    target,
    environment: "development",
  });
  assert.equal(development.migrationStrategy, "per-service-before-worker");
  assert.equal(development.identityCutover, true);
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
    new URL("./superboard-allowlist.mjs", import.meta.url),
    "utf8",
  );
  const batchIndex = deployAll.indexOf("await applyD1Convergence");
  const blockerIndex = deployAll.indexOf("if (plan.blockers.length > 0)");
  const receiptIndex = deployAll.indexOf("await writeMigrationBatchReceipt");
  const workerLoopIndex = deployAll.indexOf("for (const service of services)");
  assert.ok(blockerIndex > 0 && blockerIndex < batchIndex);
  assert.ok(batchIndex > 0 && batchIndex < receiptIndex);
  assert.ok(receiptIndex < workerLoopIndex);
  assert.match(deployAll, /--migration-batch-receipt/u);
  assert.match(deployAll, /--migration-batch-sha256/u);
  assert.match(deployAll, /await verifyIdentityProjectCutover/u);
  assert.match(deployAll, /--identity-cutover-receipt/u);
  assert.match(deployAll, /--identity-cutover-sha256/u);
  assert.match(
    deployAll,
    /const targetCloudflareEnv = cloudflareEnv\(target\)/u,
  );
  assert.match(
    deployService,
    /const targetCloudflareEnv = cloudflareEnv\(target\)/u,
  );
  const finalConfigGeneration = deployService.lastIndexOf(
    "generateServiceConfig();",
  );
  const identityCutover = deployService.indexOf(
    "await enforceIdentityProjectCutover",
  );
  const workerDeployment = deployService.lastIndexOf(
    'if (service === "dashboard")',
  );
  assert.ok(identityCutover > 0 && identityCutover < finalConfigGeneration);
  assert.ok(
    finalConfigGeneration < workerDeployment,
    "deployment configuration must be regenerated after migration helpers and before Worker activation",
  );
  assert.match(deployService, /await readMigrationBatchReceipt/u);
  assert.ok(
    deployService.indexOf("runtimeBridgeDeploymentBlockers") <
      deployService.indexOf("cloudflare-config.mjs"),
  );
  assert.match(deployService, /await enforceIdentityProjectCutover/u);
  assert.match(deployService, /!migrationsConvergedByBatch/u);
  const allowlistBootstrap = deployService.indexOf("superboard-allowlist.mjs");
  assert.ok(
    allowlistBootstrap > 0 &&
      deployService.indexOf(
        '...(args["no-routes"] ? ["--no-routes"] : [])',
        allowlistBootstrap,
      ) > allowlistBootstrap,
  );
  assert.match(allowlist, /args\["no-routes"\].*\["--no-routes"\]/u);
	assert.match(
		deployService,
		/args\["site-preview-route"\].*\["--site-preview-route"\]/su,
	);
});
