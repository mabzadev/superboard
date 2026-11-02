#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

if (process.env.CI) process.exit(0);

const CLI_SRC = "packages/core/dist/cli/index.mjs";

if (!existsSync(CLI_SRC)) process.exit(0);

const binDir = execSync("pnpm bin", { encoding: "utf-8" }).trim();
const cliBin = `${binDir}/emdash`;

if (!existsSync(cliBin)) {
	console.log("CLI bin missing — relinking...");
	execSync("pnpm install --frozen-lockfile", { stdio: "inherit" });
}
