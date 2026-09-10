import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { parseQueueConsumer } from "./cloudflare-billing-consumer.mjs";
import { captureConsoleArtifact, verifyConsoleArtifact } from "./cloudflare-console-artifact.mjs";
import { deploymentOrder } from "./cloudflare-deploy-plan.mjs";
import { parseSecretNames } from "./cloudflare-secret-preflight.mjs";
import { loadTarget, parseArgs, root, targetSelectionFromArgs } from "./cloudflare-target.mjs";
import { consolidateWorkerConfigurations } from "./worker-deployment-groups.mjs";

function execute(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`Command failed: ${command} ${args.join(" ")}\n${result.stderr || result.stdout}`,
		);
	return result.stdout;
}

export async function generateConsolidatedConfiguration({
	targetName,
	environment,
	preflight = false,
	noRoutes = false,
	allowUnprovisioned = false,
	readOnlyConsole = false,
	targetArtifactPath,
	targetArtifactChecksum,
}) {
	const { target } = await loadTarget(targetName);
	const entries = [];
	for (const service of deploymentOrder(target)) {
		const output = execute(process.execPath, [
			"scripts/cloudflare-config.mjs",
			"--target",
			targetName,
			"--environment",
			environment,
			"--service",
			service,
			"--output-suffix",
			"consolidation-input",
			...(targetArtifactPath && targetArtifactChecksum
				? [
						"--target-artifact",
						targetArtifactPath,
						"--target-artifact-checksum",
						targetArtifactChecksum,
					]
				: []),
			...(preflight ? ["--preflight"] : []),
			...(noRoutes ? ["--no-routes"] : []),
			...(allowUnprovisioned ? ["--allow-unprovisioned"] : []),
			...(service === "site" && readOnlyConsole ? ["--read-only-console"] : []),
		]);
		const path = output.trim().split("\n").at(-1);
		entries.push({ service, config: JSON.parse(await readFile(resolve(root, path), "utf8")) });
	}
	const result = consolidateWorkerConfigurations(entries);
	const directory = resolve(root, "deploy/generated");
	await mkdir(directory, { recursive: true });
	const groups = [];
	for (const group of result.groups) {
		const basename = `${targetName}-${environment}-${group.id}-consolidated`;
		if (group.source) {
			group.config.main = `./${basename}.mjs`;
			group.compatibilityConfig.main = group.config.main;
			await writeFile(resolve(directory, `${basename}.mjs`), group.source);
		}
		const configPath = resolve(directory, `${basename}.jsonc`);
		const prepareConfigPath = resolve(directory, `${basename}-prepare.jsonc`);
		await writeFile(
			prepareConfigPath,
			`${JSON.stringify(group.compatibilityConfig, null, "\t")}\n`,
			{ mode: 0o600 },
		);
		await writeFile(configPath, `${JSON.stringify(group.config, null, "\t")}\n`, { mode: 0o600 });
		groups.push({
			id: group.id,
			label: group.label,
			services: group.services,
			workerName: group.config.name,
			configPath: relative(root, configPath),
			prepareConfigPath: group.source ? relative(root, prepareConfigPath) : null,
			secrets: group.secrets,
		});
	}
	const cronTransfers = [];
	for (const transfer of result.cronTransfers) {
		const source = entries.find(({ service }) => service === transfer.service).config;
		const configPath = resolve(
			directory,
			`${targetName}-${environment}-${transfer.service}-retire-crons.jsonc`,
		);
		const config = {
			...source,
			triggers: { ...source.triggers, crons: [] },
		};
		delete config.queues;
		await writeFile(configPath, `${JSON.stringify(config, null, "\t")}\n`, { mode: 0o600 });
		cronTransfers.push({ ...transfer, configPath: relative(root, configPath) });
	}
	const manifest = {
		schemaVersion: 1,
		target: targetName,
		environment,
		checksum: result.checksum,
		groups,
		retiredWorkerCandidates: result.retiredWorkers,
		queueTransfers: result.queueTransfers,
		cronTransfers,
		retirement: "requires-drain-and-routing-verification",
	};
	const manifestPath = resolve(directory, `${targetName}-${environment}-deployments.json`);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return { ...manifest, manifestPath };
}

