#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadTarget, root } from "./cloudflare-target.mjs";
import { readProtectedFlowUserHashKey } from "./cloudflare-flows-version-bundle.mjs";
import { FixtureFlowsCutoverAdapter, RemoteFlowsCutoverAdapter, loadFixtureAdapter } from "./flows-cutover/adapters.mjs";
import {
  FLOWS_CUTOVER_ENVIRONMENT,
  FLOWS_CUTOVER_SCHEMA_VERSION,
  FLOWS_CUTOVER_TARGET,
  applyFlowsCutoverPlan,
  assertMbzaDevelopment,
  assertPlanIntegrity,
  buildFlowsCutoverPlan,
  buildReverseDelta,
  confirmationValue,
  createBackupPlan,
  createCutoverWindow,
  createRollbackPlan,
  parseProjectRef,
  readProtectedJson,
  reverseDeltaSql,
  routingVerificationEvidence,
  stripProtectedRows,
  validateApplySafety,
  validateBackupReceipt,
  validateBackupReceiptForBackupPlan,
  validateBackupReceiptForPlan,
  validateCutoverWindow,
  validateFreezeReceipt,
  verifyFlowsCutoverPlan,
  verifyMbzaRoutingGate,
  writeProtectedJson,
} from "./flows-cutover/core.mjs";
import { canonicalJson, sha256 } from "./flows-cutover/core-primitives.mjs";
import { FLOW_CUTOVER_ENTITY_BY_ID, cutoverRegistrySummary } from "./flows-cutover/registry.mjs";

const COMMANDS = new Set([
  "registry", "instructions", "window", "snapshot", "backup-plan", "backup-receipt",
  "plan", "apply", "resume", "verify", "reverse-delta", "rollback",
  "freeze", "freeze-status", "thaw", "routing-status",
  "activate-routing", "deactivate-routing", "routing-gate",
]);

