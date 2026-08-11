import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkerShellPlan,
  buildWorkerShellPlan,
  parseWranglerWorkerInspection,
  workerShellConfirmation,
} from "./cloudflare-worker-shells.mjs";

const target = {
  target: "sample-development",
  accountAlias: "sample-development",
  resourceIdentity: {
    logicalName: "sample",
    physicalName: "sample",
    previousNames: [],
    migrationStrategy: "canonical",
  },
  features: {
    billing: false,
    messaging: false,
    app: false,
    products: false,
    paywalls: false,
    "dynamic-links": false,
    support: false,
    marketing: false,
    onboardings: false,
  },
  workers: Object.fromEntries(
    [
      "observability",
      "email",
      "files",
      "identity",
      "api",
      "mcp",
      "dashboard",
    ].map((service) => [service, { development: `sample-${service}-dev` }]),
  ),
};

test("Worker shell planning is ordered, scoped and idempotent", () => {
  const plan = buildWorkerShellPlan({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    existingWorkerNames: ["sample-observability-dev", "unrelated-worker"],
  });
  assert.equal(plan.ready, false);
  assert.equal(plan.workers.length, 7);
  assert.equal(plan.resourceIdentity.logicalName, "sample");
  assert.equal(
    plan.workers.every(
      ({ name, logicalName, physicalName }) =>
        name === physicalName && logicalName === physicalName,
    ),
    true,
  );
  assert.equal(plan.workers[0].state, "existing");
  assert.equal(plan.workers[1].state, "create-private-shell");
  assert.equal(JSON.stringify(plan).includes("a".repeat(32)), false);
  assert.equal(plan.confirmation, workerShellConfirmation(plan));

  const ready = buildWorkerShellPlan({
    target,
    environment: "development",
    accountId: "a".repeat(32),
    existingWorkerNames: plan.workers.map(({ name }) => name),
  });
  assert.equal(ready.ready, true);
  assert.equal(
    ready.workers.every(({ state }) => state === "existing"),
    true,
  );
});

test("Worker shell apply requires exact confirmation and creates only missing services", async () => {
  const plan = buildWorkerShellPlan({
    target,
    environment: "development",
    accountId: "b".repeat(32),
    existingWorkerNames: ["sample-observability-dev"],
  });
  const calls = [];
  await assert.rejects(
    applyWorkerShellPlan(plan, {
      confirm: "CLOUDFLARE:WORKER-SHELLS:wrong",
      create: async (worker) => calls.push(worker.name),
    }),
    /pass --confirm/u,
  );
  assert.deepEqual(calls, []);

  const applied = await applyWorkerShellPlan(plan, {
    confirm: plan.confirmation,
    create: async (worker) => calls.push(worker.name),
  });
  assert.equal(applied.length, 6);
  assert.equal(calls.includes("sample-observability-dev"), false);
  assert.equal(new Set(calls).size, calls.length);
});

test("Worker shell plan rejects duplicate or unsafe Worker names", () => {
  assert.throws(
    () =>
      buildWorkerShellPlan({
        target: {
          ...target,
          workers: {
            ...target.workers,
            api: { development: "sample-mcp-dev" },
          },
        },
        environment: "development",
        accountId: "c".repeat(32),
        existingWorkerNames: [],
      }),
    /unique/u,
  );
  assert.throws(
    () =>
      buildWorkerShellPlan({
        target: {
          ...target,
          workers: {
            ...target.workers,
            api: { development: "../unsafe" },
          },
        },
        environment: "development",
        accountId: "c".repeat(32),
        existingWorkerNames: [],
      }),
    /Invalid Worker name/u,
  );
});

test("Wrangler OAuth inspection distinguishes missing Workers from access failures", () => {
  assert.equal(
    parseWranglerWorkerInspection("superboard-api-dev", {
      status: 0,
      stdout: "[]",
      stderr: "",
    }),
    "superboard-api-dev",
  );
  assert.equal(
    parseWranglerWorkerInspection("superboard-api-dev", {
      status: 1,
      stdout: "",
      stderr: "This Worker does not exist on your account. [code: 10007]",
    }),
    null,
  );
  assert.throws(
    () =>
      parseWranglerWorkerInspection("superboard-api-dev", {
        status: 1,
        stdout: "",
        stderr: "Authentication failed [code: 10000]",
      }),
    /Unable to inspect Worker superboard-api-dev/u,
  );
});