export function assertConsolidatedDeploymentReady(manifest, input = {}, run = execute) {
	const env = input.env ?? process.env;
	let consolidated = true;
	const groupLayouts = {};
	for (const group of manifest.groups) {
		if (group.secrets.length) {
			const names = new Set(
				parseSecretNames(
					run("pnpm", ["exec", "wrangler", "secret", "list", "--config", group.configPath], {
						env,
					}),
				),
			);
			const missing = group.secrets.filter(({ name }) => !env[name] && !names.has(name));
			if (missing.length)
				throw new Error(`GROUPED_SECRETS_REQUIRED:${missing.map(({ name }) => name).join(",")}`);
		}
		if (!group.prepareConfigPath || input.initialInstall) continue;
		const current = JSON.parse(
			run(
				"pnpm",
				["exec", "wrangler", "deployments", "status", "--name", group.workerName, "--json"],
				{ env },
			),
		);
		const versions = current?.versions;
		if (!Array.isArray(versions) || versions.length !== 1 || versions[0].percentage !== 100)
			throw new Error(`DEPLOYMENT_NOT_STABLE:${group.workerName}`);
		const version = JSON.parse(
			run(
				"pnpm",
				[
					"exec",
					"wrangler",
					"versions",
					"view",
					versions[0].version_id,
					"--name",
					group.workerName,
					"--json",
				],
				{ env },
			),
		);
		const bindings = version.resources?.bindings ?? version.bindings;
		if (!Array.isArray(bindings))
			throw new Error(`DEPLOYMENT_BINDINGS_UNAVAILABLE:${group.workerName}`);
		const layout = bindings.find(({ name }) => name === "SUPERBOARD_DEPLOYMENT_LAYOUT")?.text;
		groupLayouts[group.id] = layout ?? "legacy";
		consolidated &&= layout === "consolidated";
	}
	if (!input.initialInstall && !consolidated)
		for (const name of manifest.retiredWorkerCandidates) {
			run("pnpm", ["exec", "wrangler", "deployments", "list", "--name", name, "--json"], {
				env,
			});
		}
	return { consolidated, groupLayouts };
}

function queueOwner(transfer, manifest, env, run) {
	const destination = manifest.groups.find(({ workerName }) => workerName === transfer.to);
	if (!destination) throw new Error(`QUEUE_TRANSFER_DESTINATION_MISSING:${transfer.queue}`);
	const output = run(
		"pnpm",
		["exec", "wrangler", "queues", "info", transfer.queue, "--config", destination.configPath],
		{ env },
	);
	if (!/^[ \t]*Number of Consumers:[ \t]*\d+/mu.test(output))
		throw new Error(`QUEUE_TRANSFER_STATE_UNAVAILABLE:${transfer.queue}`);
	const owner = parseQueueConsumer(output);
	if (owner !== null && owner !== transfer.from && owner !== transfer.to)
		throw new Error(`QUEUE_TRANSFER_OWNER_MISMATCH:${transfer.queue}`);
	return owner;
}