export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseCli(argv);
  if (!COMMANDS.has(command)) throw new Error(`Unknown Flows cutover command ${command}`);
  if (Object.hasOwn(args, "organization-id")) {
    throw new Error("--organization-id was removed: Flows cutover is scoped directly by project and environment");
  }
  const targetName = String(args.target || FLOWS_CUTOVER_TARGET);
  const environment = String(args.environment || FLOWS_CUTOVER_ENVIRONMENT);
  assertMbzaDevelopment(targetName, environment);
  const projectRef = args["project-ref"];
  if (!new Set(["registry", "instructions", "routing-gate"]).has(command)) {
    if (!projectRef) throw new Error("--project-ref is required");
    parseProjectRef(projectRef);
  }
  if (command === "registry") return emit({ schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, target: targetName, environment, entities: cutoverRegistrySummary() }, args);
  if (command === "instructions") return emit(instructions(args), args);

  const { target } = await loadTarget(targetName);
  if (command === "routing-gate") {
    if (!args.fixture && args["remote-read"] !== true) {
      return emit({
        schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
        mode: command,
        ready: false,
        dry_run: true,
        remote_mutation_performed: false,
        project_refs: ["1-prod", "1-test"],
        reason: "add --remote-read to verify both MBZA routing receipts before API promotion",
        automatic_deletion: false,
      }, args);
    }
    const adapter = await selectAdapter(args, {
      root,
      target,
      targetName,
      environment,
      allowWrites: false,
    });
    return routingGateCommand(args, adapter);
  }
  if (command === "window") {
    const window = createCutoverWindow({
      projectRef,
      startsAt: required(args, "starts-at"),
      endsAt: required(args, "ends-at"),
      reason: required(args, "reason"),
      approvedBy: required(args, "approved-by"),
      windowId: args["window-id"] || randomUUID(),
    });
    return emitProtectedOrSummary(window, args, "window");
  }
  if (command === "backup-plan") {
    const outputDirectory = args["output-directory"] || `.flows-cutover/backups/${projectRef}/${new Date().toISOString().replaceAll(":", "-")}`;
    const plan = createBackupPlan({ target: targetName, environment, projectRef, resources: target.environments[environment], workers: target.workers, outputDirectory });
    return emitProtectedOrSummary(plan, args, "backup-plan");
  }
  if (command === "backup-receipt") return backupReceiptCommand(args, projectRef);

  const allowWrites = args.apply === true && new Set([
    "apply", "resume", "freeze", "thaw", "activate-routing",
    "deactivate-routing",
  ]).has(command);
  const adapter = await selectAdapter(args, { root, target, targetName, environment, allowWrites });
  if (command === "snapshot") {
    if (!args.output) throw new Error("snapshot requires --output <protected-snapshot.json>");
    if (!args.fixture && args["remote-read"] !== true) return emit(dryRun(command, projectRef, args, "add --remote-read to capture both historical D1 databases"), args);
    const snapshot = await adapter.captureSnapshot({ projectRef });
    await writeProtectedJson(resolve(args.output), snapshot);
    return emit({ ready: true, protected_output: resolve(args.output), project_ref: projectRef, captured_at: snapshot.captured_at, source_bookmarks: Object.fromEntries(Object.entries(snapshot.sources).map(([source, value]) => [source, value.bookmark])) }, args);
  }
  if (command === "freeze-status") {
    if (!args.fixture && args["remote-read"] !== true) return emit(dryRun(command, projectRef, args, "add --remote-read to inspect the live maintenance state"), args);
    return emit(await adapter.maintenanceStatus(projectRef), args);
  }
  if (command === "routing-status") {
    if (!args.fixture && args["remote-read"] !== true) {
      return emit(dryRun(command, projectRef, args, "add --remote-read to inspect the live project routing state"), args);
    }
    return emit(await adapter.routingStatus(projectRef), args);
  }
  if (command === "freeze" || command === "thaw") return maintenanceCommand(command, args, adapter, projectRef);

  if (command === "plan") {
    const plan = await createPlan(args, adapter, projectRef);
    if (!args.output) return emit({ ...stripProtectedRows(plan), ready: false, blocker: "protected_plan_output_required", next_command: `${baseCommand("plan", projectRef, args)} --output .flows-cutover/plans/${projectRef}.json` }, args);
    await writeProtectedJson(resolve(args.output), plan);
    return emit({ ...stripProtectedRows(plan), protected_output: resolve(args.output) }, args);
  }

  const plan = await readProtectedJson(resolve(required(args, "plan")));
  assertPlanIntegrity(plan);
  if (plan.project.project_ref !== projectRef) throw new Error("Protected plan project_ref mismatch");
  if ((args["remote-read"] === true || args.apply === true) && typeof adapter.validatePlanIdentity === "function") {
    await adapter.validatePlanIdentity(plan, {
      // The guarded import is responsible for bootstrapping the deterministic
      // project/default-environment scope before applying any converted rows.
      allowMissingDefaultScope: command === "apply" || command === "resume",
    });
  }
  if (command === "verify") {
    if (!args.fixture && args["remote-read"] !== true) return emit(dryRun(command, projectRef, args, "add --remote-read to compare all canonical target checksums"), args);
    const report = await verifyFlowsCutoverPlan({ plan, adapter });
    if (args.output) await writeProtectedJson(resolve(args.output), report);
    await emit(report, args);
    if (!report.ready) process.exitCode = 2;
    return;
  }
  if (command === "apply" || command === "resume") return applyCommand(command, args, adapter, plan, projectRef);
  if (command === "activate-routing" || command === "deactivate-routing") {
    return routingCommand(command, args, adapter, plan, projectRef);
  }
  if (command === "reverse-delta") return reverseDeltaCommand(args, adapter, plan, projectRef);
  if (command === "rollback") return rollbackCommand(args, plan, projectRef);
}

