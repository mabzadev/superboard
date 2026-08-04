import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const { target } = await loadTarget(targetName);
const databaseKey = args.database ?? "d1";
if (!new Set(["d1", "growthD1", "messagingD1"]).has(databaseKey)) throw new Error("--database must be d1, growthD1 or messagingD1");
const database = target.environments.production[databaseKey];
if (!database?.id) throw new Error(`${targetName} does not define an id for ${databaseKey}`);
const date = new Date().toISOString().replaceAll(":", "-");
const backupDirectory = resolve(root, ".backups", targetName, databaseKey);
const output = resolve(backupDirectory, `${date}.sql`);
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });

const result = spawnSync("npx", [
  "wrangler", "d1", "export", database.id,
  "--remote", "--output", output,
], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: target.accountId },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Encrypted/offsite retention must be configured by the target operator: ${output}`);
