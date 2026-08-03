import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { environmentFromArgs, loadTarget, parseArgs, root } from "./cloudflare-target.mjs";

const args = parseArgs();
const targetName = args.target ?? process.env.OPENGROW_TARGET ?? "vocostar";
const environment = environmentFromArgs(args);
const service = args.service;
const secretName = args.name;
if (!new Set(["api", "dashboard", "billing", "messaging", "growth"]).has(service)) throw new Error("--service must be api, dashboard, billing, messaging or growth");
if (!/^[A-Z][A-Z0-9_]+$/.test(secretName ?? "")) throw new Error("--name must be an uppercase secret name");
if (process.stdin.isTTY) throw new Error("Pipe the secret value on stdin; interactive input is intentionally disabled");

await loadTarget(targetName);
const value = readFileSync(0, "utf8").replace(/\n$/, "");
if (!value) throw new Error("Refusing to upload an empty secret");
const configPath = resolve(root, "deploy", "generated", `${targetName}-${service}-${environment}.jsonc`);
const result = spawnSync("npx", ["wrangler", "secret", "put", secretName, "--config", configPath], {
  cwd: root,
  input: value,
  encoding: "utf8",
  stdio: ["pipe", "inherit", "inherit"],
});
if (result.status !== 0) process.exit(result.status ?? 1);