async function createPlan(args, adapter, projectRef) {
  if (!args.snapshot) throw new Error("plan requires --snapshot <protected-snapshot.json>");
  const snapshot = await readProtectedJson(resolve(args.snapshot));
  if (snapshot.project?.project_ref !== projectRef) throw new Error("Snapshot project_ref mismatch");
  if (!args.fixture && args["remote-read"] !== true) {
    throw new Error(`Dry-run only: add --remote-read after reviewing ${baseCommand("plan", projectRef, args)}`);
  }
  await adapter.validateSnapshotIdentity?.(snapshot);
  let environmentId = args["flows-environment-id"];
  if (!environmentId && typeof adapter.resolveFlowEnvironment === "function") {
    const scope = await adapter.resolveFlowEnvironment(snapshot.project, { environmentId });
    environmentId ||= scope.environment_id;
  }
  if (!environmentId) throw new Error("--flows-environment-id is required when the adapter cannot resolve the project environment");
  return buildFlowsCutoverPlan({
    snapshot,
    adapter,
    environmentId,
    actorId: args["actor-id"] || "flows-cutover",
    entityIds: parseCsv(args.entities),
  });
}

async function applyCommand(command, args, adapter, plan, projectRef) {
  const window = await readProtectedJson(resolve(required(args, "window")));
  const backupPlan = await readProtectedJson(resolve(required(args, "backup-plan")));
  const backupReceipt = await readProtectedJson(resolve(required(args, "backup-receipt")));
  const freezeReceipt = await readProtectedJson(resolve(required(args, "freeze-receipt")));
  const expected = confirmationValue("CUTOVER", projectRef, window.window_id, plan.plan_id);
  validateApplySafety({ plan, window, backupPlan, backupReceipt, freezeReceipt, confirm: expected });
  if (args.apply !== true) {
    return emit({ ...dryRun(command, projectRef, args, "review backups, freeze receipt and protected plan before mutation"), exact_confirmation: expected, exact_command: `${baseCommand(command, projectRef, args)} --apply --confirm ${expected}` }, args);
  }
  await adapter.validateBackupReceiptIdentity?.(backupReceipt);
  const safety = validateApplySafety({ plan, window, backupPlan, backupReceipt, freezeReceipt, confirm: args.confirm });
  const liveFreeze = await adapter.maintenanceStatus(projectRef);
  if (liveFreeze.enabled !== true || liveFreeze.window_id !== window.window_id) throw new Error("Live project freeze is not active for this cutover window");
  const checkpointPath = resolve(args.checkpoint || `.flows-cutover/checkpoints/${projectRef}-${window.window_id}-${plan.plan_id}.json`);
  let checkpoint;
  try { checkpoint = await readProtectedJson(checkpointPath); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  if (command === "resume" && !checkpoint) throw new Error("resume requires an existing --checkpoint file from the interrupted exact plan");
  const result = await applyFlowsCutoverPlan({
    plan,
    adapter,
    safety,
    checkpoint,
    onCheckpoint: (value) => writeProtectedJson(checkpointPath, value),
  });
  const output = args.output ? resolve(args.output) : resolve(`.flows-cutover/reports/${projectRef}-${plan.plan_id}-apply.json`);
  await writeProtectedJson(output, result);
  return emit({ ...stripProtectedRows(result), protected_output: output, checkpoint: checkpointPath, next_required_step: "verify while the freeze remains enabled; thaw is always a separate explicit command" }, args);
}

async function maintenanceCommand(command, args, adapter, projectRef) {
  const window = await readProtectedJson(resolve(required(args, "window")));
  const plan = await readProtectedJson(resolve(required(args, "plan")));
  assertPlanIntegrity(plan);
  if (window.project_ref !== projectRef || plan.project.project_ref !== projectRef) throw new Error("Freeze/thaw artifacts do not match project_ref");
  await adapter.validatePlanIdentity?.(plan, {
    // Maintenance is stored in the API D1 and must precede the guarded import.
    // The import itself is the only operation allowed to bootstrap the
    // deterministic project/default-environment scope in Flows.
    allowMissingDefaultScope: command === "freeze",
  });
  const operation = command === "freeze" ? "FREEZE" : "THAW";
  const expected = confirmationValue(operation, projectRef, window.window_id, plan.plan_id);
  if (command === "freeze") {
    validateCutoverWindow({ window, projectRef });
    const backupPlan = await readProtectedJson(resolve(required(args, "backup-plan")));
    const backupReceipt = await readProtectedJson(resolve(required(args, "backup-receipt")));
    validateBackupReceiptForBackupPlan(backupReceipt, backupPlan);
    validateBackupReceipt(backupReceipt, { projectRef, windowId: window.window_id });
    validateBackupReceiptForPlan(backupReceipt, plan);
    if (args.apply !== true) return emit({ ...dryRun(command, projectRef, args, "maintenance changes are never implicit"), exact_confirmation: expected, exact_command: `${baseCommand(command, projectRef, args)} --apply --confirm ${expected}` }, args);
    if (args.confirm !== expected) throw new Error(`Refusing ${command}: pass --confirm ${expected}`);
    await adapter.validateBackupReceiptIdentity?.(backupReceipt);
    const response = await adapter.setMaintenance(projectRef, { enabled: true, window_id: window.window_id, reason: window.reason });
    if (response.enabled !== true || response.window_id !== window.window_id) throw new Error("Maintenance API did not confirm the requested freeze");
    const receipt = { schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, receipt_id: randomUUID(), target: FLOWS_CUTOVER_TARGET, environment: FLOWS_CUTOVER_ENVIRONMENT, project_ref: projectRef, project_id: plan.project.project_id, plan_id: plan.plan_id, window_id: window.window_id, enabled: true, reason: window.reason, confirmed_at: new Date().toISOString(), response };
    if (!args.output) throw new Error("freeze requires --output <protected-freeze-receipt.json>");
    await writeProtectedJson(resolve(args.output), receipt);
    return emit({ ready: true, enabled: true, protected_output: resolve(args.output), receipt_id: receipt.receipt_id }, args);
  }
  const freezeReceipt = await readProtectedJson(resolve(required(args, "freeze-receipt")));
  validateFreezeReceipt(freezeReceipt, { projectRef, projectId: plan.project.project_id, windowId: window.window_id });
  const verification = await readProtectedJson(resolve(required(args, "verification")));
  const evidence = routingVerificationEvidence(plan, verification);
  const routing = await adapter.routingStatus(projectRef);
  if (
    routing.enabled !== true ||
    routing.window_id !== window.window_id ||
    routing.plan_id !== plan.plan_id ||
    routing.verification_checksum_sha256 !== evidence.verification_checksum_sha256
  ) {
    throw new Error("Thaw requires verified Flows routing to be active for this exact project/window/plan");
  }
  if (args.apply !== true) return emit({ ...dryRun(command, projectRef, args, "maintenance changes are never implicit"), exact_confirmation: expected, exact_command: `${baseCommand(command, projectRef, args)} --apply --confirm ${expected}` }, args);
  if (args.confirm !== expected) throw new Error(`Refusing ${command}: pass --confirm ${expected}`);
  const response = await adapter.setMaintenance(projectRef, { enabled: false, window_id: window.window_id, reason: `verified:${plan.plan_id}` });
  if (response.enabled !== false) throw new Error("Maintenance API did not confirm thaw");
  return emit({ schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, ready: true, enabled: false, project_ref: projectRef, plan_id: plan.plan_id, window_id: window.window_id, confirmed_at: new Date().toISOString(), response }, args);
}

async function routingCommand(command, args, adapter, plan, projectRef) {
  const enabled = command === "activate-routing";
  const window = await readProtectedJson(resolve(required(args, "window")));
  const freezeReceipt = await readProtectedJson(resolve(required(args, "freeze-receipt")));
  const verification = await readProtectedJson(resolve(required(args, "verification")));
  if (window.project_ref !== projectRef) throw new Error("Routing window project_ref mismatch");
  validateFreezeReceipt(freezeReceipt, {
    projectRef,
    projectId: plan.project.project_id,
    windowId: window.window_id,
  });
  const evidence = routingVerificationEvidence(plan, verification);
  const liveFreeze = await adapter.maintenanceStatus(projectRef);
  if (liveFreeze.enabled !== true || liveFreeze.window_id !== window.window_id) {
    throw new Error("The exact project cutover window must remain frozen while changing Flows routing");
  }
  const operation = enabled ? "ROUTE-ON" : "ROUTE-OFF";
  const expected = confirmationValue(operation, projectRef, window.window_id, plan.plan_id);
  const state = {
    enabled,
    window_id: window.window_id,
    plan_id: plan.plan_id,
    verification_checksum_sha256: evidence.verification_checksum_sha256,
  };
  if (args.apply !== true) {
    return emit({
      ...dryRun(command, projectRef, args, "routing changes require an exact protected verification report and explicit confirmation"),
      verification_checksum_sha256: evidence.verification_checksum_sha256,
      exact_confirmation: expected,
      exact_command: `${baseCommand(command, projectRef, args)} --apply --confirm ${expected}`,
    }, args);
  }
  if (args.confirm !== expected) {
    throw new Error(`Refusing ${command}: pass --confirm ${expected}`);
  }
  if (!args.output) {
    throw new Error(`${command} requires --output <protected-routing-receipt.json>`);
  }
  const idempotencyKey = `flows-routing-${enabled ? "enable" : "disable"}-${sha256(canonicalJson({
    project_ref: projectRef,
    ...state,
  }))}`;
  const response = await adapter.setFlowsRouting(
    projectRef,
    state,
    idempotencyKey,
  );
  if (
    response.enabled !== enabled ||
    response.window_id !== state.window_id ||
    response.plan_id !== state.plan_id ||
    response.verification_checksum_sha256 !== state.verification_checksum_sha256
  ) {
    throw new Error("Flows routing API did not confirm the exact requested evidence");
  }
  const receipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    receipt_id: randomUUID(),
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    project_ref: projectRef,
    project_id: plan.project.project_id,
    plan_id: plan.plan_id,
    window_id: window.window_id,
    enabled,
    verification_checksum_sha256: evidence.verification_checksum_sha256,
    idempotency_key: idempotencyKey,
    confirmed_at: new Date().toISOString(),
    response,
  };
  await writeProtectedJson(resolve(args.output), receipt);
  return emit({
    ready: true,
    enabled,
    project_ref: projectRef,
    plan_id: plan.plan_id,
    window_id: window.window_id,
    verification_checksum_sha256: evidence.verification_checksum_sha256,
    protected_output: resolve(args.output),
  }, args);
}

