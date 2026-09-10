import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, open, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

import {
	fetchAppleRootG3,
	generateDevelopmentSecretAssignments,
} from "./cloudflare-development-secrets.mjs";
import { loadTarget, parseArgs, root } from "./cloudflare-target.mjs";
import {
	compileLocalSiteConfiguration,
	compileTarget,
	materializeTarget,
} from "./target-compiler.mjs";

const args = parseArgs();
const project = JSON.parse(await readFile(resolve(root, "superboard.project.json"), "utf8"));
const targetName = args.target ?? project.development.target;
const directory = resolve(
	args["state-directory"] ?? resolve(homedir(), ".local/share/superboard/local", targetName),
);
const state = resolve(directory, "state");
const pidPath = resolve(directory, "process.json");
if (args.stop) {
	try {
		const { pid } = JSON.parse(await readFile(pidPath, "utf8"));
		const processName = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
			encoding: "utf8",
		}).stdout;
		if (Number.isSafeInteger(pid) && processName?.includes("scripts/local-start.mjs"))
			process.kill(pid, "SIGTERM");
		await rm(pidPath, { force: true });
		console.log("Local SuperBoard stopped.");
	} catch (error) {
		if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
	}
} else {
	await start();
}

function run(command, values, options = {}) {
	const result = spawnSync(command, values, {
		cwd: root,
		env: process.env,
		stdio: "inherit",
		...options,
	});
	if (result.status !== 0) throw new Error(`Local setup failed: ${command} ${values.join(" ")}`);
}

