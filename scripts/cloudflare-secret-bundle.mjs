#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { secretCoordinationPlan } from "./cloudflare-secret-inventory.mjs";

const MAX_SECRET_BYTES = 128 * 1024;

export function buildSecretBundlePlan({
  target,
  targetName,
  environment,
  contractIds,
  externalPeersReady = false,
  overlap = false,
}) {
  if (!Array.isArray(contractIds) || contractIds.length === 0) {
    throw new Error("--contracts must select at least one secret contract");
  }
  const uniqueIds = [...new Set(contractIds)];
  if (uniqueIds.length !== contractIds.length) {
    throw new Error("--contracts contains duplicate contract ids");
  }
  const coordination = secretCoordinationPlan(target, environment);
  const byId = new Map(
    coordination.contracts.map((contract) => [contract.id, contract]),
  );
  const selected = uniqueIds.map((id) => {
    const contract = byId.get(id);
    if (!contract) throw new Error(`Unknown secret contract: ${id}`);
    return contract;
  });
  const blockers = [];
  if (overlap && !selected.some((contract) =>
    contract.members.some((member) => member.previousName)
  )) {
    blockers.push({
      id: "overlap-not-applicable",
      action: "Select at least one overlap-capable shared token contract.",
    });
  }
  if (selected.some(({ id }) => id === "dashboard-client-secret")) {
    blockers.push({
      id: "dashboard-oauth-pairing",
      action: "Use cloudflare:rotate-oauth after migration 0056 is applied.",
    });
  }
  for (const contract of selected) {
    if (contract.externalPeers?.length && !externalPeersReady) {
      blockers.push({
        id: `${contract.id}.external-peers`,
        action: `Confirm coordinated rotation for: ${contract.externalPeers.join(", ")}.`,
      });
    }
  }
  const plan = {
    schemaVersion: 1,
    mode: "value-free-secret-bundle-plan",
    target: targetName,
    environment,
    valuesIncluded: false,
    externalPeersReady,
    overlap,
    contracts: selected.map((contract) => ({
      id: contract.id,
      scope: contract.scope,
      source: contract.source,
      sameValueRequired: contract.sameValueRequired,
      rotation: contract.rotation,
      preferredName: contract.preferredName ?? null,
      externalPeers: contract.externalPeers ?? [],
      members: contract.members.map((member) => ({
        ...member,
        worker: target.workers?.[member.service]?.[environment] ?? null,
      })),
    })),
    blockers,
  };
  return { ...plan, confirmation: secretBundleConfirmation(plan) };
}

export function secretBundleConfirmation(plan) {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      schemaVersion: plan.schemaVersion,
      target: plan.target,
      environment: plan.environment,
      externalPeersReady: plan.externalPeersReady,
      overlap: plan.overlap,
      contracts: plan.contracts,
      blockers: plan.blockers,
    }))
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:SECRET-BUNDLE:${plan.target}:${plan.environment}:${digest}`;
}

export function buildSecretAssignments(plan, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Secret bundle input must be a JSON object");
  }
  const supplied = payload.contracts;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw new Error("Secret bundle input must contain a contracts object");
  }
  const expectedIds = plan.contracts.map(({ id }) => id).sort();
  const suppliedIds = Object.keys(supplied).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(suppliedIds)) {
    throw new Error("Secret bundle input must contain exactly the planned contracts");
  }
  const assignments = {};
  for (const contract of plan.contracts) {
    const entry = supplied[contract.id];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${contract.id} must be an object with a value`);
    }
    const value = entry.value;
    if (typeof value !== "string" || Buffer.byteLength(value) === 0) {
      throw new Error(`${contract.id} has an empty or non-string value`);
    }
    if (Buffer.byteLength(value) > MAX_SECRET_BYTES) {
      throw new Error(`${contract.id} exceeds the secret size limit`);
    }
    const overlapCapable = contract.members.some(({ previousName }) =>
      Boolean(previousName)
    );
    const previousValue = entry.previousValue;
    if (plan.overlap && overlapCapable) {
      if (
        typeof previousValue !== "string" ||
        Buffer.byteLength(previousValue) === 0
      ) {
        throw new Error(`${contract.id} requires a previousValue for overlap`);
      }
      if (Buffer.byteLength(previousValue) > MAX_SECRET_BYTES) {
        throw new Error(`${contract.id} previousValue exceeds the secret size limit`);
      }
      if (previousValue === value) {
        throw new Error(`${contract.id} current and previous values must differ`);
      }
    } else if (previousValue != null) {
      throw new Error(`${contract.id} must not include a previousValue`);
    }
    const alternativeMembers = contract.members.filter(({ oneOf }) => oneOf);
    const selectedName = entry.name;
    if (alternativeMembers.length > 0) {
      if (
        typeof selectedName !== "string" ||
        !alternativeMembers.every(({ oneOf }) => oneOf.includes(selectedName))
      ) {
        throw new Error(`${contract.id} must select one allowed binding name`);
      }
    } else if (selectedName != null) {
      throw new Error(`${contract.id} must not override its binding name`);
    }
    const allowedEntryKeys = [
      ...(alternativeMembers.length > 0 ? ["name"] : []),
      "value",
      ...(plan.overlap && overlapCapable ? ["previousValue"] : []),
    ];
    if (
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(allowedEntryKeys.sort())
    ) {
      throw new Error(`${contract.id} contains unknown input fields`);
    }
    for (const member of contract.members) {
      const name = member.name ?? selectedName;
      assignments[member.service] ??= {};
      if (Object.hasOwn(assignments[member.service], name)) {
        throw new Error(`Secret binding is assigned twice: ${member.service}/${name}`);
      }
      assignments[member.service][name] = value;
      if (plan.overlap && member.previousName) {
        if (Object.hasOwn(assignments[member.service], member.previousName)) {
          throw new Error(
            `Secret binding is assigned twice: ${member.service}/${member.previousName}`,
          );
        }
        assignments[member.service][member.previousName] = previousValue;
      }
    }
  }
  return assignments;
}