async function routingGateCommand(args, adapter) {
  const requiredScopes = [
    { label: "prod", projectRef: "1-prod" },
    { label: "test", projectRef: "1-test" },
  ];
  const inventory = await adapter.projectInventory();
  const scopes = [];
  for (const scope of requiredScopes) {
    const plan = await readProtectedJson(resolve(required(args, `${scope.label}-plan`)));
    const verification = await readProtectedJson(resolve(required(args, `${scope.label}-verification`)));
    const window = await readProtectedJson(resolve(required(args, `${scope.label}-window`)));
    const state = await adapter.routingStatus(scope.projectRef);
    scopes.push({ plan, verification, window, state });
  }
  const report = verifyMbzaRoutingGate({ inventory, scopes });
  if (args.output) await writeProtectedJson(resolve(args.output), report);
  await emit({ ...report, protected_output: args.output ? resolve(args.output) : null }, args);
  if (!report.ready) process.exitCode = 2;
}

async function reverseDeltaCommand(args, adapter, plan, projectRef) {
  if (!args.fixture && args["remote-read"] !== true) return emit(dryRun("reverse-delta", projectRef, args, "add --remote-read to inspect post-cutover changes"), args);
  const currentRowsByEntity = {};
  for (const item of plan.entities) currentRowsByEntity[item.id] = await adapter.readTarget(FLOW_CUTOVER_ENTITY_BY_ID.get(item.id), plan.project);
  const delta = buildReverseDelta({ baselinePlan: plan, currentRowsByEntity });
  if (!args.output) throw new Error("reverse-delta requires --output <protected-reverse-delta.json>");
  await writeProtectedJson(resolve(args.output), delta);
  if (args["sql-output"]) await writeProtectedJson(resolve(args["sql-output"]), reverseDeltaSql(delta));
  await emit({ ...stripProtectedRows(delta), protected_output: resolve(args.output), sql_output: args["sql-output"] ? resolve(args["sql-output"]) : null }, args);
  if (!delta.replayable) process.exitCode = 2;
}

