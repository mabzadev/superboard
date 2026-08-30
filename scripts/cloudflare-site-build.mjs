#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, root, targetSelectionFromArgs } from "./cloudflare-target.mjs";

export function siteDeploymentArtifact(config) {
	if (config?.vars?.SUPERBOARD_RELEASE_OPERATIONS !== "disabled") {
		throw new Error("Site target builds must keep release operations disabled");
	}
	if (config?.routes) {
		throw new Error("Site target builds must not acquire a public route");
	}
	return {
		...config,
		$schema: "../../../node_modules/wrangler/config-schema.json",
		main: "entry.mjs",
		assets: { ...config.assets, directory: "../client" },
		d1_databases: config.d1_databases.map((database) => ({
			...database,
			migrations_dir: "../../migrations",
		})),
	};
}

export async function buildSiteTarget(argv = process.argv.slice(2), execute = run) {
	const args = parseArgs(argv);
	const { targetName, environment } = await targetSelectionFromArgs(args);
	execute("pnpm", ["--dir", "apps/site", "run", "build"]);
	execute(process.execPath, [
		"scripts/cloudflare-config.mjs",
		"--service",
		"site",
		"--target",
		targetName,
		"--environment",
		environment,
		...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
	]);
	const generatedPath = resolve(
		root,
		"deploy/generated",
		`${targetName}-site-${environment}.jsonc`,
	);
	const artifactPath = resolve(root, "apps/site/dist/server/wrangler.json");
	const generated = JSON.parse(await readFile(generatedPath, "utf8"));
	await writeFile(artifactPath, `${JSON.stringify(siteDeploymentArtifact(generated), null, 2)}\n`);
	return artifactPath;
}

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: root,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await buildSiteTarget();
}