async function start() {
	try {
		const existing = JSON.parse(await readFile(pidPath, "utf8"));
		const command = spawnSync("ps", ["-p", String(existing.pid), "-o", "command="], {
			encoding: "utf8",
		}).stdout;
		if (command?.includes("scripts/local-start.mjs")) {
			console.log(`SuperBoard is already running at http://127.0.0.1:${existing.port}`);
			return;
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}

	await mkdir(directory, { recursive: true, mode: 0o700 });
	await mkdir(state, { recursive: true, mode: 0o700 });
	await mkdir(resolve(directory, "logs"), { recursive: true, mode: 0o700 });
	const { target } = await loadTarget(targetName);
	const compiled = await compileTarget(target, "local");
	const materialization = materializeTarget(compiled, "local");
	if (!args["skip-build"]) {
		run("pnpm", [
			"--filter",
			"@superboard/contracts",
			"--filter",
			"@superboard/supbrd-core",
			"--filter",
			"@superboard/supbrd-runtime-plugins",
			"--workspace-concurrency=1",
			"-r",
			"build",
		]);
		run("pnpm", ["identity:build"]);
	}
	run(process.execPath, [
		"scripts/target-orchestrator.mjs",
		"configure",
		"--target",
		targetName,
		"--environment",
		"local",
		"--adapter",
		"local",
		"--release-operations",
	]);
	const secretsPath = resolve(directory, "secrets.json");
	let secrets;
	try {
		secrets = JSON.parse(await readFile(secretsPath, "utf8"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
		secrets = await generateDevelopmentSecretAssignments({
			target,
			environment: "local",
			accountId: "0".repeat(32),
			analyticsToken: "",
			appleRootBase64: await fetchAppleRootG3(),
		});
		try {
			const existing = parseEnv(await readFile(resolve(root, "apps/site/.env"), "utf8"));
			for (const name of [
				"SITE_OPERATOR_BRIDGE_TOKEN",
				"SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY",
				"EMDASH_ENCRYPTION_KEY",
				"SUPERBOARD_RELEASE_PRIVATE_JWK",
			])
				if (existing[name]) secrets.site[name] = existing[name];
			secrets.api.SITE_OPERATOR_BRIDGE_TOKEN = secrets.site.SITE_OPERATOR_BRIDGE_TOKEN;
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		await writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
	}
	for (const service of materialization.services) {
		const values = secrets[service.id] ?? {};
		const lines = Object.entries(values).map(([name, value]) => {
			if (String(value).includes("'") || String(value).includes("\n"))
				throw new Error(`Unsupported local secret encoding: ${name}`);
			return `${name}='${value}'`;
		});
		await writeFile(resolve(directory, `${service.id}.env`), `${lines.join("\n")}\n`, {
			mode: 0o600,
		});
	}
	for (const migration of materialization.migrations) {
		const config =
			migration.service === "site"
				? resolve(root, "apps/site/wrangler.jsonc")
				: resolve(root, "deploy/generated", `${targetName}-${migration.service}-local.jsonc`);
		const value =
			migration.service === "site"
				? compileLocalSiteConfiguration(compiled)
				: JSON.parse(await readFile(config, "utf8"));
		const database = value.d1_databases.find((entry) => entry.binding === migration.binding);
		run(process.execPath, [
			"node_modules/wrangler/bin/wrangler.js",
			"d1",
			"migrations",
			"apply",
			database.database_name,
			"--local",
			"--config",
			config,
			"--persist-to",
			state,
		]);
	}
	const children = [];
	let closing = false;
	const stop = () => {
		if (closing) return;
		closing = true;
		for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
		void rm(pidPath, { force: true });
	};
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	for (const service of materialization.services.filter((service) => service.id !== "site")) {
		const log = await open(resolve(directory, "logs", `${service.id}.log`), "a", 0o600);
		const child = spawn(
			process.execPath,
			[
				"node_modules/wrangler/bin/wrangler.js",
				"dev",
				"--config",
				resolve(root, "deploy/generated", `${targetName}-${service.id}-local.jsonc`),
				"--local",
				"--env-file",
				resolve(directory, `${service.id}.env`),
				"--persist-to",
				state,
				"--ip",
				"127.0.0.1",
				"--port",
				String(service.localEndpoint.port),
				"--inspector-port",
				String(service.localEndpoint.inspectorPort),
				"--show-interactive-dev-session=false",
			],
			{ cwd: root, env: process.env, stdio: ["ignore", log.fd, log.fd] },
		);
		await log.close();
		children.push(child);
		child.once("error", (error) => {
			console.error(`Local ${service.id} failed: ${error.message}`);
			process.exitCode = 1;
			stop();
		});
		child.once("exit", (code, signal) => {
			if (!closing) {
				console.error(`Local ${service.id} stopped: ${signal ?? code}`);
				process.exitCode = 1;
				stop();
			}
		});
	}
	const log = await open(resolve(directory, "logs/site.log"), "a", 0o600);
	const site = spawn(
		process.execPath,
		[
			resolve(root, "apps/site/node_modules/astro/bin/astro.mjs"),
			"dev",
			"--host",
			"127.0.0.1",
			"--port",
			String(args.port ?? 4321),
		],
		{
			cwd: resolve(root, "apps/site"),
			env: {
				...process.env,
				...secrets.site,
				ASTRO_DEV_BACKGROUND: "1",
				SUPERBOARD_LOCAL_STATE_DIRECTORY: state,
			},
			stdio: ["ignore", log.fd, log.fd],
		},
	);
	await log.close();
	children.push(site);
	site.once("error", (error) => {
		console.error(`Local Site failed: ${error.message}`);
		process.exitCode = 1;
		stop();
	});
	site.once("exit", (code, signal) => {
		if (!closing) {
			console.error(`Local Site stopped: ${signal ?? code}`);
			process.exitCode = 1;
			stop();
		}
	});
	await writeFile(
		pidPath,
		JSON.stringify(
			{
				pid: process.pid,
				target: targetName,
				port: Number(args.port ?? 4321),
				children: children.map((child) => child.pid),
			},
			null,
			2,
		),
		{ mode: 0o600 },
	);
	const siteUrl = `http://127.0.0.1:${args.port ?? 4321}`;
	const deadline = Date.now() + 120000;
	let ready = false;
	while (!closing && Date.now() < deadline) {
		try {
			const response = await fetch(siteUrl, {
				redirect: "manual",
				signal: AbortSignal.timeout(3000),
			});
			await response.body?.cancel();
			if (response.status < 500) {
				ready = true;
				break;
			}
		} catch {
			ready = false;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
	}
	if (!ready) {
		stop();
		throw new Error("Local SuperBoard did not become ready. Check the service logs.");
	}
	console.log(`SuperBoard: ${siteUrl}`);
	console.log(`Local logs: ${resolve(directory, "logs")}`);
	await Promise.all(
		children.map((child) => new Promise((resolveExit) => child.once("exit", resolveExit))),
	);
	await rm(pidPath, { force: true });
}
