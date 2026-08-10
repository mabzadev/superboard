import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sha256File } from "../cloudflare-d1-backup.mjs";
import { cloudflareEnv, root } from "../cloudflare-target.mjs";
import { parseD1Rows } from "../module-cutover/adapters.mjs";
import { readJson, writeJsonAtomic } from "../module-cutover/core.mjs";

export const CHATWOOT_BACKUPS = Object.freeze([
  "chatwoot-postgres",
  "chatwoot-storage",
  "chatwoot-export",
  "module-support",
]);

export function chatwootConfirmation(targetName, environment, projectId, windowId) {
  return `CHATWOOT:${targetName}:${environment}:${projectId}:${windowId}`;
}

export function validateChatwootApplySafety({
  targetName,
  environment,
  projectId,
  window,
  confirm,
  allowProduction = false,
  now = new Date(),
}) {
  if (window?.schema_version !== 1 || !/^[a-zA-Z0-9._-]{8,128}$/u.test(String(window.window_id || ""))) {
    throw new Error("A valid Chatwoot cutover window is required");
  }
  const starts = Date.parse(window.starts_at);
  const ends = Date.parse(window.ends_at);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts >= ends || now.getTime() < starts || now.getTime() > ends) {
    throw new Error("Current time is outside the Chatwoot cutover window");
  }
  const expected = chatwootConfirmation(targetName, environment, projectId, window.window_id);
  if (confirm !== expected) throw new Error(`Refusing Chatwoot mutation: pass --confirm ${expected}`);
  if (environment === "production" && !allowProduction) throw new Error("Production Chatwoot cutover requires --allow-production");
  if (window.opengrow_maintenance?.enabled !== true || window.chatwoot_maintenance?.enabled !== true) {
    throw new Error("Both OpenGrow and Chatwoot must be in confirmed maintenance mode");
  }
  const artifacts = window.backup_receipt?.artifacts;
  const byName = new Map(Array.isArray(artifacts) ? artifacts.map((artifact) => [artifact?.name, artifact]) : []);
  const missing = CHATWOOT_BACKUPS.filter((name) => {
    const artifact = byName.get(name);
    return !artifact || Number(artifact.bytes) < 1 || !/^[a-f0-9]{64}$/u.test(String(artifact.sha256 || ""));
  });
  if (missing.length) throw new Error(`Chatwoot cutover backup evidence is incomplete: ${missing.join(", ")}`);
  return { windowId: window.window_id };
}

export async function loadRenderedChatwoot(directory) {
  const destination = protectedPath(directory, "--rendered");
  const planPath = join(destination, "plan.json");
  const planBytes = await readFile(planPath);
  const plan = JSON.parse(planBytes.toString("utf8"));
  const sqlPath = join(destination, plan.artifacts?.support_sql?.path || "support-import.sql");
  const uploadsPath = join(destination, plan.artifacts?.r2_uploads?.path || "r2-uploads.json");
  const sql = await readFile(sqlPath);
  const uploadsBytes = await readFile(uploadsPath);
  if (digest(sql) !== plan.artifacts?.support_sql?.sha256 || digest(uploadsBytes) !== plan.artifacts?.r2_uploads?.sha256) {
    throw new Error("Rendered Chatwoot artifact checksum mismatch");
  }
  const uploads = JSON.parse(uploadsBytes.toString("utf8"));
  if (plan.ready !== true || uploads.schema_version !== 1 || !Array.isArray(uploads.objects)) {
    throw new Error("Rendered Chatwoot plan is not ready");
  }
  for (const object of uploads.objects) {
    const source = bundlePath(uploads.bundle_directory, object.relative_path);
    const metadataHash = await sha256File(source);
    const bytes = (await stat(source)).size;
    if (bytes !== Number(object.bytes) || metadataHash !== object.sha256) {
      throw new Error(`Chatwoot upload source checksum mismatch: ${object.relative_path}`);
    }
    object.source_path = source;
  }
  return {
    directory: destination,
    plan,
    planSha256: digest(planBytes),
    sqlPath,
    uploads,
  };
}

