import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export function parseQueueConsumer(output) {
  const count = Number(
    /^[ \t]*Number of Consumers:[ \t]*(\d+)/m.exec(output)?.[1] ?? "0",
  );
  const values = /^[ \t]*Consumers:[ \t]*([^\r\n]*)/m.exec(output)?.[1] ?? "";
  const consumers = values
    .split(",")
    .map((value) => value.trim().replace(/^worker:/, ""))
    .filter(Boolean);
  if (count !== consumers.length) {
    throw new Error(
      `Unable to parse queue consumer state: expected ${count}, found ${consumers.length}`,
    );
  }
  if (consumers.length > 1)
    throw new Error("Billing queue has more than one active consumer");
  return consumers[0] ?? null;
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const execute = Boolean(args.execute);
  const { target } = await loadTarget(targetName);
  const resources = target.environments[environment];
  if (!resources)
    throw new Error(
      `${targetName} does not define a ${environment} environment`,
    );

  run(process.execPath, [
    resolve(root, "scripts", "cloudflare-billing-config.mjs"),
    "--target",
    targetName,
    "--environment",
    environment,
  ]);

  const queue = resources.queues.billing;
  const expected =
    resources.billingExecutionMode === "service"
      ? target.workers.billing[environment]
      : target.workers.api[environment];
  const current = queueConsumer(
    queue,
    configPath(targetName, "api", environment),
  );
  if (current === expected) {
    console.log(`Billing queue consumer is already correct: ${expected}`);
    return;
  }

  const confirmation = `${queue}:${current ?? "none"}:${expected}`;
  if (!execute) {
    throw new Error(
      `Billing queue consumer drift: expected ${expected}, found ${current ?? "none"}. ` +
        `Run again with --execute --confirm ${confirmation} after reviewing the controlled cutover guide.`,
    );
  }
  if (args.confirm !== confirmation) {
    throw new Error(`Exact confirmation required: --confirm ${confirmation}`);
  }
  if (
    environment === "production" &&
    resources.billingExecutionMode === "service"
  ) {
    await assertBillingReadiness(target.domains.api);
  }

  const sourceConfig = configPath(
    targetName,
    current === target.workers.billing[environment] ? "billing" : "api",
    environment,
  );
  const destinationConfig = configPath(
    targetName,
    expected === target.workers.billing[environment] ? "billing" : "api",
    environment,
  );
  let paused = false;
  let removed = false;
  let added = false;
  try {
    run("npx", [
      "wrangler",
      "queues",
      "pause-delivery",
      queue,
      "--config",
      sourceConfig,
    ]);
    paused = true;
    if (current) {
      run("npx", [
        "wrangler",
        "queues",
        "consumer",
        "remove",
        queue,
        current,
        "--config",
        sourceConfig,
      ]);
      removed = true;
    }
    addConsumer(
      queue,
      expected,
      resources.queues.billingDlq,
      destinationConfig,
    );
    added = true;
    const verified = queueConsumer(queue, destinationConfig);
    if (verified !== expected)
      throw new Error(`Consumer verification returned ${verified ?? "none"}`);
    run("npx", [
      "wrangler",
      "queues",
      "resume-delivery",
      queue,
      "--config",
      destinationConfig,
    ]);
    paused = false;
    console.log(
      `Billing queue consumer moved from ${current ?? "none"} to ${expected}`,
    );
  } catch (error) {
    console.error("Billing queue cutover failed; attempting consumer rollback");
    if (added) {
      tryRun("npx", [
        "wrangler",
        "queues",
        "consumer",
        "remove",
        queue,
        expected,
        "--config",
        destinationConfig,
      ]);
    }
    if (removed && current) {
      try {
        addConsumer(queue, current, resources.queues.billingDlq, sourceConfig);
      } catch (rollbackError) {
        console.error(`Consumer rollback failed: ${message(rollbackError)}`);
      }
    }
    if (paused)
      tryRun("npx", [
        "wrangler",
        "queues",
        "resume-delivery",
        queue,
        "--config",
        sourceConfig,
      ]);
    throw error;
  }
}

function addConsumer(queue, worker, dlq, config) {
  run("npx", [
    "wrangler",
    "queues",
    "consumer",
    "add",
    queue,
    worker,
    "--batch-size",
    "10",
    "--batch-timeout",
    "5",
    "--message-retries",
    "8",
    "--dead-letter-queue",
    dlq,
    "--config",
    config,
  ]);
}

function queueConsumer(queue, config) {
  const output = capture("npx", [
    "wrangler",
    "queues",
    "info",
    queue,
    "--config",
    config,
  ]);
  return parseQueueConsumer(output);
}

async function assertBillingReadiness(apiDomain) {
  const response = await fetch(`https://${apiDomain}/health/billing`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Billing readiness returned HTTP ${response.status}`);
  const payload = await response.json();
  if (
    payload?.ready_for_traffic !== true ||
    payload?.execution !== "private-service-binding"
  ) {
    throw new Error("Billing is not ready for direct queue consumption");
  }
}

function configPath(target, service, environment) {
  return resolve(
    root,
    "deploy",
    "generated",
    `${target}-${service}-${environment}.jsonc`,
  );
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  return `${result.stdout}\n${result.stderr}`;
}

function run(command, commandArgs) {
  execFileSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, NO_COLOR: "1" },
    stdio: "inherit",
  });
}

function tryRun(command, commandArgs) {
  try {
    run(command, commandArgs);
  } catch (error) {
    console.error(`Recovery command failed: ${message(error)}`);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) await main();
