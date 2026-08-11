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
import { buildSecretBundlePlan } from "./cloudflare-secret-bundle.mjs";
import { promotionArgs } from "./cloudflare-secret-promote.mjs";

const MAX_RECEIPT_BYTES = 1024 * 1024;
const DEFAULT_MINIMUM_OVERLAP_MINUTES = 30;

export function buildSecretRetirementPlan({
  target,
  targetName,
  environment,
  receipt,
  minimumOverlapMinutes = DEFAULT_MINIMUM_OVERLAP_MINUTES,
  now = new Date(),
}) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error("Secret promotion receipt must be a JSON object");
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.mode !== "secret-bundle-promotion-complete" ||
    receipt.valuesIncluded !== false ||
    receipt.overlap !== true
  ) {
    throw new Error("A completed overlap promotion receipt is required");
  }
  if (receipt.target !== targetName || receipt.environment !== environment) {
    throw new Error("Secret promotion receipt target/environment mismatch");
  }
  if (
    !Number.isSafeInteger(minimumOverlapMinutes) ||
    minimumOverlapMinutes < DEFAULT_MINIMUM_OVERLAP_MINUTES ||
    minimumOverlapMinutes > 7 * 24 * 60
  ) {
    throw new Error(
      "Minimum overlap must be an integer from 30 to 10080 minutes",
    );
  }
  const nowDate = now instanceof Date ? now : new Date(now);
  const promotedAt = new Date(receipt.promotedAt);
  if (
    Number.isNaN(nowDate.getTime()) ||
    Number.isNaN(promotedAt.getTime()) ||
    promotedAt.toISOString() !== receipt.promotedAt ||
    promotedAt.getTime() > nowDate.getTime()
  ) {
    throw new Error(
      "Secret promotion receipt has an invalid promotedAt timestamp",
    );
  }
  if (!/^[a-f0-9]{12}$/u.test(receipt.cloudflareAccountFingerprint ?? "")) {
    throw new Error(
      "Secret promotion receipt has an invalid account fingerprint",
    );
  }
  const bundlePlan = buildSecretBundlePlan({
    target,
    targetName,
    environment,
    contractIds: receipt.contracts,
    externalPeersReady: receipt.externalPeersReady === true,
    overlap: true,
  });
  if (bundlePlan.blockers.length) {
    throw new Error("Secret promotion receipt reconstructs a blocked bundle");
  }
  if (receipt.bundleConfirmation !== bundlePlan.confirmation) {
    throw new Error("Secret promotion receipt does not match its bundle plan");
  }
  const expectedServices = new Set(
    bundlePlan.contracts.flatMap(({ members }) =>
      members.map(({ service }) => service),
    ),
  );
  if (!Array.isArray(receipt.workers) || receipt.workers.length === 0) {
    throw new Error("Secret promotion receipt has no promoted Workers");
  }
  const promotedByService = new Map();
  for (const worker of receipt.workers) {
    if (
      !worker ||
      typeof worker !== "object" ||
      promotedByService.has(worker.service) ||
      worker.worker !==
        workerNameForService(target, worker.service, environment) ||
      !/^[0-9a-f-]{36}$/iu.test(worker.versionId ?? "")
    ) {
      throw new Error("Secret promotion receipt contains an invalid Worker");
    }
    promotedByService.set(worker.service, { ...worker });
  }
  if (
    promotedByService.size !== expectedServices.size ||
    [...expectedServices].some((service) => !promotedByService.has(service))
  ) {
    throw new Error("Secret promotion receipt Worker set is incomplete");
  }
  const previousByService = new Map();
  for (const contract of bundlePlan.contracts) {
    for (const member of contract.members) {
      if (!member.previousName) continue;
      const entry = previousByService.get(member.service) ?? {
        service: member.service,
        worker: workerNameForService(target, member.service, environment),
        names: [],
      };
      if (entry.names.includes(member.previousName)) {
        throw new Error(
          `Previous secret binding is claimed twice: ${member.service}/${member.previousName}`,
        );
      }
      entry.names.push(member.previousName);
      previousByService.set(member.service, entry);
    }
  }
  if (previousByService.size === 0) {
    throw new Error(
      "Secret promotion receipt has no previous bindings to retire",
    );
  }
  for (const entry of previousByService.values()) {
    if (entry.names.length !== 1) {
      throw new Error(
        `${entry.service} must retire exactly one previous binding per operation`,
      );
    }
    entry.names.sort();
  }
  const eligibleAt = new Date(
    promotedAt.getTime() + minimumOverlapMinutes * 60_000,
  );
  const blockers =
    nowDate < eligibleAt
      ? [
          {
            id: "overlap-observation-window",
            action: `Wait until ${eligibleAt.toISOString()} before retiring previous secrets.`,
          },
        ]
      : [];
  const services = deploymentOrder(target)
    .filter((service) => previousByService.has(service))
    .map((service) => ({
      ...previousByService.get(service),
      names: previousByService.get(service).names.map((name) => ({
        name,
        versionTag: retirementVersionTag(
          bundlePlan.confirmation,
          service,
          name,
        ),
      })),
    }));
  return {
    schemaVersion: 1,
    mode: "secret-overlap-retirement-plan",
    target: targetName,
    environment,
    valuesIncluded: false,
    bundleConfirmation: bundlePlan.confirmation,
    cloudflareAccountFingerprint: receipt.cloudflareAccountFingerprint,
    contracts: bundlePlan.contracts.map(({ id }) => id),
    promotedAt: promotedAt.toISOString(),
    minimumOverlapMinutes,
    eligibleAt: eligibleAt.toISOString(),
    promotedWorkers: [...promotedByService.values()],
    services,
    blockers,
  };
}

