import { spawnSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const target = args.target;
if (!target) throw new Error("Usage: npm run target:register -- --target <slug> --apply");
const apply = Boolean(args.apply);
const manifestPath = resolve(root, "deploy", "targets", `${target}.json`);

try {
  await access(manifestPath);
} catch {
  for (const required of ["account-id", "workers-dev-subdomain", "shortlinks-domain", "sdk-domain", "dashboard-domain"]) {
    if (!args[required]) throw new Error(`New targets require --${required}`);
  }
  const manifest = newManifest();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created ${manifestPath}`);
}

run("node", ["scripts/cloudflare-bootstrap.mjs", "--target", target, "--environment", "staging", ...(apply ? ["--apply"] : [])]);
if (apply) {
  run("node", ["scripts/cloudflare-config.mjs", "--target", target, "--service", "api", "--environment", "staging"]);
  run("node", ["scripts/cloudflare-config.mjs", "--target", target, "--service", "dashboard", "--environment", "staging"]);
  run("node", ["scripts/cloudflare-deploy.mjs", "--target", target, "--service", "api", "--environment", "staging"]);
  run("node", ["scripts/cloudflare-deploy.mjs", "--target", target, "--service", "dashboard", "--environment", "staging"]);
}

console.log(apply
  ? `Target ${target} is bootstrapped and deployed to staging. Add runtime secrets before promotion.`
  : `Target ${target} validated. Re-run with --apply and CLOUDFLARE_API_TOKEN to provision it.`);

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function newManifest() {
  const prefix = `opengrow-${target}`;
  const queues = (environment) => ({
    events: `${prefix}-events-${environment}`,
    eventsDlq: `${prefix}-events-${environment}-dlq`,
    push: `${prefix}-push-${environment}`,
    pushDlq: `${prefix}-push-${environment}-dlq`,
    maintenance: `${prefix}-maintenance-${environment}`,
    maintenanceDlq: `${prefix}-maintenance-${environment}-dlq`,
    billing: `${prefix}-billing-${environment}`,
    billingDlq: `${prefix}-billing-${environment}-dlq`,
  });
  const environment = (name) => ({
    d1: { name: `${prefix}-${name}`, id: null },
    kv: { name: `${prefix}-${name}`, id: null },
    r2: { name: `${prefix}-${name}` },
    dashboardCache: { name: `${prefix}-dashboard-cache-${name}` },
    queues: queues(name),
  });
  return {
    $schema: "./schema.json",
    schemaVersion: 1,
    target,
    accountId: args["account-id"],
    workersDevSubdomain: args["workers-dev-subdomain"],
    domains: {
      shortlinks: args["shortlinks-domain"],
      sdk: args["sdk-domain"],
      dashboard: args["dashboard-domain"],
    },
    workers: {
      api: { staging: "opengrow-api-staging", production: "opengrow-api" },
      dashboard: { staging: "opengrow-staging", production: "opengrow" },
    },
    oauth: { dashboardClientId: `${prefix}-dashboard` },
    environments: { staging: environment("staging"), production: environment("production") },
  };
}
