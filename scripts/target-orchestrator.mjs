#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { generateDevelopmentSecretAssignments } from "./cloudflare-development-secrets.mjs";
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
	targetWithAbsentResources,
} from "./target-compiler.mjs";
import { siteEmailBuildEnvironment } from "./cloudflare-site-build.mjs";

const OPERATIONS = new Set([
	"plan",
	"compile",
	"provision",
	"configure",
	"migrate",
	"start",
	"exercise",
	"deploy",
	"check",
]);

export async function prepareTarget({ targetName, environment, adapter, fresh = false }) {
	const { target: loadedTarget } = await loadTarget(targetName);
	const target = fresh ? targetWithAbsentResources(loadedTarget) : loadedTarget;
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
		fresh,
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
	const prepared = await prepareTarget({
		targetName,
		environment,
		adapter,
		fresh: Boolean(args.fresh),
	});

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
		await configureTarget(prepared);
		buildLocalTarget(prepared);
		await startLocalTarget(prepared, args);
	} else if (operation === "exercise") {
		await assertFreshLocalState(args);
		await configureTarget(prepared, {
			validationOnly: true,
			writeTrackedSiteConfig: false,
		});
		const runtimePrepared =
			adapter === "local"
				? prepared
				: { ...prepared, materialization: materializeTarget(prepared.compiled, "local") };
		migrateLocalTarget(runtimePrepared, args);
		buildLocalTarget(prepared);
		const healthChecks = await startLocalTarget(runtimePrepared, args, { verify: true });
		const exerciseResult = {
			...targetResult(prepared, "exercised"),
			artifactPath: relative(root, artifactPath),
			healthChecks,
		};
		process.stdout.write(
			`SUPERBOARD_FRESH_INSTANCE_WORKERS=${JSON.stringify(exerciseResult)}\n`,
		);
		process.stdout.write(
			`${JSON.stringify(exerciseResult, null, 2)}\n`,
		);
		return;
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
	execute(
		"pnpm",
		["--filter", "@superboard/site...", "build"],
		siteEmailBuildEnvironment(prepared.target, env),
	);
}

async function configureTarget(
	prepared,
	{ validationOnly = false, writeTrackedSiteConfig = true } = {},
) {
	for (const { id: service } of prepared.materialization.services) {
		runNode("cloudflare-config.mjs", [
			"--target",
			prepared.compiled.target,
			"--environment",
			prepared.compiled.environment,
			"--service",
			service,
			...artifactSelectionArgs(prepared),
			...(prepared.materialization.adapter === "local" || validationOnly
				? ["--allow-unprovisioned", "--no-routes"]
				: []),
			...(prepared.fresh ? ["--fresh"] : []),
		]);
	}
	if (prepared.materialization.adapter === "local" && writeTrackedSiteConfig) {
		await writeJsonAtomically(
			resolve(root, "apps/site/wrangler.jsonc"),
			compileLocalSiteConfiguration(prepared.compiled),
			"\t",
		);
		run("pnpm", [
			"exec",
			"prettier",
			"--ignore-path",
			".gitignore",
			"--write",
			"apps/site/wrangler.jsonc",
		]);
	}
}

function buildLocalTarget(prepared) {
	buildLocalSite(prepared);
	run("pnpm", ["identity:build"]);
	runNode("dashboard-cloudflare.mjs", [
		"--target",
		prepared.compiled.target,
		"--environment",
		prepared.compiled.environment,
		"--allow-unprovisioned",
		...(prepared.fresh ? ["--fresh"] : []),
		...artifactSelectionArgs(prepared),
	]);
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
	migrateLocalTarget(prepared, args);
}

