import { loadTarget, parseArgs } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const service = args.service;
if (!new Set(["api", "dashboard"]).has(service)) throw new Error("--service must be api or dashboard");
const { target } = await loadTarget(targetName);
const token = process.env.CLOUDFLARE_BUILDS_API_TOKEN;
if (!token) throw new Error("CLOUDFLARE_BUILDS_API_TOKEN (user-scoped) is required");

const githubAccount = args["github-account"] ?? "mbzadev";
const githubRepository = args["github-repo"] ?? "opengrow";
const [githubOwner, githubRepo] = await Promise.all([
  github(`https://api.github.com/users/${githubAccount}`),
  github(`https://api.github.com/repos/${githubAccount}/${githubRepository}`),
]);

const connection = await cf("/builds/repos/connections", {
  method: "PUT",
  body: JSON.stringify({
    provider_type: "github",
    provider_account_id: String(githubOwner.id),
    provider_account_name: githubAccount,
    repo_id: String(githubRepo.id),
    repo_name: githubRepository,
  }),
});

const scripts = await cf("/workers/scripts");
const productionWorker = target.workers[service].production;
const worker = scripts.find((item) => item.id === productionWorker);
if (!worker?.tag) throw new Error(`Deploy ${productionWorker} once before connecting Workers Builds`);

const tokens = await cf("/builds/tokens");
const buildTokenUuid = args["build-token-uuid"] ?? tokens[0]?.build_token_uuid;
if (!buildTokenUuid) throw new Error("No build token found; create a target-scoped token in Worker Settings > Builds");

const triggers = await cf(`/builds/workers/${worker.tag}/triggers`);
await upsertTrigger("OpenGrow production", {
  external_script_id: worker.tag,
  repo_connection_uuid: connection.repo_connection_uuid,
  build_token_uuid: buildTokenUuid,
  trigger_name: "OpenGrow production",
  build_command: buildCommand(service),
  deploy_command: `npm run cloudflare:deploy -- --target ${targetName} --service ${service} --environment production`,
  root_directory: "/",
  branch_includes: ["main"],
  branch_excludes: [],
  path_includes: watchPaths(service),
  path_excludes: [],
  build_caching_enabled: true,
});
await upsertTrigger("OpenGrow previews", {
  external_script_id: worker.tag,
  repo_connection_uuid: connection.repo_connection_uuid,
  build_token_uuid: buildTokenUuid,
  trigger_name: "OpenGrow previews",
  build_command: buildCommand(service),
  deploy_command: `npm run cloudflare:deploy -- --target ${targetName} --service ${service} --environment staging --upload-only`,
  root_directory: "/",
  branch_includes: ["*"],
  branch_excludes: ["main"],
  path_includes: watchPaths(service),
  path_excludes: [],
  build_caching_enabled: true,
});

console.log(`Connected ${productionWorker} to ${githubAccount}/${githubRepository}`);

async function upsertTrigger(name, body) {
  const existing = triggers.find((trigger) => trigger.trigger_name === name);
  const endpoint = existing ? `/builds/triggers/${existing.trigger_uuid}` : "/builds/triggers";
  await cf(endpoint, { method: existing ? "PATCH" : "POST", body: JSON.stringify(body) });
}

function buildCommand(workerService) {
  return workerService === "api"
    ? "npm ci && npm run worker:typecheck && npm run worker:test"
    : "npm ci && npm run dashboard:typecheck && npm run dashboard:test";
}

function watchPaths(workerService) {
  return workerService === "api"
    ? ["workers/api/**", "packages/shared/**", "deploy/**", "scripts/**", "package.json", "package-lock.json"]
    : ["apps/dashboard/**", "packages/shared/**", "deploy/**", "scripts/**", "package.json", "package-lock.json"];
}

async function github(url) {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "OpenGrow" } });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.json();
}

async function cf(endpoint, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${target.accountId}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(`Cloudflare ${endpoint}: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.result;
}
