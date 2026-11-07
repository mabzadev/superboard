#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkgPath = resolve(repoRoot, "packages/core/package.json");

const RUNTIME_COUPLED = new Set([
	"./ui",
	"./ui/comments",
	"./auth/providers/github-admin",
	"./auth/providers/google-admin",
	"./auth/providers/microsoft-admin",
]);

const RAW_SOURCE = /(?<!\.d)\.tsx?$/;

function targets(value) {
	if (typeof value === "string") return [value];
	if (value && typeof value === "object") return Object.values(value).flatMap(targets);
	return [];
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const offenders = [];
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
	if (RUNTIME_COUPLED.has(key)) continue;
	for (const target of targets(value)) {
		if (RAW_SOURCE.test(target)) offenders.push(`${key} -> ${target}`);
	}
}

if (offenders.length > 0) {
	console.error(
		"[public-source-guard] FAIL -- subpath export(s) ship raw .ts/.tsx source.\n" +
			"Raw source is type-checked by strict consumers and reintroduces the\n" +
			"dual-package identity hazard (#1053). Compile these to dist (.mjs +\n" +
			".d.mts) via tsdown, or -- only if they bridge a consumer-supplied\n" +
			"runtime -- add the key to RUNTIME_COUPLED with a justification.\n",
	);
	for (const o of offenders) console.error("  " + o);
	process.exit(1);
}

console.log(
	`[public-source-guard] OK -- no subpath export ships raw .ts/.tsx ` +
		`(${RUNTIME_COUPLED.size} documented runtime-coupled exception(s)).`,
);
