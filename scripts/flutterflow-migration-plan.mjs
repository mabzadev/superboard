#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { loadTarget, parseArgs } from "./cloudflare-target.mjs";
import {
  flutterFlowSourceEnvironmentName,
  legacyFlutterFlowSourceEnvironmentName,
  verifyFlutterFlowSource,
} from "./flutterflow-source-verify.mjs";

const workspaceRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationSchema = readRepositoryJson(
  "schemas/flutterflow-migration-plan.schema.json",
);
const snapshotSchema = readRepositoryJson(
  "schemas/flutterflow-source-snapshot.schema.json",
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateMigration = ajv.compile(migrationSchema);
const validateSnapshot = ajv.compile(snapshotSchema);

export async function buildFlutterFlowMigrationPlan({
  manifestPath,
  sourcePath = null,
}) {
  if (!manifestPath) throw new Error("--manifest is required");
  const plan = readJson(resolve(manifestPath), "FlutterFlow migration plan");
  validateSchema(validateMigration, plan, "Invalid FlutterFlow migration plan");
  const snapshotPath = repositoryFile(plan.snapshotManifest);
  const surfacePath = repositoryFile(plan.surfaceManifest);
  const snapshot = readJson(snapshotPath, "FlutterFlow source snapshot");
  const surface = readJson(surfacePath, "FlutterFlow public surface");
  validateSchema(
    validateSnapshot,
    snapshot,
    "Invalid FlutterFlow source snapshot",
  );
  const { target } = await loadTarget(plan.target);
  const contract = validateFlutterFlowMigrationContract({
    plan,
    snapshot,
    surface,
    target,
  });
  const verification = sourcePath
    ? verifyFlutterFlowSource({
        manifestPath: snapshotPath,
        sourcePath,
      })
    : null;
  return migrationPlanStatus({ plan, contract, verification });
}

export function validateFlutterFlowMigrationContract({
  plan,
  snapshot,
  surface,
  target,
}) {
  if (snapshot.application !== plan.application) {
    throw new Error(
      `Migration application ${plan.application} does not match snapshot ${snapshot.application}`,
    );
  }
  if (
    target.target !== plan.target ||
    !target.environments?.[plan.environment]
  ) {
    throw new Error(
      `Migration target ${plan.target}/${plan.environment} is not declared`,
    );
  }
  const expectedSourceEnvironment = flutterFlowSourceEnvironmentName(
    plan.application,
  );
  if (plan.sourceEnvironment !== expectedSourceEnvironment) {
    throw new Error(
      `Migration source environment must be ${expectedSourceEnvironment}`,
    );
  }

  const phases = uniqueBy(plan.phases, "id", "migration phase");
  const orders = uniqueBy(plan.phases, "order", "migration phase order");
  for (const phase of plan.phases) {
    for (const dependency of phase.dependsOn) {
      const dependencyPhase = phases.get(dependency);
      if (!dependencyPhase) {
        throw new Error(
          `Migration phase ${phase.id} depends on unknown phase ${dependency}`,
        );
      }
      if (dependencyPhase.order >= phase.order) {
        throw new Error(
          `Migration phase ${phase.id} must depend only on an earlier phase`,
        );
      }
    }
  }
  const orderedPhases = [...plan.phases].sort(
    (left, right) => left.order - right.order,
  );
  for (let index = 0; index < orderedPhases.length; index += 1) {
    if (orderedPhases[index].order !== index + 1) {
      throw new Error("Migration phase orders must be contiguous from 1");
    }
  }
  void orders;

  uniqueBy(plan.workItems, "id", "migration work item");
  const snapshotChecks = uniqueBy(
    snapshot.convergence?.checks || [],
    "id",
    "snapshot convergence check",
  );
  if (snapshotChecks.size === 0) {
    throw new Error("FlutterFlow snapshot has no convergence checks");
  }
  const mappedChecks = new Map();
  const symbols = publicSurfaceSymbols(surface);
  for (const item of plan.workItems) {
    if (!phases.has(item.phase)) {
      throw new Error(
        `Migration work item ${item.id} uses unknown phase ${item.phase}`,
      );
    }
    for (const check of item.convergenceChecks) {
      if (!snapshotChecks.has(check)) {
        throw new Error(
          `Migration work item ${item.id} maps unknown convergence check ${check}`,
        );
      }
      if (mappedChecks.has(check)) {
        throw new Error(
          `Convergence check ${check} is mapped by both ${mappedChecks.get(check)} and ${item.id}`,
        );
      }
      mappedChecks.set(check, item.id);
    }
    for (const symbol of item.replacementSymbols) {
      if (!symbols.has(symbol)) {
        throw new Error(
          `Migration work item ${item.id} references unknown public symbol ${symbol}`,
        );
      }
    }
  }
  const unmappedChecks = [...snapshotChecks.keys()].filter(
    (check) => !mappedChecks.has(check),
  );
  if (unmappedChecks.length > 0) {
    throw new Error(
      `Unmapped FlutterFlow convergence checks: ${unmappedChecks.join(", ")}`,
    );
  }
  return {
    phases: phases.size,
    workItems: plan.workItems.length,
    convergenceChecks: snapshotChecks.size,
    replacementSymbols: new Set(
      plan.workItems.flatMap((item) => item.replacementSymbols),
    ).size,
  };
}

export function migrationPlanStatus({ plan, contract, verification }) {
  const checks = new Map(
    (verification?.convergence?.checks || []).map((check) => [check.id, check]),
  );
  const workItems = plan.workItems.map((item) => {
    const blockedChecks = verification
      ? item.convergenceChecks.filter(
          (check) => checks.get(check)?.ready !== true,
        )
      : null;
    return {
      id: item.id,
      phase: item.phase,
      scope: item.scope,
      authority: item.authority,
      title: item.title,
      ready: verification ? blockedChecks.length === 0 : null,
      blockedChecks,
      replacementSymbols: item.replacementSymbols,
      acceptance: item.acceptance,
    };
  });
  const workItemsByPhase = new Map();
  for (const item of workItems) {
    const values = workItemsByPhase.get(item.phase) || [];
    values.push(item);
    workItemsByPhase.set(item.phase, values);
  }
  const phases = [...plan.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase) => {
      const items = workItemsByPhase.get(phase.id) || [];
      return {
        ...phase,
        ready: verification ? items.every((item) => item.ready) : null,
        blockedWorkItems: verification
          ? items.filter((item) => !item.ready).map((item) => item.id)
          : null,
      };
    });
  const blockedWorkItems = verification
    ? workItems.filter((item) => !item.ready).map((item) => item.id)
    : null;
  return {
    schemaVersion: 1,
    mode: verification
      ? "source-inspected-migration-plan"
      : "contract-only-migration-plan",
    application: plan.application,
    target: plan.target,
    environment: plan.environment,
    sourceEnvironment: plan.sourceEnvironment,
    sourceEnvironmentAliases: [
      legacyFlutterFlowSourceEnvironmentName(plan.application),
    ],
    contractReady: true,
    sourceInspected: Boolean(verification),
    snapshotVerified: verification?.snapshotVerified ?? null,
    convergenceReady: verification?.ready ?? null,
    ready: verification?.ready === true,
    contract,
    diagnostics: verification?.diagnostics ?? null,
    project: verification?.project ?? null,
    inventory: verification?.inventory ?? null,
    convergence: verification?.convergence ?? null,
    phases,
    workItems,
    blockedWorkItems,
    convergenceBlockers: verification?.convergence?.blockers ?? null,
    note: verification
      ? "The authenticated source snapshot is joined to every migration work item; no environment file or secret value is read."
      : `Set ${plan.sourceEnvironment} (or the temporary ${legacyFlutterFlowSourceEnvironmentName(plan.application)} alias) or pass --source to join this validated contract to an authenticated application export.`,
  };
}

