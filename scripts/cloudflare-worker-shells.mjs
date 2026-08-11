#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { cloudflareClient } from "./cloudflare-bootstrap.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import {
  managedWorkerDefinition,
  workerNameForService,
} from "./cloudflare-services.mjs";
import {
  resourceIdentity,
  resourceNameContract,
} from "./cloudflare-resource-identity.mjs";
import {
  cloudflareAccountId,
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

const WORKER_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function buildWorkerShellPlan({
  target,
  environment,
  accountId,
  existingWorkerNames,
}) {
  const existing = new Set(existingWorkerNames.map((name) => String(name)));
  const workers = deploymentOrder(target).map((service) => {
    const name = String(
      workerNameForService(target, service, environment) ?? "",
    );
    if (!WORKER_NAME.test(name)) {
      throw new Error(`Invalid Worker name for ${service}/${environment}`);
    }
    return {
      service,
      name,
      ...resourceNameContract(target, name, {
        allowLegacyName: Boolean(managedWorkerDefinition(target, service)),
      }),
      state: existing.has(name) ? "existing" : "create-private-shell",
    };
  });
  if (new Set(workers.map(({ name }) => name)).size !== workers.length) {
    throw new Error(`Worker names must be unique in ${environment}`);
  }
  const plan = {
    schemaVersion: 1,
    mode: "remote-read-only",
    target: target.target,
    resourceIdentity: resourceIdentity(target),
    accountAlias: target.accountAlias,
    accountFingerprint: createHash("sha256")
      .update(accountId)
      .digest("hex")
      .slice(0, 12),
    environment,
    ready: workers.every(({ state }) => state === "existing"),
    workers,
  };
  return { ...plan, confirmation: workerShellConfirmation(plan) };
}

export function workerShellConfirmation(plan) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: plan.schemaVersion,
        target: plan.target,
        accountAlias: plan.accountAlias,
        accountFingerprint: plan.accountFingerprint,
        environment: plan.environment,
        workers: plan.workers.filter(({ state }) => state !== "existing"),
      }),
    )
    .digest("hex")
    .slice(0, 12);
  return `CLOUDFLARE:WORKER-SHELLS:${plan.target}:${plan.environment}:${digest}`;
}

export async function applyWorkerShellPlan(plan, { confirm, create }) {
  const expected = workerShellConfirmation(plan);
  if (confirm !== expected) {
    throw new Error(
      `Refusing Worker shell bootstrap: pass --confirm ${expected}`,
    );
  }
  if (typeof create !== "function") {
    throw new Error("Worker shell create adapter is required");
  }
  const applied = [];
  for (const worker of plan.workers.filter(
    ({ state }) => state !== "existing",
  )) {
    await create(worker);
    applied.push({
      service: worker.service,
      name: worker.name,
      state: "created-private-shell",
    });
  }
  return applied;
}

async function listWorkerNames(client) {
  const scripts = await client.listPaged("/workers/scripts");
  return scripts
    .map((script) => String(script?.id ?? script?.name ?? ""))
    .filter(Boolean);
}

export function parseWranglerWorkerInspection(workerName, result) {
  if (result.status === 0) return workerName;
  const output = String(result.stderr || result.stdout || "");
  if (/does not exist on your account/u.test(output) && /10007/u.test(output)) {
    return null;
  }
  throw new Error(
    `Unable to inspect Worker ${workerName} with Wrangler: ${output.trim() || `exit ${result.status}`}`,
  );
}

async function listExpectedWorkerNamesWithWrangler(
  target,
  environment,
  execute = spawnSync,
) {
  const env = cloudflareEnv(target);
  const existing = [];
  for (const service of deploymentOrder(target)) {
    const workerName = workerNameForService(target, service, environment);
    const result = execute(
      "npx",
      ["wrangler", "deployments", "list", "--name", workerName, "--json"],
      {
        cwd: root,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    const inspected = parseWranglerWorkerInspection(workerName, result);
    if (inspected) existing.push(inspected);
  }
  return existing;
}

async function createPrivateWorkerShell(worker, target) {
  const directory = await mkdtemp(join(tmpdir(), "opengrow-worker-shell-"));
  const sourcePath = join(directory, "index.mjs");
  const configPath = join(directory, "wrangler.jsonc");
  try {
    await writeFile(
      sourcePath,
      `export default { fetch() { return Response.json({ service: ${JSON.stringify(worker.name)}, status: "bootstrap" }, { status: 503, headers: { "cache-control": "no-store" } }); } };\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          name: worker.name,
          main: "index.mjs",
          compatibility_date: new Date().toISOString().slice(0, 10),
          workers_dev: false,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    const result = spawnSync(
      "npx",
      ["wrangler", "deploy", "--config", configPath],
      {
        cwd: root,
        env: cloudflareEnv(target),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    if (result.status !== 0) {
      throw new Error(
        `Unable to create private Worker shell ${worker.name}: ${String(result.stderr || result.stdout || "").trim()}`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const accountId = cloudflareAccountId(target);
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const client = token ? cloudflareClient({ accountId, token }) : null;
  const inspect = () =>
    client
      ? listWorkerNames(client)
      : listExpectedWorkerNamesWithWrangler(target, environment);
  const plan = buildWorkerShellPlan({
    target,
    environment,
    accountId,
    existingWorkerNames: await inspect(),
  });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  if (!args.apply) {
    if (!plan.ready) process.exitCode = 2;
    return;
  }
  const applied = await applyWorkerShellPlan(plan, {
    confirm: typeof args.confirm === "string" ? args.confirm : null,
    create: (worker) => createPrivateWorkerShell(worker, target),
  });
  const verified = buildWorkerShellPlan({
    target,
    environment,
    accountId,
    existingWorkerNames: await inspect(),
  });
  if (!verified.ready) {
    throw new Error(
      "Worker shell bootstrap did not create every required Worker",
    );
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: "applied",
        target: targetName,
        environment,
        applied,
        verified: true,
      },
      null,
      2,
    )}\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
