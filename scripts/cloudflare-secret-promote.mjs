#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import { workerNameForService } from "./cloudflare-services.mjs";
import {
  buildSecretBundlePlan,
  secretVersionTag,
} from "./cloudflare-secret-bundle.mjs";

const MAX_RECEIPT_BYTES = 1024 * 1024;

export function validateSecretUploadReceipt({
  target,
  targetName,
  environment,
  receipt,
  acceptSharedCutover = false,
}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Secret upload receipt must be a JSON object");
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.mode !== "inactive-secret-bundle-upload" ||
    receipt.valuesIncluded !== false
  ) {
    throw new Error("Unsupported or unsafe secret upload receipt");
  }
  if (receipt.target !== targetName || receipt.environment !== environment) {
    throw new Error("Secret upload receipt target/environment mismatch");
  }
  const bundlePlan = buildSecretBundlePlan({
    target,
    targetName,
    environment,
    contractIds: receipt.contracts,
    externalPeersReady: receipt.externalPeersReady === true,
    overlap: receipt.overlap === true,
  });
  if (bundlePlan.confirmation !== receipt.planConfirmation) {
    throw new Error("Secret upload receipt does not match its value-free plan");
  }
  if (bundlePlan.blockers.length) {
    throw new Error("Secret upload receipt still has unresolved blockers");
  }
  if (!Array.isArray(receipt.services) || receipt.services.length === 0) {
    throw new Error("Secret upload receipt has no Worker versions");
  }
  const expectedServices = new Set(
    bundlePlan.contracts.flatMap(({ members }) =>
      members.map(({ service }) => service),
    ),
  );
  const actualServices = new Set(
    receipt.services.map(({ service }) => service),
  );
  if (
    actualServices.size !== receipt.services.length ||
    [...expectedServices].some((service) => !actualServices.has(service)) ||
    [...actualServices].some((service) => !expectedServices.has(service))
  ) {
    throw new Error(
      "Secret upload receipt Worker set is incomplete or duplicated",
    );
  }
  const receiptByService = new Map();
  for (const entry of receipt.services) {
    const expectedWorker = workerNameForService(
      target,
      entry.service,
      environment,
    );
    if (!expectedWorker || entry.worker !== expectedWorker) {
      throw new Error(
        `Secret upload receipt Worker mismatch for ${entry.service}`,
      );
    }
    if (
      entry.strategy !== "inactive-version" ||
      entry.versionTag !== secretVersionTag(bundlePlan, entry.service)
    ) {
      throw new Error(
        `Secret upload receipt version mismatch for ${entry.service}`,
      );
    }
    if (
      !Array.isArray(entry.names) ||
      entry.names.length === 0 ||
      new Set(entry.names).size !== entry.names.length ||
      entry.names.some((name) => !/^[A-Z][A-Z0-9_]+$/.test(name))
    ) {
      throw new Error(
        `Secret upload receipt names are invalid for ${entry.service}`,
      );
    }
    const remainingNames = new Set(entry.names);
    const expectedMembers = bundlePlan.contracts
      .flatMap(({ members }) => members)
      .filter((member) => member.service === entry.service);
    for (const member of expectedMembers) {
      if (member.name) {
        if (!remainingNames.delete(member.name)) {
          throw new Error(
            `Secret upload receipt names are incomplete for ${entry.service}`,
          );
        }
      } else {
        const selected = member.oneOf.filter((name) =>
          remainingNames.has(name),
        );
        if (selected.length !== 1) {
          throw new Error(
            `Secret upload receipt must select one allowed name for ${entry.service}`,
          );
        }
        remainingNames.delete(selected[0]);
      }
      if (bundlePlan.overlap && member.previousName) {
        if (!remainingNames.delete(member.previousName)) {
          throw new Error(
            `Secret upload receipt overlap name is missing for ${entry.service}`,
          );
        }
      }
    }
    if (remainingNames.size) {
      throw new Error(
        `Secret upload receipt contains unexpected names for ${entry.service}`,
      );
    }
    receiptByService.set(entry.service, entry);
  }
  const sharedContracts = bundlePlan.contracts
    .filter(
      ({ sameValueRequired, members }) =>
        sameValueRequired &&
        new Set(members.map(({ service }) => service)).size > 1 &&
        !(
          bundlePlan.overlap && members.some(({ previousName }) => previousName)
        ),
    )
    .map(({ id }) => id);
  const blockers =
    sharedContracts.length && !acceptSharedCutover
      ? [
          {
            id: "shared-secret-non-atomic-cutover",
            contracts: sharedContracts,
            action:
              "Use an approved maintenance/bootstrap window and pass --accept-shared-cutover; Cloudflare cannot atomically promote different Workers.",
          },
        ]
      : [];
  const services = deploymentOrder(target)
    .filter((service) => receiptByService.has(service))
    .map((service) => ({ ...receiptByService.get(service) }));
  blockers.push(...overlapOrderBlockers(bundlePlan, services));
  return {
    schemaVersion: 1,
    mode: "secret-bundle-promotion-plan",
    target: targetName,
    environment,
    valuesIncluded: false,
    bundleConfirmation: bundlePlan.confirmation,
    contracts: bundlePlan.contracts.map(({ id }) => id),
    externalPeersReady: receipt.externalPeersReady === true,
    overlap: bundlePlan.overlap,
    acceptSharedCutover,
    services,
    blockers,
  };
}

