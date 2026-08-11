import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv from "ajv";
import { assertReferenceEndpointContract } from "./reference-config-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "reference.project.json");
const manifestSchemaPath = path.join(root, "schemas", "reference-project.schema.json");
const generatedConfigPath = path.join(root, ".wrangler-reference.generated.jsonc");

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireHttpsOrigin(value, field) {
  const raw = requireNonEmptyString(value, field);
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${field} must be an HTTPS origin without path, query or credentials.`);
  }
  return url;
}

export function buildReferenceWorkerConfig(project, { includeRoutes = true } = {}) {
  assertReferenceEndpointContract(project?.endpoints);
  if (project?.environment !== "development" || project?.target !== "mbza-development") {
    throw new Error("The reference deployment must target mbza-development.");
  }
  if (project?.deployment?.branch !== "dev" || project?.deployment?.environment !== "development") {
    throw new Error("The reference deployment must be restricted to the dev branch and development environment.");
  }

  const referenceUrl = requireHttpsOrigin(
    project?.endpoints?.referenceWeb,
    "endpoints.referenceWeb",
  );
  const sdkIdentifier = requireNonEmptyString(
    project?.sdkApplication?.identifier,
    "sdkApplication.identifier",
  );
  if (referenceUrl.hostname !== sdkIdentifier) {
    throw new Error("The reference hostname must match the registered SDK application identifier.");
  }

  const workerName = requireNonEmptyString(
    project?.deployment?.workerName,
    "deployment.workerName",
  );
  if (!/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(workerName)) {
    throw new Error("deployment.workerName must be a valid, explicit Cloudflare Worker name.");
  }

  const compatibilityDate = requireNonEmptyString(
    project?.deployment?.compatibilityDate,
    "deployment.compatibilityDate",
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(compatibilityDate)) {
    throw new Error("deployment.compatibilityDate must use YYYY-MM-DD.");
  }

  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: workerName,
    compatibility_date: compatibilityDate,
    workers_dev: false,
    preview_urls: false,
    assets: {
      directory: "./build/web",
      not_found_handling: "single-page-application",
    },
    ...(includeRoutes
      ? { routes: [{ pattern: referenceUrl.hostname, custom_domain: true }] }
      : {}),
  };
}

export function evaluateReferenceDomainOwnership({ hostname, service, zones, workerDomains, dnsRecords }) {
  const zone = zones
    .filter((candidate) => candidate.name && (
      hostname === candidate.name || hostname.endsWith(`.${candidate.name}`)
    ))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!zone) return { status: "zone-missing", blocking: true };

  const assigned = workerDomains.filter(
    (domain) => String(domain.hostname ?? "").toLowerCase() === hostname,
  );
  if (assigned.length === 1 && assigned[0].service === service) {
    return { status: "managed", blocking: false };
  }
  if (assigned.length > 0) {
    return {
      status: "wrong-worker",
      blocking: true,
      currentServices: assigned.map((domain) => domain.service ?? "unknown"),
    };
  }
  if (dnsRecords.length > 0) return { status: "dns-conflict", blocking: true };
  return { status: "available", blocking: false };
}

async function run() {
  const allowedArguments = new Set(["--config-only", "--dry-run", "--no-routes"]);
  const unknownArguments = process.argv.slice(2).filter((argument) => !allowedArguments.has(argument));
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument(s): ${unknownArguments.join(", ")}`);
  }

  const project = JSON.parse(await readFile(manifestPath, "utf8"));
  const projectSchema = JSON.parse(await readFile(manifestSchemaPath, "utf8"));
  const validateProject = new Ajv({ allErrors: true }).compile(projectSchema);
  if (!validateProject(project)) {
    throw new Error(`Invalid reference.project.json: ${JSON.stringify(validateProject.errors)}`);
  }
  const noRoutes = process.argv.includes("--no-routes");
  const config = buildReferenceWorkerConfig(project, { includeRoutes: !noRoutes });
  await writeFile(generatedConfigPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  process.stdout.write(`Generated ${generatedConfigPath}\n`);

  if (process.argv.includes("--config-only")) return;

  await access(path.join(root, "build", "web"));
  const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
  await access(wrangler);

  if (!process.argv.includes("--dry-run") && !noRoutes) {
    await assertReferenceDomainIsSafe(config);
  }

  const argumentsList = ["deploy", "--config", generatedConfigPath];
  if (process.argv.includes("--dry-run")) argumentsList.push("--dry-run");

  const result = spawnSync(wrangler, argumentsList, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Wrangler exited with status ${result.status}.`);
  }
}

async function assertReferenceDomainIsSafe(config) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!/^[0-9a-f]{32}$/i.test(accountId ?? "")) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID must be an explicit 32-character account ID.");
  }
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required for domain preflight and deployment.");

  const hostname = config.routes[0].pattern;
  const workerDomains = await cloudflareList(
    `/accounts/${accountId}/workers/domains`,
    { per_page: "1000" },
    apiToken,
  );
  const zones = await cloudflareList(
    "/zones",
    { "account.id": accountId, per_page: "50" },
    apiToken,
  );
  const zone = zones
    .filter((candidate) => candidate.name && (
      hostname === candidate.name || hostname.endsWith(`.${candidate.name}`)
    ))
    .sort((left, right) => right.name.length - left.name.length)[0];
  const dnsRecords = zone?.id
    ? await cloudflareList(
        `/zones/${zone.id}/dns_records`,
        { name: hostname, per_page: "100" },
        apiToken,
      )
    : [];
  const result = evaluateReferenceDomainOwnership({
    hostname,
    service: config.name,
    zones,
    workerDomains,
    dnsRecords,
  });
  process.stdout.write(`Reference custom domain preflight: ${result.status}\n`);
  if (result.blocking) {
    throw new Error(`Reference custom domain is blocked: ${result.status}. Resolve ownership explicitly.`);
  }
}

async function cloudflareList(pathname, query, apiToken) {
  const collected = [];
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4${pathname}`);
    for (const [key, value] of Object.entries({ ...query, page: String(page) })) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const errors = Array.isArray(payload?.errors)
        ? payload.errors.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "Cloudflare API error"}`)
        : [`HTTP ${response.status}`];
      throw new Error(`Cloudflare read failed for ${pathname}: ${errors.join("; ")}`);
    }
    collected.push(...(Array.isArray(payload.result) ? payload.result : []));
    totalPages = Number(payload.result_info?.total_pages ?? 1);
    page += 1;
  } while (page <= totalPages);
  return collected;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