export function attachRetirementRemoteState(plan, remoteState, accountId) {
  if (!/^[a-f0-9]{32}$/iu.test(accountId ?? "")) {
    throw new Error("Cloudflare account id is missing or invalid");
  }
  const fingerprint = createHash("sha256")
    .update(accountId.toLowerCase())
    .digest("hex")
    .slice(0, 12);
  if (fingerprint !== plan.cloudflareAccountFingerprint) {
    throw new Error(
      "Secret promotion receipt belongs to another Cloudflare account",
    );
  }
  const activeByService = new Map();
  for (const promoted of plan.promotedWorkers) {
    const deployed = remoteState[promoted.service]?.deployment?.versions;
    if (
      !Array.isArray(deployed) ||
      deployed.length !== 1 ||
      deployed[0]?.percentage !== 100 ||
      deployed[0]?.version_id !== promoted.versionId
    ) {
      throw new Error(
        `${promoted.worker} no longer runs the exact promoted overlap version`,
      );
    }
    activeByService.set(promoted.service, deployed[0].version_id);
  }
  const services = plan.services.map((service) => {
    const versions = remoteState[service.service]?.versions;
    if (!Array.isArray(versions)) {
      throw new Error(`${service.worker} version list is unavailable`);
    }
    return {
      ...service,
      rollbackVersionId: activeByService.get(service.service),
      names: service.names.map((entry) => {
        const tagged = versions.find(
          (version) =>
            version.annotations?.["workers/tag"] === entry.versionTag,
        );
        if (tagged && !/^[0-9a-f-]{36}$/iu.test(tagged.id ?? "")) {
          throw new Error(
            `${service.worker} has an invalid retirement version`,
          );
        }
        return {
          ...entry,
          strategy: tagged
            ? "reuse-inactive-version"
            : "create-inactive-version",
          versionId: tagged?.id ?? null,
        };
      }),
    };
  });
  const remotePlan = { ...plan, services };
  return {
    ...remotePlan,
    confirmation: retirementConfirmation(remotePlan),
  };
}

export function retirementVersionTag(bundleConfirmation, service, name) {
  const digest = bundleConfirmation.split(":").at(-1);
  if (!/^[a-f0-9]{12}$/u.test(digest ?? "")) {
    throw new Error("Bundle confirmation has an invalid digest");
  }
  if (!/^[a-z][a-z0-9-]{1,30}$/u.test(service)) {
    throw new Error(`Invalid service for retirement tag: ${service}`);
  }
  if (!/^[A-Z][A-Z0-9_]+$/u.test(name)) {
    throw new Error(`Invalid previous secret binding: ${name}`);
  }
  const nameDigest = createHash("sha256")
    .update(name)
    .digest("hex")
    .slice(0, 6);
  return `opengrow-retire-${digest}-${service}-${nameDigest}`;
}