export function overlapOrderBlockers(bundlePlan, services) {
  if (!bundlePlan.overlap) return [];
  const blockers = [];
  const serviceIndex = new Map(
    services.map(({ service }, index) => [service, index]),
  );
  for (const contract of bundlePlan.contracts) {
    const consumers = contract.members.filter(
      ({ previousName }) => previousName,
    );
    if (consumers.length === 0) continue;
    const producers = contract.members.filter(
      ({ previousName }) => !previousName,
    );
    const latestConsumer = Math.max(
      ...consumers.map(({ service }) => serviceIndex.get(service) ?? Infinity),
    );
    const earliestProducer = Math.min(
      ...producers.map(({ service }) => serviceIndex.get(service) ?? -Infinity),
    );
    if (latestConsumer >= earliestProducer) {
      blockers.push({
        id: "overlap-promotion-order-unsafe",
        contract: contract.id,
        action:
          "Deploy every current+previous consumer before any new-token-only producer.",
      });
    }
  }
  return blockers;
}

export function attachPromotionRemoteState(plan, remoteState, accountId) {
  if (!/^[a-f0-9]{32}$/i.test(accountId ?? "")) {
    throw new Error("Cloudflare account id is missing or invalid");
  }
  const services = plan.services.map((service) => {
    const state = remoteState[service.service];
    const deployed = state?.deployment?.versions;
    if (
      !Array.isArray(deployed) ||
      deployed.length !== 1 ||
      deployed[0]?.percentage !== 100 ||
      !/^[0-9a-f-]{36}$/i.test(deployed[0]?.version_id ?? "")
    ) {
      throw new Error(
        `${service.worker} must have exactly one 100% active rollback version`,
      );
    }
    const tagged = state?.versions?.find(
      (version) => version.annotations?.["workers/tag"] === service.versionTag,
    );
    if (!tagged || !/^[0-9a-f-]{36}$/i.test(tagged.id ?? "")) {
      throw new Error(
        `${service.worker} does not contain inactive tag ${service.versionTag}`,
      );
    }
    if (tagged.id === deployed[0].version_id) {
      throw new Error(`${service.worker} secret version is already active`);
    }
    return {
      ...service,
      versionId: tagged.id,
      rollbackVersionId: deployed[0].version_id,
    };
  });
  const remotePlan = {
    ...plan,
    cloudflareAccountFingerprint: createHash("sha256")
      .update(accountId.toLowerCase())
      .digest("hex")
      .slice(0, 12),
    services,
  };
  return {
    ...remotePlan,
    confirmation: promotionConfirmation(remotePlan),
  };
}