async function rollbackCommand(args, plan, projectRef) {
  const backupPlan = await readProtectedJson(resolve(required(args, "backup-plan")));
  const backupReceipt = await readProtectedJson(resolve(required(args, "backup-receipt")));
  const freezeReceipt = await readProtectedJson(resolve(required(args, "freeze-receipt")));
  const reverseDelta = await readProtectedJson(resolve(required(args, "reverse-delta")));
  const versions = await readProtectedJson(resolve(required(args, "versions")));
  const expected = confirmationValue("ROLLBACK", projectRef, freezeReceipt.window_id, plan.plan_id);
  const rollback = createRollbackPlan({ plan, backupPlan, backupReceipt, freezeReceipt, reverseDelta, versions, confirm: args.confirm });
  const output = args.output ? resolve(args.output) : null;
  if (output) await writeProtectedJson(output, rollback);
  return emit({ ...rollback, protected_output: output, execution_mode: "fail-closed-orchestrator", exact_confirmation: expected, exact_instruction: "Review the protected reverse SQL and run each generated command one by one while the freeze remains enabled. This CLI intentionally never performs Time Travel restore, deletion, or thaw." }, args);
}

async function backupReceiptCommand(args, projectRef) {
  const backupPlan = await readProtectedJson(resolve(required(args, "backup-plan")));
  const window = await readProtectedJson(resolve(required(args, "window")));
  const evidence = await readProtectedJson(resolve(required(args, "evidence")));
  if (!args.output) throw new Error("backup-receipt requires --output <protected-backup-receipt.json>");
  if (backupPlan.ready !== true) throw new Error(`Backup plan is blocked: ${(backupPlan.blockers || []).join(", ")}`);
  if (backupPlan.project_ref !== projectRef || window.project_ref !== projectRef) throw new Error("Backup artifacts project_ref mismatch");
  const artifacts = [];
  for (const database of backupPlan.databases) {
    const item = (evidence.artifacts ?? []).find((candidate) => candidate.logical_name === database.logical_name);
    if (!item) throw new Error(`Evidence for ${database.logical_name} is required`);
    const file = resolve(database.local_path);
    const metadata = await lstat(file);
    if (metadata.isSymbolicLink()) throw new Error(`D1 export for ${database.logical_name} must not be a symlink`);
    if (!metadata.isFile() || metadata.size < 1) throw new Error(`D1 export for ${database.logical_name} is missing or empty`);
    await chmod(file, 0o600);
    artifacts.push({
      logical_name: database.logical_name,
      database_name: database.database_name,
      database_id: database.database_id,
      local_path: file,
      bytes: metadata.size,
      sha256: await sha256File(file),
      time_travel_bookmark: required(item, "time_travel_bookmark"),
      r2_bucket: database.r2_bucket,
      r2_key: database.r2_key,
      r2_etag: required(item, "r2_etag"),
      r2_verified_at: required(item, "r2_verified_at"),
    });
  }
  const receipt = {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    receipt_id: randomUUID(),
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    project_ref: projectRef,
    window_id: window.window_id,
    backup_plan_id: backupPlan.backup_plan_id,
    completed_at: new Date().toISOString(),
    artifacts,
    automatic_deletion: false,
  };
  validateBackupReceiptForBackupPlan(receipt, backupPlan);
  validateBackupReceipt(receipt, { projectRef, windowId: window.window_id });
  await writeProtectedJson(resolve(args.output), receipt);
  return emit({ ready: true, receipt_id: receipt.receipt_id, protected_output: resolve(args.output), artifacts: artifacts.map(({ logical_name, database_name, database_id, bytes, sha256, time_travel_bookmark, r2_bucket, r2_key, r2_etag, r2_verified_at }) => ({ logical_name, database_name, database_id, bytes, sha256, time_travel_bookmark, r2_bucket, r2_key, r2_etag, r2_verified_at })) }, args);
}

