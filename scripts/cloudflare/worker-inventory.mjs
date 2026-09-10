import { existsSync, readdirSync, readFileSync } from "node:fs";
import { matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { deploymentGroups } from "./deployment-groups.mjs";
import { servicePackagePath } from "./services.mjs";
import { ALL_SERVICES, isServiceEnabled } from "./services.mjs";
import { loadTarget, root } from "./target.mjs";

export function inspectWorkerDirectories(repositoryRoot, targets) {
	const expected = new Map();
	for (const target of targets) {
		for (const service of ALL_SERVICES) {
			if (service === "site" || !isServiceEnabled(target, service)) continue;
			const directory =
				service === "custom" ? target.customWorker.packagePath : servicePackagePath(service);
			const source =
				service === "custom" ? target.customWorker.source : `${directory}/src/index.ts`;
			const entry = expected.get(directory) ?? {
				directory,
				services: new Set(),
				targets: new Set(),
				sources: new Set(),
			};
			entry.services.add(service);
			entry.targets.add(target.target);
			entry.sources.add(source);
			expected.set(directory, entry);
		}
		for (const worker of target.customWorker?.managedWorkers ?? []) {
			const entry = expected.get(worker.packagePath) ?? {
				directory: worker.packagePath,
				services: new Set(),
				targets: new Set(),
				sources: new Set(),
			};
			entry.services.add(`custom-${worker.id}`);
			entry.targets.add(target.target);
			entry.sources.add(worker.source);
			expected.set(worker.packagePath, entry);
		}
	}
	const actual = [];
	const containers = new Set(
		[...expected.keys()].map((path) => path.slice(0, path.lastIndexOf("/"))),
	);
	const pluginsRoot = resolve(repositoryRoot, "packages/plugins");
	if (existsSync(pluginsRoot)) {
		for (const entry of readdirSync(pluginsRoot, { withFileTypes: true }))
			if (entry.isDirectory() && entry.name.startsWith("supbrd-"))
				containers.add(`packages/plugins/${entry.name}`);
	}
	for (const directory of containers) {
		if (!existsSync(resolve(repositoryRoot, directory))) continue;
		for (const entry of readdirSync(resolve(repositoryRoot, directory), { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
				continue;
			const child = `${directory}/${entry.name}`;
			if (existsSync(resolve(repositoryRoot, child, "package.json"))) actual.push(child);
		}
	}
	const diagnostics = [];
	const workspaces = parse(
		readFileSync(resolve(repositoryRoot, "pnpm-workspace.yaml"), "utf8"),
	).packages;
	for (const directory of actual) {
		if (!expected.has(directory))
			diagnostics.push(`${directory}: no registered target uses this worker`);
		if (
			!workspaces.some((pattern) => !pattern.startsWith("!") && matchesGlob(directory, pattern)) ||
			workspaces.some(
				(pattern) => pattern.startsWith("!") && matchesGlob(directory, pattern.slice(1)),
			)
		)
			diagnostics.push(`${directory}: missing pnpm workspace declaration`);
	}
	for (const directory of containers) {
		if (!directory.startsWith("packages/plugins/")) continue;
		if (!existsSync(resolve(repositoryRoot, directory))) continue;
		for (const entry of readdirSync(resolve(repositoryRoot, directory), { withFileTypes: true })) {
			if (
				!entry.isDirectory() ||
				entry.name.startsWith(".") ||
				["node_modules", "src", "dist", "tests", "scripts", "coverage"].includes(entry.name)
			)
				continue;
			const child = `${directory}/${entry.name}`;
			if (!actual.includes(child))
				diagnostics.push(`${child}: directory contains no worker package`);
		}
	}
	for (const pattern of workspaces) {
		if (expected.has(pattern) && !actual.includes(pattern))
			diagnostics.push(`${pattern}: workspace points to a missing worker package`);
	}
	for (const { directory, sources } of expected.values()) {
		if (!existsSync(resolve(repositoryRoot, directory, "package.json")))
			diagnostics.push(`${directory}: registered worker package is missing`);
		for (const source of sources) {
			if (!source || !existsSync(resolve(repositoryRoot, source)))
				diagnostics.push(
					`${directory}: registered entrypoint is missing (${source ?? "undeclared"})`,
				);
		}
	}
	return {
		workers: [...expected.values()].map(({ directory, services, targets }) => ({
			directory,
			services: [...services],
			targets: [...targets],
		})),
		diagnostics,
	};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const targets = await Promise.all(
		readdirSync(resolve(root, "infra/targets"))
			.filter((name) => name.endsWith(".json") && name !== "schema.json")
			.map(async (name) => (await loadTarget(name.slice(0, -5))).target),
	);
	const result = inspectWorkerDirectories(root, targets);
	for (const worker of result.workers)
		console.log(`${relative(root, resolve(root, worker.directory))}: ${worker.targets.join(", ")}`);
	for (const target of targets) {
		const services = ALL_SERVICES.filter((service) => isServiceEnabled(target, service));
		console.log(
			`${target.target}: ${services.length} logical services, ${deploymentGroups(services).length} consolidated deployment groups`,
		);
	}
	for (const diagnostic of result.diagnostics) console.error(diagnostic);
	if (result.diagnostics.length) process.exitCode = 1;
}
