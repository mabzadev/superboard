import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  loadTarget,
  parseArgs,
  publicApiUrl,
  publicAuthUrl,
  publicDashboardUrl,
  publicMcpUrl,
  publicSdkUrl,
  publicShortlinkUrl,
  root,
  targetSelectionFromArgs,
} from "./cloudflare-target.mjs";

const args = parseArgs();
const { targetName, environment } = await targetSelectionFromArgs(args, process.env, { allowReference: true });
const { target } = await loadTarget(targetName);

if (!target.environments[environment] || !target.workers.dashboard?.[environment]) {
  throw new Error(`${targetName} does not define dashboard in ${environment}`);
}

const configPath = resolve(
  root,
  "deploy",
  "generated",
  `${targetName}-dashboard-${environment}.jsonc`,
);
run(process.execPath, [
  resolve(root, "scripts", "cloudflare-config.mjs"),
  "--service", "dashboard",
  "--target", targetName,
  "--environment", environment,
  ...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
]);

const dashboardEnvironment = {
  ...process.env,
  NEXT_PUBLIC_API_URL: publicApiUrl(target),
  NEXT_PUBLIC_AUTH_URL: publicAuthUrl(target),
  NEXT_PUBLIC_API_PATH: "/api/v1",
  NEXT_PUBLIC_CLIENT_ID: target.oauth.dashboardClientId,
  NEXT_PUBLIC_APP_URL: publicDashboardUrl(target),
  NEXT_PUBLIC_SDK_URL: publicSdkUrl(target),
  NEXT_PUBLIC_SHORTLINK_URL: publicShortlinkUrl(target),
  NEXT_PUBLIC_MCP_URL: publicMcpUrl(target),
  NEXT_PUBLIC_DOCS_URL: target.operator.docsUrl,
  ...(target.operator.supportEmail
    ? { NEXT_PUBLIC_SUPPORT_EMAIL: target.operator.supportEmail }
    : {}),
  NEXT_PUBLIC_ENV: environment,
  NEXT_PUBLIC_REGISTRATION_MODE: target.registrationMode,
  NEXT_PUBLIC_SSO_ENABLED: String(target.ssoEnabled),
};
const dashboardDirectory = resolve(root, "apps", "dashboard");

run("npx", ["opennextjs-cloudflare", "build", "--config", configPath], dashboardEnvironment, dashboardDirectory);
if (args.preview) {
  run("npx", ["opennextjs-cloudflare", "preview", "--config", configPath], dashboardEnvironment, dashboardDirectory);
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
