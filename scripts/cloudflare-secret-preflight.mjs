#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  cloudflareEnv,
  environmentFromArgs,
  loadTarget,
  parseArgs,
  root,
  targetNameFromArgs,
} from "./cloudflare-target.mjs";
import { requiredSecretInventory } from "./cloudflare-secret-inventory.mjs";

export function parseSecretNames(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("Unable to parse Wrangler secret list");
  const rows = JSON.parse(output.slice(start, end + 1));
  if (!Array.isArray(rows)) throw new Error("Wrangler secret list is not an array");
  return rows.map((row) => String(row?.name || "")).filter(Boolean);
}

export function evaluateSecretReadiness(
  requirements,
  configuredByService,
  inspectionErrorsByService = {},
) {
  const services = requirements.map((requirement) => {
    const configured = new Set(configuredByService[requirement.service] || []);
    const inspectionError = inspectionErrorsByService[requirement.service] || null;
    const missing = requirement.names.filter((name) => !configured.has(name));
    const unsatisfiedAlternatives = requirement.alternatives
      .filter(({ oneOf }) => !oneOf.some((name) => configured.has(name)))
      .map(({ oneOf }) => ({ oneOf }));
    return {
      service: requirement.service,
      ready: !inspectionError && missing.length === 0 && unsatisfiedAlternatives.length === 0,
      inspectionError,
      configuredNames: [...configured].sort(),
      missing,
      unsatisfiedAlternatives,
    };
  });
  return {
    schema_version: 1,
    values_included: false,
    ready: services.every((service) => service.ready),
    services,
  };
}

async function main() {
  const args = parseArgs();
  const targetName = targetNameFromArgs(args);
  const environment = environmentFromArgs(args);
  const { target } = await loadTarget(targetName);
  const requirements = requiredSecretInventory(target, environment);
  const childEnv = { ...cloudflareEnv(target), NO_COLOR: "1" };
  const configuredByService = {};
  const inspectionErrorsByService = {};

  for (const { service } of requirements) {
    const workerName = target.workers?.[service]?.[environment];
    configuredByService[service] = [];
    if (!workerName) {
      inspectionErrorsByService[service] = `Worker name is not configured for ${service}/${environment}`;
      continue;
    }

    const inspection = captureResult("npx", [
      "wrangler", "secret", "list",
      "--name", workerName,
      "--format", "json",
    ], childEnv);
    if (!inspection.ok) {
      inspectionErrorsByService[service] = `Secret inventory unavailable for Worker ${workerName}`;
      continue;
    }

    try {
      configuredByService[service] = parseSecretNames(inspection.output);
    } catch {
      inspectionErrorsByService[service] = `Secret inventory response is invalid for Worker ${workerName}`;
    }
  }

  const report = {
    ...evaluateSecretReadiness(requirements, configuredByService, inspectionErrorsByService),
    target: targetName,
    environment,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ready) process.exitCode = 1;
}

function captureResult(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  return {
    ok: result.status === 0 && !result.error,
    output: `${result.stdout || ""}\n${result.stderr || ""}`,
  };
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) await main();
