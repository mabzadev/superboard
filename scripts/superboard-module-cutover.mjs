#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FixtureAdapter, RemoteD1Adapter, loadFixture } from "./module-cutover/adapters.mjs";
import {
  MODULES,
  applyPlan,
  buildPlan,
  buildReverseDelta,
  confirmationValue,
  createBackupPlan,
  createRollbackPlan,
  createVerificationReport,
  parseProjectRef,
  readJson,
  reverseDeltaSql,
  stripRows,
  validateApplySafety,
  validateMaintenanceEnableSafety,
  writeJsonAtomic,
} from "./module-cutover/core.mjs";
import { MODULE_CUTOVER_GUARDS, MODULE_CUTOVER_REGISTRY, registrySummary } from "./module-cutover/registry.mjs";
import { loadTarget, root, targetNameFromArgs } from "./cloudflare-target.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseCli(argv);
  if (args.apply === true && !new Set(["apply", "maintenance-enable", "maintenance-disable"]).has(command)) {
    throw new Error(`--apply is not valid for the ${command} command`);
  }
  const projectRef = args["project-ref"];
  if (command === "registry") return emit({ schema_version: 1, entities: registrySummary() }, args);
  if (command === "window") return createWindow(args);
  if (!projectRef) throw new Error("--project-ref is required");
  parseProjectRef(projectRef);

  const targetName = targetNameFromArgs(args);
  const environment = args.environment || "production";
  if (!new Set(["development", "production"]).has(environment)) throw new Error("--environment must be development or production");
  const { target } = await loadTarget(targetName);

  if (command === "backup-plan") {
    const output = args["output-directory"] || `.cutover/backups/${projectRef}/${new Date().toISOString().replaceAll(":", "-")}`;
    return emit(createBackupPlan({ target: targetName, environment, projectRef, resources: target.environments[environment], workers: target.workers, outputDirectory: output }), args);
  }
  if (command === "backup-receipt") {
    if (!args["backup-plan"]) throw new Error("backup-receipt requires --backup-plan");
    const backupPlan = await readJson(resolve(args["backup-plan"]));
    if (backupPlan.project_ref !== projectRef) throw new Error("Backup plan project_ref mismatch");
    const artifacts = [];
    for (const item of backupPlan.database_exports) {
      const outputIndex = item.command.indexOf("--output");
      if (outputIndex < 0 || !item.command[outputIndex + 1]) throw new Error(`Backup ${item.name} has no output path`);
      const path = resolve(item.command[outputIndex + 1]);
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size < 1) throw new Error(`Backup ${item.name} is missing or empty`);
      artifacts.push({ name: item.name, path, bytes: metadata.size, sha256: await sha256File(path) });
    }
    const receipt = {
      project_ref: projectRef,
      completed_at: new Date().toISOString(),
      required_artifacts: backupPlan.database_exports.map((item) => item.name),
      artifacts,
    };
    if (args.window) {
      const windowPath = resolve(args.window);
      const window = await readJson(windowPath);
      if (window.project_ref !== projectRef) throw new Error("Window project_ref mismatch");
      window.backup_receipt = receipt;
      await writeJsonAtomic(windowPath, window);
    }
    return emit(receipt, args);
  }
  if (command === "rollback-plan") {
    if (!args["backup-plan"]) throw new Error("--backup-plan is required");
    const backupPlan = await readJson(resolve(args["backup-plan"]));
    if (backupPlan.project_ref !== projectRef) throw new Error("Rollback backup plan project_ref mismatch");
    const backupReceipt = args["backup-receipt"] ? await readJson(resolve(args["backup-receipt"])) : null;
    if (backupReceipt && backupReceipt.project_ref !== projectRef) {
      throw new Error("Rollback backup receipt project_ref mismatch");
    }
    const versions = args.versions ? await readJson(resolve(args.versions)) : {};
    const reverseDelta = args["reverse-delta"] ? await readJson(resolve(args["reverse-delta"])) : null;
    if (reverseDelta && reverseDelta.project?.project_ref !== projectRef) {
      throw new Error("Rollback reverse delta project_ref mismatch");
    }
    return emit(createRollbackPlan({ backupPlan, backupReceipt, versions, reverseDelta }), args);
  }

  const adapter = await selectAdapter(args, { target, targetName, environment });
  if (command.startsWith("maintenance-")) {
    return maintenance(command, args, adapter, targetName, projectRef);
  }
  if (command === "static-plan") {
    return emit(staticPlan(targetName, environment, projectRef, args), args);
  }
  if (!args.fixture && !args["remote-read"]) {
    return emit(staticPlan(targetName, environment, projectRef, args), args);
  }

  const modules = parseModules(args.modules);
  const entityIds = parseEntities(args.entities, modules);
  if (command === "reverse-delta") return reverseDelta(args, adapter, projectRef);
  const plan = await buildPlan({ adapter, registry: MODULE_CUTOVER_REGISTRY, guards: MODULE_CUTOVER_GUARDS, projectRef, modules, entityIds });
  if (command === "plan") return emit(stripRows(plan), args);
  if (command === "snapshot") {
    if (!args.report) throw new Error("snapshot requires --report because it contains protected project data");
    await writeJsonAtomic(resolve(args.report), plan);
    console.log(JSON.stringify({ ready: true, report: resolve(args.report), run_id: plan.run_id }, null, 2));
    return;
  }
  if (command === "verify") {
    const report = createVerificationReport(plan);
    await emit(report, args);
    if (!report.ready) process.exitCode = 2;
    return;
  }
  if (command === "apply") {
    if (args.apply !== true) throw new Error("apply requires the explicit --apply flag");
    if (!args.window) throw new Error("apply requires --window <approved-window.json>");
    const window = await readJson(resolve(args.window));
    const safety = validateApplySafety({
      target: targetName,
      projectRef,
      window,
      confirm: args.confirm,
      allowProduction: args["allow-production"] === true,
    });
    const maintenance = await adapter.maintenanceStatus(projectRef);
    if (maintenance.enabled !== true || maintenance.window_id !== safety.window_id) {
      throw new Error("Live project maintenance read-only is not enabled for this cutover window");
    }
    const checkpointPath = resolve(args.checkpoint || `.cutover/checkpoints/${targetName}-${projectRef}-${safety.window_id}.json`);
    let checkpoint;
    try {
      await access(checkpointPath);
      checkpoint = await readJson(checkpointPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      checkpoint = undefined;
    }
    const report = await applyPlan({
      adapter,
      registry: MODULE_CUTOVER_REGISTRY,
      plan,
      safety,
      checkpoint,
      onCheckpoint: (value) => writeJsonAtomic(checkpointPath, value),
    });
    return emit(stripRows(report), args);
  }
  throw new Error(`Unknown command ${command}`);
}

