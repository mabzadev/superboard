import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));

export function checksDirectory(project) {
	const name = relative(repository, project).split(sep).join("/");
	return resolve(repository, "tests/checks", name.replace(/^packages\/plugins\//u, "plugins/"));
}

function linkDependencies(directory, project) {
	if (!existsSync(directory)) return;
	let source = project;
	while (!existsSync(join(source, "node_modules")) && dirname(source) !== source)
		source = dirname(source);
	const dependencyDirectory = join(source, "node_modules");
	if (!existsSync(dependencyDirectory)) return;
	const destination = join(directory, "node_modules");
	const link = relative(directory, dependencyDirectory);
	try {
		const existing = lstatSync(destination);
		if (!existing.isSymbolicLink()) return;
		if (readlinkSync(destination) === link) return;
		unlinkSync(destination);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	mkdirSync(directory, { recursive: true });
	symlinkSync(link, destination, "junction");
}

export function prepareTestDependencies() {
	function visit(directory, source) {
		if (!existsSync(directory) || !existsSync(source)) return;
		if (existsSync(join(source, "package.json"))) linkDependencies(directory, source);
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules")
				continue;
			visit(join(directory, entry.name), join(source, entry.name));
		}
	}
	for (const category of ["apps", "packages", "sdks", "infra", "plugins"]) {
		visit(
			resolve(repository, "tests/checks", category),
			resolve(repository, category === "plugins" ? "packages/plugins" : category),
		);
	}
	for (const [fixture, project] of Object.entries({
		"plugin-cli": "packages/plugin-cli",
		"registry-verification": "packages/registry-verification",
		contracts: "packages/contracts",
		"site-browser": "apps/site",
	}))
		linkDependencies(resolve(repository, "tests/fixtures", fixture), resolve(repository, project));
}

/**
 * Preserve each package's environment when its test sources live outside it.
 * @template T
 * @param {string | URL} origin
 * @param {T} configuration
 * @returns {T}
 */
export function centralTests(origin, configuration) {
	if (typeof configuration === "function")
		return /** @type {T} */ ((...args) => centralTests(origin, configuration(...args)));
	if (configuration && typeof configuration.then === "function")
		return /** @type {T} */ (configuration.then((value) => centralTests(origin, value)));
	let project = String(origin).startsWith("file:")
		? dirname(fileURLToPath(origin))
		: resolve(String(origin));
	while (!existsSync(join(project, "package.json")) && dirname(project) !== project)
		project = dirname(project);
	linkDependencies(checksDirectory(project), project);
	const manifest = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
	const existing = configuration.resolve?.alias ?? [];
	const aliases = Array.isArray(existing)
		? [...existing]
		: Object.entries(existing).map(([find, replacement]) => ({ find, replacement }));
	for (const [name, target] of Object.entries(manifest.imports ?? {})) {
		if (typeof target !== "string" || !target.startsWith("./")) continue;
		const pattern = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace("\\*", "(.*)");
		aliases.push({
			find: new RegExp(`^${pattern}$`, "u"),
			replacement: resolve(project, target).replace("*", "$1"),
		});
	}
	const root = configuration.root ?? project;
	return /** @type {T} */ ({
		...configuration,
		root: isAbsolute(root) ? root : resolve(project, root),
		resolve: { ...configuration.resolve, alias: aliases },
		test: {
			...configuration.test,
			exclude: [
				join(repository, "tests/**/node_modules/**"),
				"**/node_modules/**",
				"**/.git/**",
				...(configuration.test?.exclude ?? []),
			],
			include: configuration.test?.include ?? [
				join(checksDirectory(project), "**/*.{test,spec}.{js,mjs,ts,tsx}"),
			],
		},
	});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	prepareTestDependencies();
