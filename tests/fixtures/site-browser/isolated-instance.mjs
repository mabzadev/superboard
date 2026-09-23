import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	cp,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readdir,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { parse } from "jsonc-parser";

import {
	generateDevelopmentSecretAssignments,
	fetchAppleRootG3,
} from "../../../scripts/cloudflare/development-secrets.mjs";
import { healthPathForService } from "../../../scripts/cloudflare/services.mjs";
import {
	compileLocalSiteConfiguration,
	compileTarget,
	materializeTarget,
} from "../../../scripts/cloudflare/target-compiler.mjs";
import { loadTarget, root } from "../../../scripts/cloudflare/target.mjs";
import { waitForLocalListener } from "../../../scripts/local/start.mjs";
import { stopOwnedProcesses } from "./owned-processes.mjs";

const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");

export async function createIsolatedInstance() {
	const directory = await realpath(await mkdtemp(join(tmpdir(), "superboard-menu-")));
	const suffix = `e2e-${randomUUID().slice(0, 8)}`;
	const children = new Map();
	const generated = [];
	const state = join(directory, "state");
	const site = join(directory, "apps/site");
	const logs = join(directory, "logs");
	await mkdir(logs, { recursive: true });
	async function stop() {
		await stopOwnedProcesses(children);
		await Promise.all(generated.map((path) => rm(path, { force: true })));
	}
	async function command(id, args, options = {}, background = false) {
		const log = await open(join(logs, `${id}.log`), "a", 0o600);
		const child = spawn(process.execPath, args, {
			detached: background,
			cwd: root,
			env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
			...options,
			stdio: ["ignore", log.fd, log.fd],
		});
		await log.close();
		child.detachedGroup = background;
		children.set(id, child);
		if (background) return child;
		const [code] = await once(child, "exit");
		if (code !== 0) throw new Error(`${id} failed (${code}); see ${join(logs, `${id}.log`)}`);
	}
	try {
		const { target } = await loadTarget("mbza-development");
		const compiled = await compileTarget(target, "local");
		const materialized = materializeTarget(compiled, "local");
		const names = new Map(
			materialized.services.map(({ workerName }) => [workerName, `${workerName}-${suffix}`]),
		);
		const secrets = await generateDevelopmentSecretAssignments({
			target,
			environment: "local",
			accountId: "0".repeat(32),
			analyticsToken: "",
			appleRootBase64: await fetchAppleRootG3(),
		});
		await mkdir(dirname(site), { recursive: true });
		await cp(resolve(root, "apps/site"), site, {
			recursive: true,
			filter: (path) =>
				!["node_modules", ".astro", ".wrangler", "dist", "test-results"].includes(basename(path)) &&
				!basename(path).startsWith(".env") &&
				!basename(path).startsWith(".dev.vars"),
		});
		for (const name of ["packages", "scripts", "tests", "node_modules"])
			await symlink(resolve(root, name), join(directory, name));
		await mkdir(join(site, "node_modules"));
		for (const name of await readdir(resolve(root, "apps/site/node_modules"))) {
			if (!name.startsWith(".") && name !== "emdash")
				await symlink(
					resolve(root, "apps/site/node_modules", name),
					join(site, "node_modules", name),
				);
		}
		const core = join(site, "node_modules/emdash");
		await cp(resolve(root, "packages/core"), core, {
			recursive: true,
			filter: (path) => basename(path) !== "node_modules",
		});
		await symlink(resolve(root, "packages/core/node_modules"), join(core, "node_modules"));
		await writeFile(
			join(site, "isolated.config.mjs"),
			`import config from './astro.config.mjs';\nexport default {...config, vite: {...config.vite, server: {...config.vite.server, fs: {allow: ${JSON.stringify([root, directory])}}}}};\n`,
		);
		const configs = new Map();
		for (const service of materialized.services) {
			let config;
			if (service.id === "site") config = compileLocalSiteConfiguration(compiled);
			else {
				const path = resolve(
					root,
					`infra/generated/${target.target}-${service.id}-local-${suffix}.jsonc`,
				);
				generated.push(path);
				await command(`configure-${service.id}`, [
					"scripts/cloudflare/config.mjs",
					"--target",
					target.target,
					"--environment",
					"local",
					"--service",
					service.id,
					"--allow-unprovisioned",
					"--no-routes",
					"--output-suffix",
					suffix,
				]);
				config = parse(await readFile(path, "utf8"));
				for (const key of ["main", "tsconfig", "base_dir"])
					if (config[key]) config[key] = resolve(dirname(path), config[key]);
				if (config.assets?.directory)
					config.assets.directory = resolve(dirname(path), config.assets.directory);
				for (const database of config.d1_databases ?? [])
					if (database.migrations_dir)
						database.migrations_dir = resolve(dirname(path), database.migrations_dir);
			}
			config.name = names.get(config.name);
			for (const binding of config.services ?? [])
				binding.service = names.get(binding.service) ?? binding.service;
			for (const binding of config.durable_objects?.bindings ?? [])
				if (binding.script_name)
					binding.script_name = names.get(binding.script_name) ?? binding.script_name;
			for (const queue of config.queues?.producers ?? []) queue.queue += `-${suffix}`;
			for (const queue of config.queues?.consumers ?? []) {
				queue.queue += `-${suffix}`;
				if (queue.dead_letter_queue) queue.dead_letter_queue += `-${suffix}`;
			}
			delete config.tail_consumers;
			delete config.routes;
			delete config.ai;
			delete config.vectorize;
			config.vars = { ...config.vars, ...secrets[service.id] };
			if (config.vars.PUBLIC_SURFACES_JSON) config.vars.PUBLIC_SURFACES_JSON = "[]";
			delete config.secrets;
			const path =
				service.id === "site"
					? join(site, "wrangler.jsonc")
					: join(directory, `${service.id}.jsonc`);
			await writeFile(path, JSON.stringify(config), { mode: 0o600 });
			configs.set(service.id, { path, config });
		}
		for (const migration of materialized.migrations) {
			const { path } = configs.get(migration.service);
			await command(`migrate-${migration.service}-${migration.binding}`, [
				wrangler,
				"d1",
				"migrations",
				"apply",
				migration.binding,
				"--local",
				"--config",
				path,
				"--persist-to",
				state,
			]);
		}
		for (const service of materialized.services.filter(({ id }) => id !== "site")) {
			const port = await availablePort();
			const child = await command(
				service.id,
				[
					wrangler,
					"dev",
					"--config",
					configs.get(service.id).path,
					"--local",
					"--persist-to",
					state,
					"--ip",
					"127.0.0.1",
					"--port",
					String(port),
					"--inspector-port",
					"0",
					"--show-interactive-dev-session=false",
				],
				{},
				true,
			);
			await waitForLocalListener(`http://127.0.0.1:${port}${healthPathForService(service.id)}`, {
				isClosed: () => child.exitCode !== null,
			});
		}
		const port = await availablePort();
		const origin = `http://127.0.0.1:${port}`;
		const child = await command(
			"site",
			[
				resolve(root, "apps/site/node_modules/astro/bin/astro.mjs"),
				"dev",
				"--config",
				"isolated.config.mjs",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
			],
			{
				cwd: site,
				env: {
					...process.env,
					...secrets.site,
					ASTRO_DEV_BACKGROUND: "1",
					SUPERBOARD_LOCAL_STATE_DIRECTORY: state,
				},
			},
			true,
		);
		await waitForLocalListener(origin, {
			timeoutMs: 180000,
			isClosed: () => child.exitCode !== null,
		});
		return {
			origin,
			directory,
			state,
			children,
			stop,
			dispose: async () => {
				await stop();
				await rm(directory, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await stop();
		throw error;
	}
}

async function availablePort() {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const { port } = server.address();
	await new Promise((resolveClose) => {
		server.close(resolveClose);
	});
	return port;
}