async function selectAdapter(args, context) {
  if (args.fixture) return loadFixture(args.fixture);
  if (!args["remote-read"] && !args.apply) return new FixtureAdapter({ project: null });
  return new RemoteD1Adapter({
    root,
    target: context.target,
    targetName: context.targetName,
    environment: context.environment,
    allowWrites: args.apply === true,
    gatewayToken: process.env.OPENGROW_CUTOVER_TOKEN,
    repositoryEncryptionKey: process.env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY,
  });
}

async function createWindow(args) {
  const projectRef = args["project-ref"];
  parseProjectRef(projectRef);
  if (!args["starts-at"] || !args["ends-at"] || !args.reason || !args["approved-by"]) {
    throw new Error("window requires --starts-at, --ends-at, --reason and --approved-by");
  }
  const window = {
    schema_version: 1,
    window_id: args["window-id"] || randomUUID(),
    project_ref: projectRef,
    starts_at: new Date(args["starts-at"]).toISOString(),
    ends_at: new Date(args["ends-at"]).toISOString(),
    reason: args.reason,
    approved_by: args["approved-by"],
    maintenance: { enabled: false, window_id: null },
    backup_receipt: null,
  };
  return emit(window, args);
}

async function maintenance(command, args, adapter, targetName, projectRef) {
  if (command === "maintenance-status") return emit(await adapter.maintenanceStatus(projectRef), args);
  if (!args.apply || !args.window) throw new Error(`${command} requires --apply and --window`);
  const windowPath = resolve(args.window);
  const window = await readJson(windowPath);
  const expected = confirmationValue(targetName, projectRef, window.window_id, "MAINTENANCE");
  if (args.confirm !== expected) throw new Error(`Refusing maintenance mutation: pass --confirm ${expected}`);
  if (window.project_ref !== projectRef) throw new Error("Maintenance window project_ref mismatch");
  const enabled = command === "maintenance-enable";
  if (enabled) {
    validateMaintenanceEnableSafety({
      projectRef,
      window,
      allowProduction: args["allow-production"] === true,
    });
  }
  const response = await adapter.setMaintenance(projectRef, { enabled, window_id: window.window_id, reason: window.reason });
  if (enabled) {
    window.maintenance = { enabled: true, window_id: window.window_id, confirmed_at: new Date().toISOString() };
  } else {
    window.maintenance = { enabled: false, window_id: window.window_id, confirmed_at: new Date().toISOString() };
  }
  await writeJsonAtomic(windowPath, window);
  return emit({ ready: response.enabled === enabled, maintenance: response, window: windowPath }, args);
}

