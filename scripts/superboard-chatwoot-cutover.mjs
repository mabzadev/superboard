#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadChatwootBundle,
  renderChatwootSql,
  transformChatwootBundle,
} from "./chatwoot-cutover/core.mjs";
import {
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";

export async function buildChatwootCutover({ bundleDirectory, target, environment, projectId }) {
  if (target.features?.support !== true) throw new Error("OpenGrow Support must be enabled for Chatwoot cutover");
  const resources = target.environments?.[environment];
  if (!resources) throw new Error(`Target does not define ${environment}`);
  if (!resources.supportProjectIds.includes(projectId)) {
    throw new Error(`Support project ${projectId} is not allowlisted in the target manifest`);
  }
  const bundle = await loadChatwootBundle(bundleDirectory);
  const transformation = transformChatwootBundle(bundle, { projectId });
  return {
    bundle,
    transformation,
    supportDatabase: resources.moduleD1.support,
    supportBucket: resources.moduleR2.support,
  };
}

export function publicPlan(result, targetName, environment) {
  return {
    schema_version: 1,
    mode: "plan",
    target: targetName,
    environment,
    source: result.transformation.source,
    destination: {
      project_id: result.transformation.target.project_id,
      database_name: result.supportDatabase.name,
      bucket_name: result.supportBucket.name,
    },
    ready: result.transformation.ready,
    blockers: result.transformation.blockers,
    evidence: result.transformation.evidence,
    uploads: {
      count: result.transformation.uploads.length,
      bytes: result.transformation.uploads.reduce((total, item) => total + item.bytes, 0),
    },
  };
}

export async function renderArtifacts(result, outputDirectory, targetName, environment) {
  const destination = assertProtectedOutput(outputDirectory);
  await mkdir(destination, { mode: 0o700 });
  const sql = renderChatwootSql(result.transformation);
  const uploads = {
    schema_version: 1,
    target: targetName,
    environment,
    bucket_name: result.supportBucket.name,
    bundle_directory: result.bundle.directory,
    objects: result.transformation.uploads,
  };
  const plan = {
    ...publicPlan(result, targetName, environment),
    mode: "render",
    rendered_at: new Date().toISOString(),
    artifacts: {
      support_sql: { path: "support-import.sql", sha256: hash(sql) },
      r2_uploads: { path: "r2-uploads.json", sha256: hash(`${JSON.stringify(uploads, null, 2)}\n`) },
    },
    required_pre_cutover_backups: [
      "chatwoot-postgres",
      "chatwoot-storage",
      "chatwoot-export",
      "module-support",
    ],
  };
  await writeFile(join(destination, "support-import.sql"), sql, { mode: 0o600, flag: "wx" });
  await writeFile(join(destination, "r2-uploads.json"), `${JSON.stringify(uploads, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(destination, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { destination, plan };
}

export function assertProtectedOutput(value) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error("--output-directory must be an absolute path outside the Git repository");
  }
  const destination = resolve(value);
  const fromRepository = relative(root, destination);
  if (fromRepository === "" || (!fromRepository.startsWith("..") && !isAbsolute(fromRepository))) {
    throw new Error("Refusing to render customer migration data inside the Git repository");
  }
  return destination;
}

async function main(argv = process.argv.slice(2)) {
  const command = ["plan", "render"].includes(argv[0]) ? argv[0] : "plan";
  if (argv[0] && !argv[0].startsWith("--") && !["plan", "render"].includes(argv[0])) {
    throw new Error("Command must be plan or render");
  }
  const args = parseArgs(command === argv[0] ? argv.slice(1) : argv);
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const projectId = Number(args["project-id"]);
  if (!Number.isSafeInteger(projectId) || projectId < 1) throw new Error("--project-id must be a positive integer");
  if (!args.bundle) throw new Error("--bundle must name the protected Chatwoot export directory");
  const { target } = await loadTarget(targetName);
  const result = await buildChatwootCutover({
    bundleDirectory: resolve(args.bundle),
    target,
    environment,
    projectId,
  });
  if (command === "plan") {
    process.stdout.write(`${JSON.stringify(publicPlan(result, targetName, environment), null, 2)}\n`);
    if (!result.transformation.ready) process.exitCode = 2;
    return;
  }
  if (!args["output-directory"]) throw new Error("render requires --output-directory");
  const rendered = await renderArtifacts(result, args["output-directory"], targetName, environment);
  const planBytes = await readFile(join(rendered.destination, "plan.json"));
  process.stdout.write(`${JSON.stringify({
    ready: true,
    output_directory: rendered.destination,
    plan_sha256: hash(planBytes),
    object_count: rendered.plan.uploads.count,
  }, null, 2)}\n`);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
