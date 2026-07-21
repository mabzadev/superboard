import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { environmentFromArgs, loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const environment = environmentFromArgs(args);
const service = args.service ?? "api";
const uploadOnly = Boolean(args["upload-only"]);
if (!new Set(["api", "dashboard"]).has(service)) throw new Error("--service must be api or dashboard");

const { target } = await loadTarget(targetName);
const configPath = resolve(root, "deploy", "generated", `${targetName}-${service}-${environment}.jsonc`);
run("node", [
  resolve(root, "scripts", "cloudflare-config.mjs"),
  "--target", targetName,
  "--service", service,
  "--environment", environment,
  ...(args["no-routes"] ? ["--no-routes"] : []),
  ...(args.preflight ? ["--preflight"] : []),
]);

if (service === "dashboard") {
  const apiUrl = environment === "production"
    ? `https://${target.domains.shortlinks}`
    : `https://${target.workers.api.staging}.${target.workersDevSubdomain}.workers.dev`;
  const appUrl = environment === "production"
    ? `https://${target.domains.dashboard}`
    : `https://${target.workers.dashboard.staging}.${target.workersDevSubdomain}.workers.dev`;
  const publicEnvironment = {
    ...process.env,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_API_PATH: "/api/v1",
    NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_ENV: environment,
  };
  run(
    "npx",
    ["opennextjs-cloudflare", "build", "--config", configPath],
    publicEnvironment,
    resolve(root, "apps", "dashboard"),
  );
}

if (service === "api" && environment === "production" && !args["skip-backup"]) {
  run("node", [resolve(root, "scripts", "cloudflare-d1-backup.mjs"), "--target", targetName]);
}

if (service === "api" && !args["skip-migrations"]) {
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", configPath]);
}

if (service === "dashboard") {
  run(
    "npx",
    ["opennextjs-cloudflare", uploadOnly ? "upload" : "deploy", "--config", configPath],
    process.env,
    resolve(root, "apps", "dashboard"),
  );
} else {
  run("npx", ["wrangler", ...(uploadOnly ? ["versions", "upload"] : ["deploy"]), "--config", configPath]);
}

function run(command, commandArgs, env = process.env, cwd = root) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
