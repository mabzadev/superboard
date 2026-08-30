#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const result = spawnSync(
	"npm",
	["audit", "--workspaces=false", "--audit-level=low"],
	{
		cwd: resolve(root, "apps/mcp"),
		stdio: "inherit",
		shell: false,
	},
);
process.exit(result.status ?? 1);
