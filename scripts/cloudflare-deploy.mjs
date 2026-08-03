import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { environmentFromArgs, loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const environment = environmentFromArgs(args);
const service = args.service ?? "api";
const uploadOnly = Boolean(args["upload-only"]);
if (!new Set(["api", "dashboard", "messaging"]).has(service)) throw new Error("--service must be api, dashboard or messaging");

const { target } = await loadTarget(targetName);
const cloudflareEnv = {
  ...process.env,
  CLOUDFLARE_ACCOUNT_ID: target.accountId,
};
const configPath = resolve(root, "deploy", "generated", `${targetName}-${service}-${environment}.jsonc`);
run("node", [
  resolve(root, "scripts", "cloudflare-config.mjs"),
  "--target", targetName,
  "--service", service,
  "--environment", environment,
  ...(args["no-routes"] ? ["--no-routes"] : []),
  ...(args.preflight ? ["--preflight"] : []),
], cloudflareEnv);

if (service === "dashboard") {
  const apiUrl = environment === "production"
    ? `https://${target.domains.shortlinks}`
    : `https://${target.workers.api.staging}.${target.workersDevSubdomain}.workers.dev`;
  const appUrl = environment === "production"
    ? `https://${target.domains.dashboard}`
    : `https://${target.workers.dashboard.staging}.${target.workersDevSubdomain}.workers.dev`;
  const publicEnvironment = {
    ...cloudflareEnv,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_API_PATH: "/api/v1",
    NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
    NEXT_PUBLIC_APP_URL: appUrl,
    NEXT_PUBLIC_ENV: environment,
    NEXT_PUBLIC_OPENGROW_ACCESS_MODE: target.accessMode,
    NEXT_PUBLIC_OPENGROW_EE: String(target.accessMode === "full"),
    NEXT_PUBLIC_REGISTRATION_MODE: target.registrationMode,
    NEXT_PUBLIC_SSO_ENABLED: String(target.ssoEnabled),
  };
  run(
    "npx",
    ["opennextjs-cloudflare", "build", "--config", configPath],
    publicEnvironment,
    resolve(root, "apps", "dashboard"),
  );
}

if (service === "api" && environment === "production" && !args["skip-backup"]) {
  run(
    "node",
    [resolve(root, "scripts", "cloudflare-d1-backup.mjs"), "--target", targetName],
    cloudflareEnv,
  );
}

if ((service === "api" || service === "messaging") && !args["skip-migrations"]) {
  run(
    "npx",
    ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", configPath],
    cloudflareEnv,
  );
  if (service === "api" && target.registrationMode === "allowlist") {
    run(
      "node",
      [
        resolve(root, "scripts", "opengrow-allowlist.mjs"),
        "bootstrap",
        "--target", targetName,
        "--environment", environment,
      ],
      cloudflareEnv,
    );
  }
}

if (service === "dashboard") {
  run(
    "npx",
    ["opennextjs-cloudflare", uploadOnly ? "upload" : "deploy", "--config", configPath],
    cloudflareEnv,
    resolve(root, "apps", "dashboard"),
  );
} else {
  run(
    "npx",
    ["wrangler", ...(uploadOnly ? ["versions", "upload"] : ["deploy"]), "--config", configPath],
    cloudflareEnv,
  );
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
