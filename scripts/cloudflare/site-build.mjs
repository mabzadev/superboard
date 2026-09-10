#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertPublicRoutingReady } from "./public-routing-gate.mjs";
import { resolveSitePreviewRoute, resolveSiteReleaseOperations } from "./site-preview.mjs";
import { compiledTargetFromArgs } from "./target-compiler.mjs";
import { loadTarget, parseArgs, root, targetSelectionFromArgs } from "./target.mjs";

export function siteDeploymentArtifact(
	config,
	{ previewHostname = null, releaseOperations = false, deploymentHostnames = [] } = {},
) {
	if (
		config?.vars?.SUPERBOARD_RELEASE_OPERATIONS !== "disabled" &&
		!(
			releaseOperations &&
			(previewHostname || deploymentHostnames.length > 0) &&
			config?.vars?.SUPERBOARD_RELEASE_OPERATIONS === "enabled"
		)
	) {
		throw new Error("Site target builds must keep release operations disabled");
	}
	if (config?.routes?.length) {
		if (!previewHostname && deploymentHostnames.length === 0) {
			throw new Error("Site target builds must not acquire a public route");
		}
		if (
			previewHostname &&
			(config.routes.length !== 1 ||
				config.routes[0]?.pattern !== previewHostname ||
				config.routes[0]?.custom_domain !== true)
		) {
			throw new Error("Site target build does not match the approved preview hostname");
		}
		if (
			!previewHostname &&
			config.routes.some(
				(route) => route.custom_domain !== true || !deploymentHostnames.includes(route.pattern),
			)
		) {
			throw new Error("Site target build does not match the compiled target hostnames");
		}
	}
	return {
		...config,
		$schema: "../../../../node_modules/wrangler/config-schema.json",
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
	const compiledTarget = await compiledTargetFromArgs(target, environment, args);
	const noRoutes = Boolean(args["no-routes"] || args.preflight || args["dry-run"]);
	const sitePreviewRoute = resolveSitePreviewRoute({
		requested: Boolean(args["site-preview-route"]),
		service: "site",
		environment,
		hostname: target.domains.site,
		noRoutes,
	});
	const siteReleaseOperations = resolveSiteReleaseOperations({
		requested: Boolean(args["release-operations"]),
		service: "site",
		environment,
		sitePreviewRoute,
		publicRoutesEnabled: assertPublicRoutingReady(target, environment).routesEnabled && !noRoutes,
		readOnly: Boolean(args["read-only-console"]),
	});
	const siteBuildEnvironment = siteEmailBuildEnvironment(target);
	execute("pnpm", ["--dir", "apps/site", "run", "build"], siteBuildEnvironment);
	execute(process.execPath, [
		"scripts/cloudflare/config.mjs",
		"--service",
		"site",
		"--target",
		targetName,
		"--environment",
		environment,
		...(noRoutes ? ["--no-routes"] : []),
		...(args["read-only-console"] ? ["--read-only-console"] : []),
		...(args["target-artifact"]
			? [
					"--target-artifact",
					args["target-artifact"],
					"--target-artifact-checksum",
					args["target-artifact-checksum"],
				]
			: []),
		...(sitePreviewRoute?.cliArgs ?? []),
		...siteReleaseOperations.cliArgs,
		...(args["allow-unprovisioned"] ? ["--allow-unprovisioned"] : []),
	]);
	const generatedPath = resolve(root, "infra/generated", `${targetName}-site-${environment}.jsonc`);
	const artifactPath = resolve(root, "apps/site/dist/server/wrangler.json");
	const generated = JSON.parse(await readFile(generatedPath, "utf8"));
	await writeFile(
		artifactPath,
		`${JSON.stringify(
			siteDeploymentArtifact(generated, {
				previewHostname: sitePreviewRoute?.hostname ?? null,
				releaseOperations: siteReleaseOperations.value === "enabled",
				deploymentHostnames: compiledTarget.materialization.routes
					.filter((route) => route.service === "site")
					.map((route) => route.hostname),
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