async function selectAdapter(args, context) {
  if (args.fixture) return loadFixtureAdapter(args.fixture);
  if (args["remote-read"] !== true && context.allowWrites !== true) return new FixtureFlowsCutoverAdapter();
  const flowUserHashKey = args["flow-user-hash-bundle"]
    ? await readProtectedFlowUserHashKey(resolve(args["flow-user-hash-bundle"]))
    : undefined;
  return new RemoteFlowsCutoverAdapter({
    ...context,
    gatewayToken: process.env.OPENGROW_CUTOVER_TOKEN,
    flowUserHashKey,
    directMaintenance: args["direct-maintenance"] === true,
  });
}

function instructions(args) {
  return {
    schema_version: FLOWS_CUTOVER_SCHEMA_VERSION,
    target: FLOWS_CUTOVER_TARGET,
    environment: FLOWS_CUTOVER_ENVIRONMENT,
    dry_run_by_default: true,
    production_disabled: true,
    automatic_deletion: false,
    order: ["window", "backup-plan", "backup-receipt", "snapshot", "plan", "freeze", "snapshot-final", "plan-final", "apply-or-resume", "verify", "activate-routing", "routing-gate", "reverse-delta", "thaw"],
    bootstrap_if_flows_d1_is_unprovisioned: "node scripts/cloudflare-bootstrap.mjs --target mbza-development --environment development --remote",
    note: "Before API cutover, pass --flow-user-hash-bundle .flows-cutover/secrets/mbza-development-flows-development.json so hashes are derived in memory without prematurely routing legacy traffic to Flows. If the non-readable operator token is unavailable, --direct-maintenance applies and verifies the same API D1 state through the authenticated Wrangler session; exact confirmations and backup receipts remain mandatory. Execute only the exact bootstrap confirmation printed by that command. Rollback remains a fail-closed orchestrator; Time Travel restore, deletion and thaw are never automatic.",
    root_command: "node scripts/superboard-flows-cutover.mjs",
    received_args: args,
  };
}