function publicSurfaceSymbols(surface) {
  if (!surface || surface.schemaVersion !== 1) {
    throw new Error("FlutterFlow public surface is invalid");
  }
  const collections = [
    surface.widgets || [],
    ...Object.values(surface.actions || {}),
    ...Object.values(surface.streams || {}),
  ];
  if (collections.some((collection) => !Array.isArray(collection))) {
    throw new Error(
      "FlutterFlow public surface contains an invalid collection",
    );
  }
  return new Set(collections.flat());
}

function uniqueBy(values, field, label) {
  const entries = new Map();
  for (const value of values) {
    const key = value?.[field];
    if (entries.has(key)) throw new Error(`Duplicate ${label}: ${key}`);
    entries.set(key, value);
  }
  return entries;
}

function validateSchema(validate, value, label) {
  if (validate(value)) return;
  const details = (validate.errors || [])
    .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
    .join("; ");
  throw new Error(`${label}: ${details}`);
}

function repositoryFile(relativePath) {
  const path = resolve(workspaceRoot, relativePath);
  if (!path.startsWith(`${workspaceRoot}${sep}`)) {
    throw new Error(`Repository path escapes the workspace: ${relativePath}`);
  }
  return path;
}

function readRepositoryJson(relativePath) {
  return readJson(repositoryFile(relativePath), relativePath);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

async function main() {
  const args = parseArgs();
  const manifestPath = String(args.manifest || "").trim();
  if (!manifestPath) throw new Error("--manifest is required");
  const rawPlan = readJson(resolve(manifestPath), "FlutterFlow migration plan");
  const sourceEnvironment = String(rawPlan.sourceEnvironment || "");
  const legacySourceEnvironment =
    legacyFlutterFlowSourceEnvironmentName(rawPlan.application);
  const sourcePath = String(
    args.source ||
      process.env[sourceEnvironment] ||
      process.env[legacySourceEnvironment] ||
      "",
  ).trim();
  const result = await buildFlutterFlowMigrationPlan({
    manifestPath,
    sourcePath: sourcePath || null,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.sourceInspected && !result.ready) process.exitCode = 2;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}
