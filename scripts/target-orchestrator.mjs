#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	environmentFromArgs,
	loadTarget,
	parseArgs,
	root,
	targetNameFromArgs,
} from "./cloudflare-target.mjs";
import {
	assertTargetGraphParity,
	buildTargetOperationPlan,
	compileLocalSiteConfiguration,
	compileTarget,
	materializeTarget,
} from "./target-compiler.mjs";
import { siteEmailBuildEnvironment } from "./cloudflare-site-build.mjs";

const OPERATIONS = new Set([
	"plan",
	"compile",
	"provision",
	"configure",
	"migrate",
	"start",
	"deploy",
	"check",
]);

export async function prepareTarget({ targetName, environment, adapter }) {
	const { target } = await loadTarget(targetName);
	const compiled = await compileTarget(target, environment);
	const materialization = materializeTarget(compiled, adapter);
	const parityEnvironment =
		environment === "local" && target.environments.development
			? "development"
			: environment !== "local" && target.environments.local
				? "local"
				: null;
	if (parityEnvironment) {
		const parityAdapter = parityEnvironment === "local" ? "local" : "cloudflare";
		const parityTarget = materializeTarget(
			await compileTarget(target, parityEnvironment),
			parityAdapter,
		);
		assertTargetGraphParity([materialization, parityTarget]);
	}
	return {
		target,
		compiled,
		materialization,
		plan: buildTargetOperationPlan(materialization),
	};
}

async function main(argv = process.argv.slice(2)) {
	const operation = argv[0] && !argv[0].startsWith("--") ? argv[0] : "plan";
	if (!OPERATIONS.has(operation)) {
		throw new Error(`Operation must be one of: ${[...OPERATIONS].join(", ")}`);
	}
	const args = parseArgs(operation === argv[0] ? argv.slice(1) : argv);
	const targetName = targetNameFromArgs(args);
	const environment = environmentFromArgs(args);
	const adapter = args.adapter ?? (environment === "local" ? "local" : "cloudflare");
	if (adapter === "local" && environment !== "local") {
		throw new Error("The local adapter requires --environment local");
	}
	const prepared = await prepareTarget({ targetName, environment, adapter });

	if (operation === "plan") {
		process.stdout.write(`${JSON.stringify(prepared.plan, null, 2)}\n`);
		return;
	}
	if (operation === "check") {
		await checkGeneratedConfiguration(prepared);
		process.stdout.write(`${JSON.stringify(targetResult(prepared, "checked"), null, 2)}\n`);
		return;
	}

	const artifactPath = await writeTargetArtifact(prepared.compiled);
	prepared.artifactPath = artifactPath;
	if (operation === "compile") {
		process.stdout.write(
			`${JSON.stringify({ ...targetResult(prepared, "compiled"), artifactPath: relative(root, artifactPath) }, null, 2)}\n`,
		);
		return;
	}
	if (operation === "provision") {
		if (adapter === "local") {
			await configureTarget(prepared);
		} else {
			runNode(
				"cloudflare-bootstrap.mjs",
				targetArgs(prepared, args, ["remote", "apply", "confirm", "fresh-support-install"]),
			);
		}
	} else if (operation === "configure") {
		await configureTarget(prepared);
	} else if (operation === "migrate") {
		await configureTarget(prepared);
		migrateTarget(prepared, args);
	} else if (operation === "start") {
		if (adapter !== "local") throw new Error("Start is available only locally");
		buildLocalSite(prepared);
		await configureTarget(prepared);
		await startLocalTarget(prepared);
	} else if (operation === "deploy") {
		if (adapter !== "cloudflare") {
			throw new Error("Deploy requires the Cloudflare adapter");
		}
		await configureTarget(prepared);
		const service = typeof args.service === "string" ? args.service : "all";
		runNode(
			service === "all" ? "cloudflare-deploy-all.mjs" : "cloudflare-deploy.mjs",
			targetArgs(prepared, args, [
				"service",
				"plan",
				"preflight",
				"upload-only",
				"no-routes",
				"site-preview-route",
				"release-operations",
				"backup-directory",
				"identity-cutover-receipt",
				"identity-cutover-sha256",
			]),
		);
	}
	process.stdout.write(
		`${JSON.stringify({ ...targetResult(prepared, operation), artifactPath: relative(root, artifactPath) }, null, 2)}\n`,
	);
}

export function buildLocalSite(prepared, execute = run, env = process.env) {
	execute("pnpm", ["site:build"], siteEmailBuildEnvironment(prepared.target, env));
}

async function configureTarget(prepared) {
	for (const { id: service } of prepared.materialization.services) {
		runNode("cloudflare-config.mjs", [
			"--target",
			prepared.compiled.target,
			"--environment",
			prepared.compiled.environment,
			"--service",
			service,
			...artifactSelectionArgs(prepared),
			...(prepared.materialization.adapter === "local"
				? ["--allow-unprovisioned", "--no-routes"]
				: []),
		]);
	}
	if (prepared.materialization.adapter === "local") {
		await writeJsonAtomically(
			resolve(root, "apps/site/wrangler.jsonc"),
			compileLocalSiteConfiguration(prepared.compiled),
		);
	}
}

