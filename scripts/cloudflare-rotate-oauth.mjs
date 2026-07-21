import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { environmentFromArgs, loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const environment = environmentFromArgs(args);
const { target } = await loadTarget(targetName);
const configApi = resolve(root, "deploy", "generated", `${targetName}-api-${environment}.jsonc`);
const configDashboard = resolve(root, "deploy", "generated", `${targetName}-dashboard-${environment}.jsonc`);
const secret = randomBytes(48).toString("base64url");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "opengrow-oauth-"));
const sqlPath = join(temporaryDirectory, "rotate.sql");

try {
  const clientId = sql(target.oauth.dashboardClientId);
  const secretValue = sql(secret);
  await writeFile(sqlPath, `
INSERT INTO oauth_applications (name, uid, secret, redirect_uri, scopes)
VALUES ('OpenGrow Dashboard', '${clientId}', '${secretValue}', 'urn:ietf:wg:oauth:2.0:oob', 'read write')
ON CONFLICT(uid) DO UPDATE SET secret = excluded.secret, name = excluded.name, updated_at = datetime('now');
`, { mode: 0o600 });

  run("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--file", sqlPath, "--config", configApi]);
  run("npx", ["wrangler", "secret", "put", "CLIENT_SECRET", "--config", configDashboard], secret);
  console.log(`Rotated dashboard OAuth credentials for ${targetName}/${environment}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function sql(value) {
  return value.replaceAll("'", "''");
}

function run(command, commandArgs, input) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    input,
    encoding: "utf8",
    stdio: input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
