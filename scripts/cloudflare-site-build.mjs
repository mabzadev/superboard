#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveSitePreviewRoute } from "./cloudflare-site-preview.mjs";
import { loadTarget, parseArgs, root, targetSelectionFromArgs } from "./cloudflare-target.mjs";

export function siteDeploymentArtifact(config, { previewHostname = null } = {}) {
	if (config?.vars?.SUPERBOARD_RELEASE_OPERATIONS !== "disabled") {
		throw new Error("Site target builds must keep release operations disabled");
	}
	if (config?.routes) {
		if (!previewHostname) {
			throw new Error("Site target builds must not acquire a public route");
		}
		if (
			config.routes.length !== 1 ||
			config.routes[0]?.pattern !== previewHostname ||
			config.routes[0]?.custom_domain !== true
		) {
			throw new Error("Site target build does not match the approved preview hostname");
		}
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

export function siteEmailBuildEnvironment(target, env = process.env) {
	return {
		...env,
		SUPERBOARD_SITE_EMAIL_FROM_ADDRESS: target.mail.fromAddress,
		SUPERBOARD_SITE_EMAIL_FROM_NAME: target.mail.fromName,
		...(target.mail.replyToAddress
			? { SUPERBOARD_SITE_EMAIL_REPLY_TO: target.mail.replyToAddress }
			: {}),
	};
}

export async function buildSiteTarget(argv = process.argv.slice(2), execute = run) {
	const args = parseArgs(argv);
	const { targetName, environment } = await targetSelectionFromArgs(args);
	const { target } = await loadTarget(targetName);
	const sitePreviewRoute = resolveSitePreviewRoute({
		requested: Boolean(args["site-preview-route"]),
		service: "site",
		environment,
		hostname: target.domains.site,
	});
	const siteBuildEnvironment = siteEmailBuildEnvironment(target);
	execute("pnpm", ["--dir", "apps/site", "run", "build"], siteBuildEnvironment);
	execute(process.execPath, [
		"scripts/cloudflare-config.mjs",
		"--service",
		"site",
		"--target",
		targetName,
		"--environment",
		environment,
		...(sitePreviewRoute?.cliArgs ?? []),
		...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
	]);
	const generatedPath = resolve(
		root,
		"deploy/generated",
		`${targetName}-site-${environment}.jsonc`,
	);
	const artifactPath = resolve(root, "apps/site/dist/server/wrangler.json");
	const generated = JSON.parse(await readFile(generatedPath, "utf8"));
	await writeFile(
		artifactPath,
		`${JSON.stringify(
			siteDeploymentArtifact(generated, {
				previewHostname: sitePreviewRoute?.hostname ?? null,
			}),
			null,
			2,
		)}\n`,
	);
	return artifactPath;
}

function run(command, args, env = process.env) {
	const result = spawnSync(command, args, {
		cwd: root,
		env,
		stdio: "inherit",
		shell: false,
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await buildSiteTarget();
}