async function reverseDelta(args, adapter, projectRef) {
  if (!args.baseline) throw new Error("reverse-delta requires --baseline <protected-snapshot.json>");
  const baseline = await readJson(resolve(args.baseline));
  if (baseline.project?.project_ref !== projectRef) throw new Error("Reverse-delta baseline project_ref mismatch");
  const byId = new Map(MODULE_CUTOVER_REGISTRY.map((entity) => [entity.id, entity]));
  const currentRowsByEntity = {};
  for (const item of baseline.entities) {
    const entity = byId.get(item.id);
    if (!entity) throw new Error(`Unknown baseline entity ${item.id}`);
    currentRowsByEntity[item.id] = await adapter.readTarget(entity, baseline.project);
  }
  const delta = buildReverseDelta({ baseline, currentRowsByEntity, registry: MODULE_CUTOVER_REGISTRY });
  if (args["sql-report"]) {
    const sql = reverseDeltaSql(delta, MODULE_CUTOVER_REGISTRY);
    await writeJsonAtomic(resolve(args["sql-report"]), sql);
  }
  await emit(delta, args);
  if (!delta.replayable) process.exitCode = 2;
}

function staticPlan(target, environment, projectRef, args) {
  const modules = parseModules(args.modules);
  const entityIds = parseEntities(args.entities, modules);
  return {
    schema_version: 1,
    mode: "static-plan",
    ready: false,
    target,
    environment,
    project_ref: projectRef,
    modules,
    entity_ids: entityIds ?? MODULE_CUTOVER_REGISTRY.filter((entity) => modules.includes(entity.module)).map((entity) => entity.id),
    remote_access_performed: false,
    next_command: `node scripts/superboard-module-cutover.mjs plan --target ${target} --environment ${environment} --project-ref ${projectRef} --remote-read`,
    mutation_guard: `CUTOVER:${target}:${projectRef}:<window_id>`,
    entities: registrySummary().filter((entity) => modules.includes(entity.module) && (!entityIds || entityIds.includes(entity.id))),
  };
}

function parseModules(value) {
  if (!value) return [...MODULES];
  const modules = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  for (const module of modules) if (!MODULES.includes(module)) throw new Error(`Unknown module ${module}`);
  return [...new Set(modules)];
}

function parseEntities(value, modules) {
  if (!value) return undefined;
  const ids = [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("--entities must contain at least one entity id");
  const known = new Map(MODULE_CUTOVER_REGISTRY.map((entity) => [entity.id, entity]));
  for (const id of ids) {
    const entity = known.get(id);
    if (!entity) throw new Error(`Unknown cutover entity ${id}`);
    if (!modules.includes(entity.module)) throw new Error(`${id} is outside --modules`);
  }
  return ids;
}

function parseCli(argv) {
  const command = argv[0]?.startsWith("--") ? "plan" : (argv[0] || "plan");
  const args = {};
  const start = argv[0]?.startsWith("--") ? 0 : 1;
  for (let index = start; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}`);
    const key = token.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) args[key] = argv[++index];
    else args[key] = true;
  }
  return { command, args };
}

async function emit(value, args) {
  if (args.report) await writeJsonAtomic(resolve(args.report), value);
  console.log(JSON.stringify(value, null, 2));
  return value;
}

async function sha256File(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ready: false, error: { code: "cutover_failed", message: error.message } }, null, 2));
    process.exitCode = 1;
  });
}
