import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { cloudflareEnv, environmentFromArgs, loadTarget, parseArgs, root, targetNameFromArgs } from "./cloudflare-target.mjs";

const argv = process.argv.slice(2);
const action = argv.find((value) => !value.startsWith("--") && !argv[argv.indexOf(value) - 1]?.startsWith("--"));
const args = parseArgs(argv);
const targetName = targetNameFromArgs(args);
const environment = environmentFromArgs({ ...args, environment: args.environment ?? "production" });
const { target } = await loadTarget(targetName);
const resources = target.environments[environment];

if (!resources?.d1?.id) throw new Error(`${targetName} does not define a provisioned ${environment} D1 database`);
if (!new Set(["add", "revoke", "list", "bootstrap"]).has(action)) {
  throw new Error("Usage: npm run allowlist -- <add|revoke|list|bootstrap> --target <slug> --environment <development|production> [--email user@example.com]");
}

const realm = `${target.target}:${environment}`;
const email = action === "add" || action === "revoke" ? normalizeEmail(args.email) : null;
const configPath = resolve(root, "deploy", "generated", `${targetName}-api-${environment}.jsonc`);
const command = sqlFor(action, realm, email);
const targetCloudflareEnv = cloudflareEnv(target);

run("node", [
  resolve(root, "scripts", "cloudflare-config.mjs"),
  "--target", targetName,
  "--service", "api",
  "--environment", environment,
  ...(args["no-routes"] ? ["--no-routes"] : []),
], targetCloudflareEnv);

run("npx", [
  "wrangler", "d1", "execute", "DB",
  "--remote",
  "--config", configPath,
  "--command", command,
], targetCloudflareEnv);

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("--email must be a valid email address");
  }
  return normalized;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlFor(selectedAction, selectedRealm, selectedEmail) {
  const realmSql = quote(selectedRealm);
  if (selectedAction === "add") {
    return `INSERT INTO registration_allowlist (realm, email, active, updated_at)
      VALUES (${realmSql}, ${quote(selectedEmail)}, 1, datetime('now'))
      ON CONFLICT(realm, email) DO UPDATE SET active = 1, updated_at = datetime('now');`;
  }
  if (selectedAction === "revoke") {
    return `UPDATE registration_allowlist
      SET active = 0, updated_at = datetime('now')
      WHERE realm = ${realmSql} AND email = ${quote(selectedEmail)};`;
  }
  if (selectedAction === "bootstrap") {
    return `INSERT INTO registration_allowlist (realm, email, active, note, updated_at)
      SELECT ${realmSql}, lower(trim(email)), 1, 'Existing account migrated automatically', datetime('now')
      FROM users
      WHERE email IS NOT NULL AND trim(email) != ''
      ON CONFLICT(realm, email) DO UPDATE SET active = 1, updated_at = datetime('now');
      UPDATE instances
      SET revenue_collection_enabled = 1, updated_at = datetime('now');`;
  }
  return `SELECT email, active, registration_count, last_registered_at, created_at, updated_at
    FROM registration_allowlist
    WHERE realm = ${realmSql}
    ORDER BY email;`;
}

function run(commandName, commandArgs, env) {
  const result = spawnSync(commandName, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