function migrateLocalTarget(prepared, args) {
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
			...localStateArgs(args),
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

async function writeJsonAtomically(path, value, indentation = 2) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify(value, null, indentation)}\n`, {
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

async function startLocalTarget(prepared, args, { verify = false } = {}) {
	const secretAssignments = verify
		? await localSecretAssignments(prepared.target, prepared.compiled.environment)
		: {};
	const spawnService = (service) => {
		const configPath = resolve(
			root,
			"deploy/generated",
			`${prepared.compiled.target}-${service.id}-${prepared.compiled.environment}.jsonc`,
		);
		return spawn(
			process.execPath,
			[
				resolve(root, "node_modules/wrangler/bin/wrangler.js"),
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
				...localStateArgs(args),
			],
			{
				cwd: root,
				env: { ...process.env, ...secretAssignments[service.id] },
				stdio: "inherit",
				shell: false,
			},
		);
	};
	if (verify) {
		let stopping = false;
		let rejectChildFailure;
		const childFailure = new Promise((resolvePromise, reject) => {
			rejectChildFailure = reject;
		});
		const children = [];
		try {
			for (const [index, service] of prepared.materialization.services.entries()) {
				const child = spawnService(service);
				children.push(child);
				child.once("error", rejectChildFailure);
				child.once("exit", (code, signal) => {
					if (stopping) return;
					rejectChildFailure(
						new Error(`Local Worker exited before health verification: ${code ?? signal}`),
					);
				});
				if (index < prepared.materialization.services.length - 1) {
					await Promise.race([
						new Promise((resolvePromise) => setTimeout(resolvePromise, 150)),
						childFailure,
					]);
				}
			}
			return await Promise.race([
				verifyLocalTargetHealth(prepared.materialization, secretAssignments),
				childFailure,
			]);
		} finally {
			stopping = true;
			await stopLocalChildren(children);
		}
	}
	const children = await spawnLocalServices(prepared.materialization.services, spawnService);
	await new Promise((resolvePromise, reject) => {
		let settled = false;
		const stop = (skip) => {
			for (const child of children) {
				if (child !== skip && child.exitCode === null) child.kill("SIGTERM");
			}
		};
		for (const child of children) {
			if (child.exitCode !== null) {
				settled = true;
				stop(child);
				reject(new Error(`Local Worker exited with status ${child.exitCode}`));
				return;
			}
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

export async function spawnLocalServices(
	services,
	spawnService,
	pause = (milliseconds) =>
		new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
) {
	const children = [];
	for (const [index, service] of services.entries()) {
		children.push(spawnService(service));
		if (index < services.length - 1) await pause(150);
	}
	return children;
}

async function stopLocalChildren(children) {
	const exits = children.map((child) =>
		child.exitCode === null
			? new Promise((resolvePromise) => child.once("exit", resolvePromise))
			: Promise.resolve(),
	);
	for (const child of children) {
		if (child.exitCode === null) child.kill("SIGINT");
	}
	await Promise.race([
		Promise.all(exits),
		new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
	]);
	for (const child of children) {
		if (child.exitCode === null) child.kill("SIGTERM");
	}
}

export async function verifyLocalTargetHealth(
	materialization,
	secretAssignments,
	{ fetchImpl = fetch, attempts = 120, intervalMs = 500 } = {},
) {
	const checks = materialization.healthChecks.filter(({ kind }) => kind === "worker");
	let receipts = [];
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		receipts = [];
		for (const healthCheck of checks) {
			receipts.push(await probeLocalHealth(healthCheck, secretAssignments, fetchImpl));
		}
		if (receipts.every(({ status }) => status === 200)) return receipts;
		if (attempt < attempts)
			await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
	}
	throw new Error(
		`Local target health verification failed: ${receipts
			.filter(({ status }) => status !== 200)
			.map(({ service, status, error }) => `${service}=${status}${error ? `:${error}` : ""}`)
			.join(", ")}`,
	);
}

async function probeLocalHealth(healthCheck, secretAssignments, fetchImpl) {
	const headers = new Headers();
	if (healthCheck.authentication?.type === "secret") {
		const value = secretAssignments[healthCheck.service]?.[healthCheck.authentication.binding];
		if (!value) {
			return {
				id: healthCheck.id,
				service: healthCheck.service,
				url: healthCheck.url,
				status: 0,
				error: `missing ${healthCheck.authentication.binding}`,
			};
		}
		headers.set(healthCheck.authentication.header, value);
	}
	try {
		const response = await fetchImpl(
			new Request(healthCheck.url, {
				headers,
				signal: AbortSignal.timeout(5_000),
			}),
		);
		return {
			id: healthCheck.id,
			service: healthCheck.service,
			url: healthCheck.url,
			status: response.status,
		};
	} catch (error) {
		return {
			id: healthCheck.id,
			service: healthCheck.service,
			url: healthCheck.url,
			status: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function localSecretAssignments(target, environment) {
	return generateDevelopmentSecretAssignments({
		target,
		environment,
		accountId: "0".repeat(32),
		analyticsToken: ephemeralSecret(),
		appleRootBase64: randomBytes(32).toString("base64"),
		awsSesSmtpUsername: `local-${ephemeralSecret()}`,
		awsSesSmtpPassword: ephemeralSecret(),
		awsSesSnsTopicArn: `arn:aws:sns:eu-central-1:000000000000:${target.target}-${environment}`,
	});
}

function ephemeralSecret() {
	return randomBytes(48).toString("base64url");
}

function localStateArgs(args) {
	const directory = args["local-state"];
	return typeof directory === "string" ? ["--persist-to", resolve(directory)] : [];
}

export async function assertFreshLocalState(args) {
	const directory = args["local-state"];
	if (typeof directory !== "string") {
		throw new Error("The blank Instance exercise requires --local-state");
	}
	try {
		if ((await readdir(resolve(directory))).length > 0) {
			throw new Error("The blank Instance exercise requires an empty local state directory");
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
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