export function promotionConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: plan.schemaVersion,
        target: plan.target,
        environment: plan.environment,
        bundleConfirmation: plan.bundleConfirmation,
        contracts: plan.contracts,
        overlap: plan.overlap,
        acceptSharedCutover: plan.acceptSharedCutover,
        cloudflareAccountFingerprint: plan.cloudflareAccountFingerprint,
        services: plan.services,
        blockers: plan.blockers,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:SECRET-PROMOTE:${plan.target}:${plan.environment}:${digest}`;
}

export function promotionArgs(service, versionId, message) {
  return [
    "wrangler",
    "versions",
    "deploy",
    "--name",
    service.worker,
    "--version-id",
    versionId,
    "--percentage",
    "100",
    "--message",
    message,
    "--yes",
  ];
}

export function buildPromotionCompleteReceipt(
  plan,
  promoted,
  promotedAt = new Date(),
) {
  const timestamp =
    promotedAt instanceof Date
      ? promotedAt.toISOString()
      : new Date(promotedAt).toISOString();
  return {
    schemaVersion: 1,
    mode: "secret-bundle-promotion-complete",
    target: plan.target,
    environment: plan.environment,
    valuesIncluded: false,
    bundleConfirmation: plan.bundleConfirmation,
    cloudflareAccountFingerprint: plan.cloudflareAccountFingerprint,
    externalPeersReady: plan.externalPeersReady === true,
    overlap: plan.overlap === true,
    contracts: [...plan.contracts],
    promotedAt: timestamp,
    workers: promoted.map(({ service, worker, versionId }) => ({
      service,
      worker,
      versionId,
    })),
    nextAction: plan.overlap
      ? "After the overlap observation window, retire every *_PREVIOUS binding with cloudflare:secrets:retire."
      : "Run the secret preflight and service health checks.",
  };
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const receipt = readReceipt(args.receipt);
  const structuralPlan = validateSecretUploadReceipt({
    target,
    targetName,
    environment,
    receipt,
    acceptSharedCutover: Boolean(args["accept-shared-cutover"]),
  });
  const childEnv = cloudflareEnv(target);
  const remoteState = Object.fromEntries(
    structuralPlan.services.map((service) => [
      service.service,
      {
        deployment: runJson(
          "npx",
          [
            "wrangler",
            "deployments",
            "status",
            "--name",
            service.worker,
            "--json",
          ],
          childEnv,
          `${service.worker} deployment status`,
        ),
        versions: runJson(
          "npx",
          ["wrangler", "versions", "list", "--name", service.worker, "--json"],
          childEnv,
          `${service.worker} version list`,
        ),
      },
    ]),
  );
  const plan = attachPromotionRemoteState(
    structuralPlan,
    remoteState,
    childEnv.CLOUDFLARE_ACCOUNT_ID,
  );
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.blockers.length) process.exitCode = 2;
    return;
  }
  if (args.confirm !== plan.confirmation) {
    throw new Error(
      `Refusing secret promotion: pass --confirm ${plan.confirmation}`,
    );
  }
  if (plan.blockers.length) {
    throw new Error("Refusing secret promotion while blockers remain");
  }
  const promoted = [];
  try {
    for (const service of plan.services) {
      run(
        "npx",
        promotionArgs(
          service,
          service.versionId,
          `OpenGrow coordinated secret promotion ${plan.bundleConfirmation}`,
        ),
        childEnv,
        `${service.worker} promotion`,
      );
      promoted.push(service);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const service of [...promoted].reverse()) {
      try {
        run(
          "npx",
          promotionArgs(
            service,
            service.rollbackVersionId,
            `OpenGrow automatic rollback ${plan.bundleConfirmation}`,
          ),
          childEnv,
          `${service.worker} rollback`,
        );
      } catch {
        rollbackFailures.push(service.worker);
      }
    }
    if (rollbackFailures.length) {
      throw new Error(
        `Secret promotion failed and automatic rollback also failed for: ${rollbackFailures.join(", ")}`,
        { cause: error },
      );
    }
    throw new Error(
      "Secret promotion failed; every changed Worker was rolled back",
      {
        cause: error,
      },
    );
  }
  process.stdout.write(
    `${JSON.stringify(buildPromotionCompleteReceipt(plan, promoted), null, 2)}\n`,
  );
}

function readReceipt(receiptPath) {
  let source;
  if (receiptPath) {
    if (!isAbsolute(receiptPath)) {
      throw new Error(
        "--receipt must be an absolute path outside the checkout",
      );
    }
    const absolute = resolve(receiptPath);
    if (absolute === root || absolute.startsWith(`${root}/`)) {
      throw new Error("--receipt must be outside the Git checkout");
    }
    source = readFileSync(absolute);
  } else {
    if (process.stdin.isTTY) {
      throw new Error(
        "Pipe the non-secret upload receipt on stdin or pass --receipt",
      );
    }
    source = readFileSync(0);
  }
  if (source.byteLength === 0 || source.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("Secret upload receipt is empty or too large");
  }
  try {
    return JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Secret upload receipt is not valid JSON");
  }
}

function runJson(command, commandArgs, env, label) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${label} failed`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function run(command, commandArgs, env, label) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${label} failed`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