export async function prepareConsolidatedDeployment(input, run = execute) {
	const env = input.env ?? process.env;
	run(
		process.execPath,
		[
			"scripts/cloudflare-site-build.mjs",
			"--target",
			input.targetName,
			"--environment",
			input.environment,
			...(input.noRoutes || input.preflight || input.dryRun ? ["--no-routes"] : []),
			...(input.readOnlyConsole ? ["--read-only-console"] : []),
			...(input.targetArtifactPath && input.targetArtifactChecksum
				? [
						"--target-artifact",
						input.targetArtifactPath,
						"--target-artifact-checksum",
						input.targetArtifactChecksum,
					]
				: []),
			...(input.allowUnprovisioned ? ["--allow-unprovisioned"] : []),
		],
		{ stdio: "inherit", env },
	);
	const manifest = await generateConsolidatedConfiguration(input);
	const consoleGroup = manifest.groups.find((group) => group.id === "console");
	if (consoleGroup) {
		manifest.consoleArtifact = await captureConsoleArtifact(resolve(root, consoleGroup.configPath));
		await writeFile(manifest.manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	}
	return manifest;
}

export async function runConsolidatedDeployment(input, run = execute) {
	if (!input.manifest && !input.dryRun) throw new Error("PREPARED_DEPLOYMENT_REQUIRED");
	const manifest = input.manifest ?? (await prepareConsolidatedDeployment(input, run));
	const consoleGroup = manifest.groups.find((group) => group.id === "console");
	if (consoleGroup && !manifest.consoleArtifact) {
		throw new Error("PREPARED_CONSOLE_ARTIFACT_REQUIRED");
	}
	const consoleArtifact = consoleGroup ? manifest.consoleArtifact : null;
	if (consoleArtifact && resolve(root, consoleGroup.configPath) !== consoleArtifact.configPath) {
		throw new Error("PREPARED_CONSOLE_CONFIG_MISMATCH");
	}
	if (consoleArtifact) await verifyConsoleArtifact(consoleArtifact);
	const env = input.env ?? process.env;
	const readiness =
		input.readiness ??
		(input.dryRun ? null : assertConsolidatedDeploymentReady(manifest, input, run));
	const mode = input.dryRun ? "dry-run" : input.uploadOnly ? "upload" : "deploy";
	const deploy = async (group, path) => {
		if (consoleArtifact) await verifyConsoleArtifact(consoleArtifact);
		const values = Object.fromEntries(
			group.secrets.filter(({ name }) => env[name]).map(({ name }) => [name, env[name]]),
		);
		let secretDirectory;
		try {
			let secretPath;
			if (!input.dryRun && Object.keys(values).length) {
				secretDirectory = await mkdtemp(resolve(tmpdir(), "superboard-deploy-secrets-"));
				secretPath = resolve(secretDirectory, "secrets.json");
				await writeFile(secretPath, JSON.stringify(values), { mode: 0o600 });
			}
			return run(
				"pnpm",
				[
					"exec",
					"wrangler",
					...(input.uploadOnly ? ["versions", "upload"] : ["deploy"]),
					"--config",
					path,
					...(secretPath ? ["--secrets-file", secretPath] : []),
					...(input.dryRun ? ["--dry-run"] : []),
				],
				{ stdio: "inherit", env },
			);
		} finally {
			if (secretDirectory) await rm(secretDirectory, { recursive: true, force: true });
		}
	};
	if (!input.uploadOnly && !input.dryRun) {
		for (const transfer of manifest.queueTransfers) {
			const owner = queueOwner(transfer, manifest, env, run);
			if (input.initialInstall && owner !== null && owner !== transfer.to)
				throw new Error(`INITIAL_INSTALL_QUEUE_ALREADY_OWNED:${transfer.queue}`);
		}
		if (!input.initialInstall && !readiness?.consolidated)
			for (const group of manifest.groups)
				if (
					group.prepareConfigPath &&
					!["preparing", "consolidated"].includes(readiness?.groupLayouts?.[group.id])
				)
					await deploy(group, group.prepareConfigPath);
		for (const transfer of manifest.queueTransfers) {
			const owner = queueOwner(transfer, manifest, env, run);
			if (owner === transfer.to || owner === null) continue;
			const destination = manifest.groups.find(({ workerName }) => workerName === transfer.to);
			run(
				"pnpm",
				[
					"exec",
					"wrangler",
					"queues",
					"consumer",
					"remove",
					transfer.queue,
					owner,
					"--config",
					destination.configPath,
				],
				{ env },
			);
		}
	}
	const order = [
		"monitoring",
		"api",
		"communications",
		"files",
		"auth",
		"support",
		"analytics",
		"automations",
		"payments",
		"custom",
		"console",
	];
	const groups = manifest.groups.toSorted((left, right) => {
		const a = order.indexOf(left.id),
			b = order.indexOf(right.id);
		return (a < 0 ? 8 : a) - (b < 0 ? 8 : b);
	});
	for (const group of groups) {
		console.log(`${mode}: ${group.label} (${group.services.join(", ")})`);
		if (
			!input.uploadOnly &&
			!input.dryRun &&
			!input.initialInstall &&
			!readiness?.consolidated &&
			readiness?.groupLayouts?.[group.id] !== "consolidated"
		)
			for (const transfer of manifest.cronTransfers ?? [])
				if (transfer.to === group.workerName)
					run("pnpm", ["exec", "wrangler", "triggers", "deploy", "--config", transfer.configPath], {
						env,
					});
		await deploy(group, group.configPath);
	}
	if (!input.uploadOnly && !input.dryRun)
		for (const transfer of manifest.queueTransfers)
			if (queueOwner(transfer, manifest, env, run) !== transfer.to)
				throw new Error(`QUEUE_TRANSFER_NOT_COMPLETE:${transfer.queue}`);
	return manifest;
}

async function main() {
	const args = parseArgs();
	const { targetName, environment } = await targetSelectionFromArgs(args, process.env, {
		allowReference: true,
	});
	const input = {
		targetName,
		environment,
		preflight: Boolean(args.preflight || args["dry-run"]),
		noRoutes: Boolean(args["no-routes"]),
		allowUnprovisioned: Boolean(args["allow-unprovisioned"]),
		readOnlyConsole: Boolean(args["read-only-console"]),
		dryRun: Boolean(args["dry-run"]),
	};
	const result = args.prepare
		? await prepareConsolidatedDeployment(input)
		: input.dryRun
			? await runConsolidatedDeployment(input)
			: await generateConsolidatedConfiguration(input);
	console.log(
		JSON.stringify(
			{
				manifest: relative(root, result.manifestPath),
				deployments: result.groups.length,
				groups: result.groups.map(({ id, services }) => ({ id, services })),
				retiredWorkerCandidates: result.retiredWorkerCandidates,
			},
			null,
			2,
		),
	);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
	await main();