export function retirementConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: plan.schemaVersion,
        target: plan.target,
        environment: plan.environment,
        bundleConfirmation: plan.bundleConfirmation,
        cloudflareAccountFingerprint: plan.cloudflareAccountFingerprint,
        contracts: plan.contracts,
        promotedAt: plan.promotedAt,
        minimumOverlapMinutes: plan.minimumOverlapMinutes,
        eligibleAt: plan.eligibleAt,
        promotedWorkers: plan.promotedWorkers,
        services: plan.services,
        blockers: plan.blockers,
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:SECRET-RETIRE:${plan.target}:${plan.environment}:${digest}`;
}

export function retirementDeleteArgs(service, entry, message) {
  return [
    "wrangler",
    "versions",
    "secret",
    "delete",
    entry.name,
    "--name",
    service.worker,
    "--message",
    message,
    "--tag",
    entry.versionTag,
  ];
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const receipt = readReceipt(args.receipt);
  const minimumOverlapMinutes =
    args["minimum-overlap-minutes"] == null
      ? DEFAULT_MINIMUM_OVERLAP_MINUTES
      : Number(args["minimum-overlap-minutes"]);
  const structuralPlan = buildSecretRetirementPlan({
    target,
    targetName,
    environment,
    receipt,
    minimumOverlapMinutes,
  });
  const childEnv = cloudflareEnv(target);
  const retirementServices = new Set(
    structuralPlan.services.map(({ service }) => service),
  );
  const remoteState = Object.fromEntries(
    structuralPlan.promotedWorkers.map((worker) => [
      worker.service,
      {
        deployment: runJson(
          "npx",
          [
            "wrangler",
            "deployments",
            "status",
            "--name",
            worker.worker,
            "--json",
          ],
          childEnv,
          `${worker.worker} deployment status`,
        ),
        versions: retirementServices.has(worker.service)
          ? runJson(
              "npx",
              [
                "wrangler",
                "versions",
                "list",
                "--name",
                worker.worker,
                "--json",
              ],
              childEnv,
              `${worker.worker} version list`,
            )
          : [],
      },
    ]),
  );
  const plan = attachRetirementRemoteState(
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
      `Refusing previous-secret retirement: pass --confirm ${plan.confirmation}`,
    );
  }
  if (plan.blockers.length) {
    throw new Error(
      "Refusing previous-secret retirement while blockers remain",
    );
  }
  const changed = [];
  const completed = [];
  try {
    for (const service of plan.services) {
      let finalVersionId = service.rollbackVersionId;
      for (const entry of service.names) {
        let versionId = entry.versionId;
        if (!versionId) {
          run(
            "npx",
            retirementDeleteArgs(
              service,
              entry,
              `OpenGrow previous-secret retirement ${plan.bundleConfirmation}`,
            ),
            childEnv,
            `${service.worker} inactive retirement version`,
          );
          const versions = runJson(
            "npx",
            [
              "wrangler",
              "versions",
              "list",
              "--name",
              service.worker,
              "--json",
            ],
            childEnv,
            `${service.worker} retirement version lookup`,
          );
          const tagged = versions.find(
            (version) =>
              version.annotations?.["workers/tag"] === entry.versionTag,
          );
          if (!tagged || !/^[0-9a-f-]{36}$/iu.test(tagged.id ?? "")) {
            throw new Error(
              `${service.worker} did not create ${entry.versionTag}`,
            );
          }
          versionId = tagged.id;
        }
        run(
          "npx",
          promotionArgs(
            service,
            versionId,
            `OpenGrow activate previous-secret retirement ${plan.bundleConfirmation}`,
          ),
          childEnv,
          `${service.worker} retirement promotion`,
        );
        finalVersionId = versionId;
        if (!changed.some(({ service: name }) => name === service.service)) {
          changed.push(service);
        }
      }
      completed.push({
        service: service.service,
        worker: service.worker,
        retiredNames: service.names.map(({ name }) => name),
        versionId: finalVersionId,
      });
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const service of [...changed].reverse()) {
      try {
        run(
          "npx",
          promotionArgs(
            service,
            service.rollbackVersionId,
            `OpenGrow automatic retirement rollback ${plan.bundleConfirmation}`,
          ),
          childEnv,
          `${service.worker} retirement rollback`,
        );
      } catch {
        rollbackFailures.push(service.worker);
      }
    }
    if (rollbackFailures.length) {
      throw new Error(
        `Previous-secret retirement failed and rollback also failed for: ${rollbackFailures.join(", ")}`,
        { cause: error },
      );
    }
    throw new Error(
      "Previous-secret retirement failed; every changed Worker was rolled back",
      { cause: error },
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: 1,
        mode: "secret-overlap-retirement-complete",
        target: targetName,
        environment,
        valuesIncluded: false,
        bundleConfirmation: plan.bundleConfirmation,
        retiredAt: new Date().toISOString(),
        workers: completed,
        nextAction:
          "Run secret preflight and all affected Worker health checks.",
      },
      null,
      2,
    )}\n`,
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
        "Pipe the non-secret promotion receipt or pass --receipt",
      );
    }
    source = readFileSync(0);
  }
  if (source.byteLength === 0 || source.byteLength > MAX_RECEIPT_BYTES) {
    throw new Error("Secret promotion receipt is empty or too large");
  }
  try {
    return JSON.parse(source.toString("utf8"));
  } catch {
    throw new Error("Secret promotion receipt is not valid JSON");
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