export async function applyRenderedChatwoot({
  rendered,
  target,
  targetName,
  environment,
  checkpointPath,
  env = cloudflareEnv(target),
  execute = executeCommand,
}) {
  const checkpointFile = protectedPath(checkpointPath, "--checkpoint");
  let checkpoint;
  try {
    checkpoint = await readJson(checkpointFile);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    checkpoint = {
      schema_version: 1,
      plan_sha256: rendered.planSha256,
      uploads: {},
      d1_imported: false,
      created_at: new Date().toISOString(),
    };
  }
  if (checkpoint.schema_version !== 1 || checkpoint.plan_sha256 !== rendered.planSha256) {
    throw new Error("Chatwoot checkpoint does not belong to this rendered plan");
  }

  const configPath = resolve(root, "deploy", "generated", `${targetName}-support-${environment}.jsonc`);
  execute(process.execPath, [
    resolve(root, "scripts", "cloudflare-config.mjs"),
    "--target", targetName, "--environment", environment, "--service", "support", "--no-routes",
  ], { env });

  const temporary = await mkdtemp(join(tmpdir(), "superboard-chatwoot-r2-"));
  try {
    for (const [position, object] of rendered.uploads.objects.entries()) {
      const key = String(object.storage_key || "");
      if (!key || key.startsWith("/") || key.split("/").includes("..")) throw new Error(`Invalid R2 storage key at upload ${position}`);
      if (checkpoint.uploads[key]?.sha256 === object.sha256) continue;
      const objectPath = `${rendered.uploads.bucket_name}/${key}`;
      execute("npx", [
        "wrangler", "r2", "object", "put", objectPath,
        "--remote", "--force", "--file", object.source_path,
        "--content-type", String(object.content_type || "application/octet-stream"),
        "--config", configPath,
      ], { env });
      const verification = join(temporary, `${position}.bin`);
      execute("npx", [
        "wrangler", "r2", "object", "get", objectPath,
        "--remote", "--file", verification, "--config", configPath,
      ], { env });
      if (await sha256File(verification) !== object.sha256) throw new Error(`R2 verification failed for ${key}`);
      checkpoint.uploads[key] = { sha256: object.sha256, verified_at: new Date().toISOString() };
      await writeJsonAtomic(checkpointFile, checkpoint);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  const supportDatabase = target.environments[environment].moduleD1.support;
  if (!supportDatabase?.id) throw new Error("Support D1 is not provisioned");
  if (!checkpoint.d1_imported) {
    execute("npx", [
      "wrangler", "d1", "execute", supportDatabase.id,
      "--remote", "--file", rendered.sqlPath, "--yes", "--config", configPath,
    ], { env });
    checkpoint.d1_imported = true;
    checkpoint.d1_imported_at = new Date().toISOString();
    await writeJsonAtomic(checkpointFile, checkpoint);
  }

  const accountId = Number(rendered.plan.source?.account_id);
  const projectId = Number(rendered.plan.destination?.project_id);
  if (!Number.isSafeInteger(accountId) || accountId < 1 || !Number.isSafeInteger(projectId) || projectId < 1) {
    throw new Error("Rendered Chatwoot identifiers are invalid");
  }
  const prefix = `chatwoot:${accountId}:%`;
  const query = `SELECT
    (SELECT COUNT(*) FROM support_contacts WHERE project_id=${projectId} AND id LIKE '${prefix}') contacts,
    (SELECT COUNT(*) FROM support_configuration_entities WHERE project_id=${projectId} AND id LIKE '${prefix}') configuration,
    (SELECT COUNT(*) FROM conversations WHERE project_id=${projectId} AND id LIKE '${prefix}') conversations,
    (SELECT COUNT(*) FROM messages WHERE id LIKE '${prefix}') messages,
    (SELECT COUNT(*) FROM support_message_attachments WHERE project_id=${projectId} AND id LIKE '${prefix}') attachments`;
  const output = execute("npx", [
    "wrangler", "d1", "execute", supportDatabase.id,
    "--remote", "--command", query, "--json", "--config", configPath,
  ], { env, capture: true });
  const observed = parseD1Rows(output.stdout)[0] || {};
  const mismatches = Object.entries(rendered.plan.evidence).filter(([name, evidence]) =>
    Number(observed[name] || 0) !== Number(evidence.count));
  if (mismatches.length) throw new Error(`Chatwoot D1 count verification failed: ${mismatches.map(([name]) => name).join(", ")}`);
  checkpoint.verified_at = new Date().toISOString();
  checkpoint.evidence = observed;
  await writeJsonAtomic(checkpointFile, checkpoint);
  return { checkpoint: checkpointFile, evidence: observed, uploads: Object.keys(checkpoint.uploads).length };
}

function executeCommand(command, args, { env = process.env, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    shell: false,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result;
}

function protectedPath(value, flag) {
  if (typeof value !== "string" || !isAbsolute(value)) throw new Error(`${flag} must be an absolute path outside Git`);
  const path = resolve(value);
  const fromRepository = relative(root, path);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error(`${flag} must remain outside the Git repository`);
  }
  return path;
}

function bundlePath(directory, value) {
  const base = protectedPath(directory, "bundle_directory");
  if (typeof value !== "string" || !value || isAbsolute(value)) throw new Error("Invalid Chatwoot bundle path");
  const path = resolve(base, value);
  const fromBase = relative(base, path);
  if (fromBase.startsWith("..") || isAbsolute(fromBase)) throw new Error("Chatwoot upload escaped its bundle");
  return path;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