function migrateTarget(prepared, args) {
	if (prepared.materialization.adapter === "cloudflare") {
		const apply = Boolean(args.apply);
		runNode("cloudflare-d1-converge.mjs", [
			apply ? "apply" : "plan",
			"--target",
			prepared.compiled.target,
			"--environment",
			prepared.compiled.environment,
			"--service",
			typeof args.service === "string" ? args.service : "all",
			...artifactSelectionArgs(prepared),
			...(apply ? ["--apply"] : []),
			...option(args, "confirm"),
			...option(args, "backup-directory"),
			...(args["remote-read"] ? ["--remote-read"] : []),
		]);
		return;
	}
	const resources = new Map(
		prepared.materialization.resources.map((resource) => [resource.key, resource]),
	);
	for (const migration of prepared.materialization.migrations) {
		const binding = prepared.materialization.bindings.find(
			(entry) =>
				entry.service === migration.service &&
				entry.binding === migration.binding &&
				entry.resourceKey,
		);
		const database = binding ? resources.get(binding.resourceKey) : null;
		if (!database) {
			throw new Error(`No local D1 resource for ${migration.service}`);
		}
		const configPath = resolve(
			root,
			"deploy/generated",
			`${prepared.compiled.target}-${migration.service}-${prepared.compiled.environment}.jsonc`,
		);
		run("npx", [
			"wrangler",
			"d1",
			"migrations",
			"apply",
			database.name,
			"--local",
			"--config",
			configPath,
		]);
	}
}

async function checkGeneratedConfiguration(prepared) {
	if (prepared.materialization.adapter !== "local") return;
	const path = resolve(root, "apps/site/wrangler.jsonc");
	const expected = compileLocalSiteConfiguration(prepared.compiled);
	const actual = parseJsonc(await readFile(path, "utf8"), path);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			"Local Site configuration drift: run target-orchestrator configure for the local target",
		);
	}
}

async function writeTargetArtifact(compiled) {
	const path = resolve(
		root,
		"deploy/generated",
		`${compiled.target}-${compiled.environment}-target.json`,
	);
	await writeJsonAtomically(path, compiled);
	return path;
}

async function writeJsonAtomically(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}

function targetArgs(prepared, args, forwarded) {
	return [
		"--target",
		prepared.compiled.target,
		"--environment",
		prepared.compiled.environment,
		...artifactSelectionArgs(prepared),
		...forwarded.flatMap((name) => option(args, name)),
	];
}

function artifactSelectionArgs(prepared) {
	if (!prepared.artifactPath) {
		throw new Error("Target artifact must be written before executing an operation");
	}
	return [
		"--target-artifact",
		prepared.artifactPath,
		"--target-artifact-checksum",
		prepared.compiled.checksum,
	];
}

function option(args, name) {
	const value = args[name];
	if (value === true) return [`--${name}`];
	return typeof value === "string" ? [`--${name}`, value] : [];
}

function runNode(script, args) {
	run(process.execPath, [resolve(root, "scripts", script), ...args]);
}

async function startLocalTarget(prepared) {
	const children = prepared.materialization.services.map((service) => {
		const configPath = resolve(
			root,
			"deploy/generated",
			`${prepared.compiled.target}-${service.id}-${prepared.compiled.environment}.jsonc`,
		);
		return spawn(
			"npx",
			[
				"wrangler",
				"dev",
				"--config",
				configPath,
				"--local",
				"--ip",
				service.localEndpoint.host,
				"--port",
				String(service.localEndpoint.port),
				"--inspector-port",
				String(service.localEndpoint.inspectorPort),
				"--show-interactive-dev-session=false",
			],
			{ cwd: root, env: process.env, stdio: "inherit", shell: false },
		);
	});
	await new Promise((resolvePromise, reject) => {
		let settled = false;
		const stop = (skip) => {
			for (const child of children) {
				if (child !== skip && child.exitCode === null) child.kill("SIGTERM");
			}
		};
		for (const child of children) {
			child.once("error", (error) => {
				if (settled) return;
				settled = true;
				stop(child);
				reject(error);
			});
			child.once("exit", (code, signal) => {
				if (settled) return;
				settled = true;
				stop(child);
				if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
					resolvePromise();
				} else {
					reject(new Error(`Local Worker exited with status ${code ?? signal}`));
				}
			});
		}
		process.once("SIGINT", () => {
			if (settled) return;
			settled = true;
			stop(null);
			resolvePromise();
		});
	});
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

function targetResult(prepared, operation) {
	return {
		operation,
		target: prepared.compiled.target,
		environment: prepared.compiled.environment,
		adapter: prepared.materialization.adapter,
		artifactChecksum: prepared.compiled.checksum,
		graphChecksum: prepared.compiled.graphChecksum,
	};
}

function parseJsonc(source, label) {
	try {
		return JSON.parse(
			source
				.replace(/\/\*[\s\S]*?\*\//gu, "")
				.replace(/^\s*\/\/.*$/gmu, "")
				.replace(/,\s*([}\]])/gu, "$1"),
		);
	} catch (error) {
		throw new Error(`${label} is not valid JSONC: ${error.message}`, { cause: error });
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	await main();
}