export function versionedSecretBundleArgs(
  config,
  targetName,
  environment,
  service,
  tag,
) {
  return [
    "wrangler",
    "versions",
    "secret",
    "bulk",
    "--config",
    config,
    "--message",
    `OpenGrow coordinated secrets for ${targetName}/${environment}/${service}`,
    ...(tag ? ["--tag", tag] : []),
  ];
}

export function secretVersionTag(plan, service) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(service)) {
    throw new Error(`Invalid service for secret version tag: ${service}`);
  }
  const digest = plan.confirmation.split(":").at(-1);
  if (!/^[a-f0-9]{12}$/.test(digest ?? "")) {
    throw new Error("Secret bundle plan has an invalid confirmation digest");
  }
  return `opengrow-secret-${digest}-${service}`;
}

export function buildSecretUploadReceipt(plan, services) {
  return {
    schemaVersion: 1,
    mode: "inactive-secret-bundle-upload",
    target: plan.target,
    environment: plan.environment,
    valuesIncluded: false,
    planConfirmation: plan.confirmation,
    externalPeersReady: plan.externalPeersReady,
    overlap: plan.overlap,
    contracts: plan.contracts.map(({ id }) => id),
    services,
    nextAction:
      "Promote only in a separately approved release window; inactive versions do not change traffic.",
  };
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const contractIds = String(args.contracts ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const plan = buildSecretBundlePlan({
    target,
    targetName,
    environment,
    contractIds,
    externalPeersReady: Boolean(args["external-peers-ready"]),
    overlap: Boolean(args.overlap),
  });
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    if (plan.blockers.length) process.exitCode = 2;
    return;
  }
  if (args.confirm !== plan.confirmation) {
    throw new Error(
      `Refusing secret bundle upload: pass --confirm ${plan.confirmation}`,
    );
  }
  if (plan.blockers.length) {
    throw new Error("Refusing secret bundle upload while blockers remain");
  }
  if (process.stdin.isTTY) {
    throw new Error("Pipe the planned secret bundle JSON on stdin");
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    throw new Error("Secret bundle stdin is not valid JSON");
  }
  const assignments = buildSecretAssignments(plan, payload);
  const childEnv = cloudflareEnv(target);
  const receipts = [];
  for (const [service, values] of Object.entries(assignments)) {
    const config = generateConfig(targetName, environment, service, childEnv);
    const tag = secretVersionTag(plan, service);
    run("npx", versionedSecretBundleArgs(
      config,
      targetName,
      environment,
      service,
      tag,
    ), {
      env: childEnv,
      input: JSON.stringify(values),
      label: `${service} inactive secret version upload`,
    });
    receipts.push({
      service,
      worker: target.workers[service][environment],
      names: Object.keys(values).sort(),
      strategy: "inactive-version",
      versionTag: tag,
    });
  }
  process.stdout.write(
    `${JSON.stringify(buildSecretUploadReceipt(plan, receipts), null, 2)}\n`,
  );
}

function generateConfig(targetName, environment, service, env) {
  run(process.execPath, [
    resolve(root, "scripts", "cloudflare-config.mjs"),
    "--target",
    targetName,
    "--environment",
    environment,
    "--service",
    service,
    "--no-routes",
  ], { env, label: `${service} configuration generation` });
  return resolve(
    root,
    "deploy",
    "generated",
    `${targetName}-${service}-${environment}.jsonc`,
  );
}

function run(command, commandArgs, { env, input, label } = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: env ?? process.env,
    input,
    encoding: "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${label ?? command} failed`);
  return result;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
