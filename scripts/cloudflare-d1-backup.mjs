import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const { target } = await loadTarget(targetName);
const database = target.environments.production.d1;
const date = new Date().toISOString().replaceAll(":", "-");
const backupDirectory = resolve(root, ".backups", targetName);
const output = resolve(backupDirectory, `${date}.sql`);
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });

const result = spawnSync("npx", [
  "wrangler", "d1", "export", database.name,
  "--remote", "--output", output,
], { cwd: root, stdio: "inherit", shell: false });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Encrypted/offsite retention must be configured by the target operator: ${output}`);
