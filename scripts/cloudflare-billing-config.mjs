import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  loadTarget,
  parseArgs,
  root,
  targetSelectionFromArgs,
} from "./cloudflare-target.mjs";

const consumerDefaults = {
  max_batch_size: 10,
  max_batch_timeout: 5,
  max_retries: 8,
};

export function assertBillingConfigOwnership({
  apiConfig,
  billingConfig,
  mode,
  resources,
}) {
  if (!new Set(["local", "service"]).has(mode)) {
    throw new Error(`Unsupported Billing execution mode: ${mode}`);
  }
  assertProducer(apiConfig, resources.queues.billing, "API");
  assertProducer(billingConfig, resources.queues.billing, "Billing");
  if (
    billingConfig.vars?.BILLING_QUEUE_NAME !== resources.queues.billing ||
    billingConfig.vars?.BILLING_DLQ_NAME !== resources.queues.billingDlq
  ) {
    throw new Error("Billing queue names must be available to the runtime");
  }

  const consumers = [
    ...billingConsumers(apiConfig, resources.queues.billing).map(
      (consumer) => ({ owner: "api", consumer }),
    ),
    ...billingConsumers(billingConfig, resources.queues.billing).map(
      (consumer) => ({ owner: "billing", consumer }),
    ),
  ];
  if (consumers.length !== 1) {
    throw new Error(
      `Billing queue must have exactly one generated consumer; found ${consumers.length}`,
    );
  }
  const expectedOwner = mode === "service" ? "billing" : "api";
  if (consumers[0].owner !== expectedOwner) {
    throw new Error(
      `Billing queue consumer must be owned by ${expectedOwner} in ${mode} mode`,
    );
  }
  const expectedConsumer = {
    queue: resources.queues.billing,
    dead_letter_queue: resources.queues.billingDlq,
    ...consumerDefaults,
  };
  for (const [key, value] of Object.entries(expectedConsumer)) {
    if (consumers[0].consumer[key] !== value) {
      throw new Error(`Billing queue consumer has an invalid ${key}`);
    }
  }

  const billingCrons = billingConfig.triggers?.crons ?? [];
  if (mode === "service" && !billingCrons.includes("*/10 * * * *")) {
    throw new Error(
      "Billing Worker must own scheduled reconciliation in service mode",
    );
  }
  if (mode === "local" && billingCrons.length > 0) {
    throw new Error(
      "Billing Worker must not schedule reconciliation in local mode",
    );
  }

  const deadLetterConsumers = [
    ...billingConsumers(apiConfig, resources.queues.billingDlq).map(
      (consumer) => ({ owner: "api", consumer }),
    ),
    ...billingConsumers(billingConfig, resources.queues.billingDlq).map(
      (consumer) => ({ owner: "billing", consumer }),
    ),
  ];
  if (
    deadLetterConsumers.length !== 1 ||
    deadLetterConsumers[0].owner !== "billing"
  ) {
    throw new Error(
      "Billing Worker must be the only generated Billing DLQ consumer",
    );
  }
  const deadLetterConsumer = deadLetterConsumers[0].consumer;
  if (
    deadLetterConsumer.dead_letter_queue != null ||
    deadLetterConsumer.max_batch_size !== 10 ||
    deadLetterConsumer.max_batch_timeout !== 5 ||
    deadLetterConsumer.max_retries !== 8
  ) {
    throw new Error("Billing DLQ consumer configuration is invalid");
  }
}

async function main() {
  const args = parseArgs();
  const { targetName, environment } = await targetSelectionFromArgs(args, process.env, { allowReference: true });
  const { target } = await loadTarget(targetName);
  const resources = target.environments[environment];
  if (!resources)
    throw new Error(
      `${targetName} does not define a ${environment} environment`,
    );

  for (const service of ["api", "billing"]) {
    execFileSync(
      process.execPath,
      [
        resolve(root, "scripts", "cloudflare-config.mjs"),
        "--target",
        targetName,
        "--service",
        service,
        "--environment",
        environment,
        ...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
        ...(args["no-routes"] ? ["--no-routes"] : []),
      ],
      { cwd: root, env: process.env, stdio: "inherit" },
    );
  }

  const [apiConfig, billingConfig] = await Promise.all([
    readGenerated(targetName, "api", environment),
    readGenerated(targetName, "billing", environment),
  ]);
  assertBillingConfigOwnership({
    apiConfig,
    billingConfig,
    mode: resources.billingExecutionMode,
    resources,
  });
  console.log(
    `Billing queue ownership verified for ${targetName}/${environment}: ${resources.billingExecutionMode}`,
  );
}

function assertProducer(config, queue, label) {
  const producer = (config.queues?.producers ?? []).find(
    (entry) => entry.binding === "BILLING_QUEUE" && entry.queue === queue,
  );
  if (!producer)
    throw new Error(
      `${label} configuration must bind the Billing queue producer`,
    );
}

function billingConsumers(config, queue) {
  return (config.queues?.consumers ?? []).filter(
    (consumer) => consumer.queue === queue,
  );
}

async function readGenerated(target, service, environment) {
  const path = resolve(
    root,
    "deploy",
    "generated",
    `${target}-${service}-${environment}.jsonc`,
  );
  return JSON.parse(await readFile(path, "utf8"));
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (import.meta.url === entrypoint) await main();