function dryRun(command, projectRef, args, reason) {
  return { schema_version: FLOWS_CUTOVER_SCHEMA_VERSION, mode: command, ready: false, dry_run: true, remote_mutation_performed: false, project_ref: projectRef, reason, reviewed_command: baseCommand(command, projectRef, args), automatic_deletion: false };
}

function baseCommand(command, projectRef, args) {
  const pieces = ["node", "scripts/superboard-flows-cutover.mjs", command, "--target", FLOWS_CUTOVER_TARGET, "--environment", FLOWS_CUTOVER_ENVIRONMENT, "--project-ref", projectRef];
  for (const [key, value] of Object.entries(args)) {
    if (new Set(["target", "environment", "project-ref", "apply", "confirm"]).has(key) || value === false || value === undefined) continue;
    pieces.push(`--${key}`);
    if (value !== true) pieces.push(shellQuote(value));
  }
  return pieces.join(" ");
}

function parseCli(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "instructions";
  const args = {};
  for (let index = command === "instructions" && argv[0]?.startsWith("--") ? 0 : 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`Unexpected argument ${value}`);
    const key = value.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith("--")) { args[key] = argv[index + 1]; index += 1; } else { args[key] = true; }
  }
  return { command, args };
}

function parseCsv(value) { return value ? [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))] : undefined; }

function required(object, key) {
  const value = object?.[key];
  if (value === undefined || value === null || String(value).trim() === "") throw new Error(`--${key.replaceAll("_", "-")} is required`);
  return value;
}

async function emitProtectedOrSummary(value, args, label) {
  if (args.output) {
    await writeProtectedJson(resolve(args.output), value);
    return emit({ ...value, protected_output: resolve(args.output) }, args);
  }
  return emit({ ...value, note: `${label} can be persisted mode 0600 with --output <protected-file.json>` }, args);
}

function emit(value) { console.log(JSON.stringify(value, null, 2)); }

function shellQuote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }

async function sha256File(path) {
  const digest = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return digest.digest("hex");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
