import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");
const integrationConfigPath = resolve(repositoryRoot, "config/emdash-integration.json");

function runGit(arguments_, cwd = repositoryRoot, options = {}) {
	const result = spawnSync("git", arguments_, {
		cwd,
		encoding: options.encoding ?? "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(result.stderr || result.stdout || `git ${arguments_.join(" ")} failed`);
	}
	return result;
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

function serializeJson(value) {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

export async function readIntegrationConfig() {
	return readJson(integrationConfigPath);
}

export function readFileAtCommit(commit, path) {
	return runGit(["show", `${commit}:${path}`]).stdout;
}

function rootOverlayPath(config) {
	return resolve(repositoryRoot, config.overlay.root);
}

function copyDefinedKeys(source, keys) {
	return Object.fromEntries(
		keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
	);
}

const npmPrefixCiPattern = /\bnpm --prefix ([^\s]+) ci\b/g;
const npmPrefixPattern = /\bnpm --prefix ([^\s]+)\b/g;
const npmRunPattern = /\bnpm run\b/g;
const npmTestPattern = /\bnpm test\b/g;
const npmAuditPattern = /\bnpm audit\b/g;
const npxPattern = /\bnpx\b/g;
const npmCiPattern = /\bnpm ci\b/g;
const ciNamePattern = /^name: CI$/m;
const setupNodeActionPattern = /^(\s*)- uses: actions\/setup-node@/gm;
const npmCachePattern = /^(\s*cache:) npm$/gm;
const packageLockCachePathPattern = /apps\/reference\/package-lock\.json/g;
const yarnInstallPattern = /\byarn install --immutable\b/g;
const yarnCheckPattern = /\byarn check\b/g;
const lintSourcePattern = /\.[cm]?[jt]sx?$/;
const formatSourcePattern = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|toml|css|scss|md)$/;
const overlayLintSources = [
	".github/scripts/check-no-major.test.mjs",
	"apps/labeler/src/bytes.ts",
	"apps/labeler/test/bytes.test.ts",
	"scripts/emdash-overlay.mjs",
	"scripts/emdash-overlay.test.mjs",
];
const overlayLintRoots = ["apps/site", "packages/supbrd-core"];
const overlayFormatSources = [
	...overlayLintSources,
	".github/workflows/superboard-ci.yml",
	".gitleaks.toml",
	".lintstagedrc",
	".oxfmtrc.json",
	"README.md",
	"config/emdash-integration.json",
	"config/emdash-integration.schema.json",
	"config/emdash-root.overlay.json",
	"scripts/cloudflare-site-build.mjs",
	"scripts/cloudflare-site-build.test.mjs",
	"scripts/emdash-migration-rehearsal-proof.mjs",
	"scripts/emdash-migration-rehearsal-proof.test.mjs",
	"scripts/emdash-parity-matrix.mjs",
	"scripts/emdash-parity-matrix.test.mjs",
	"scripts/emdash-store-restore-proof.mjs",
	"scripts/emdash-store-restore.test.mjs",
];
const upstreamLintBaselineExclusions = new Set(["packages/plugins/forms/src/admin.tsx"]);

export function normalizePnpmScript(script) {
	return script
		.replace(npmPrefixCiPattern, "pnpm --dir $1 install --frozen-lockfile")
		.replace(npmPrefixPattern, "pnpm --dir $1")
		.replace(npmRunPattern, "pnpm run")
		.replace(npmTestPattern, "pnpm test")
		.replace(npmAuditPattern, "pnpm audit")
		.replace(npxPattern, "pnpm exec");
}

export function renderIntegratedReadme(productReadme, upstream) {
	const layoutMarker = "\n## Layout\n";
	if (!productReadme.includes(layoutMarker)) {
		throw new Error("The captured SuperBoard README has no Layout section");
	}
	const normalized = normalizePnpmScript(productReadme).replace(
		npmCiPattern,
		"pnpm install --frozen-lockfile",
	);
	const foundation = `
## Integrated EmDash foundation

This repository contains the complete EmDash ${upstream.version} source at commit
\`${upstream.commit}\` from
[\`emdash-cms/emdash\`](${upstream.remote}). The non-squashed merge keeps the
upstream history, and
\`config/emdash-integration.json\` pins the imported commit and deterministic
root overlay.

The historical Next/OpenNext Dashboard remains available while the Release Front
parity, migration receipts, development rehearsal, production cutover, and
observation required by [issue #33](https://github.com/mabzadev/superboard/issues/33)
are incomplete. It is not the target Front SuperBoard. The audited integration
details are in
[\`docs/EMDASH_UPSTREAM_1717D31_INTEGRATION_2026-08-29.md\`](docs/EMDASH_UPSTREAM_1717D31_INTEGRATION_2026-08-29.md).

The first executable target slice lives in \`apps/site\`. It mounts the native
EmDash Admin, a generic fail-closed Front runtime, the closed Release Front
contract, D1 activation receipts, and a Last Verified Release cache that never
becomes activation authority. Release operations are disabled by default.

Use the integrated pnpm gates from the repository root:

\`\`\`bash
pnpm install --frozen-lockfile
pnpm build
pnpm emdash:typecheck
pnpm emdash:test
pnpm site:check
pnpm support:check
pnpm flows:check
\`\`\`
`;
	return normalized.replace(layoutMarker, `${foundation}${layoutMarker}`);
}

export function renderSuperboardCi(source) {
	let rendered = normalizePnpmScript(source)
		.replace(npmCiPattern, "pnpm install --frozen-lockfile")
		.replace(ciNamePattern, "name: SuperBoard CI")
		.replace(npmCachePattern, "$1 pnpm")
		.replace(packageLockCachePathPattern, "pnpm-lock.yaml")
		.replace(yarnInstallPattern, "pnpm install --frozen-lockfile")
		.replace(yarnCheckPattern, "pnpm check")
		.replace("    timeout-minutes: 10", "    timeout-minutes: 20")
		.replace(
			setupNodeActionPattern,
			"$1- uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8\n$1- uses: actions/setup-node@",
		);
	const installStep = "      - run: pnpm install --frozen-lockfile\n";
	if (!rendered.includes(installStep)) {
		throw new Error("The captured SuperBoard CI has no root install step");
	}
	rendered = rendered.replace(
		installStep,
		`${installStep}      - name: Validate EmDash integration and SuperBoard Site\n        run: pnpm emdash:overlay:check && pnpm emdash:workspace-deps:check && pnpm emdash:integration:test && pnpm site:check\n`,
	);
	return rendered;
}

export function renderRootPackage(upstreamPackage, overlay) {
	const product = overlay.package;
	const scriptCollisions = Object.keys(product.scripts).filter(
		(key) => upstreamPackage.scripts?.[key] !== undefined,
	);
	const scripts = { ...upstreamPackage.scripts };

	for (const key of scriptCollisions) {
		delete scripts[key];
		scripts[`emdash:${key}`] = upstreamPackage.scripts[key];
	}
	for (const [key, value] of Object.entries(product.scripts)) {
		scripts[scriptCollisions.includes(key) ? `superboard:${key}` : key] =
			normalizePnpmScript(value);
	}
	for (const key of scriptCollisions) {
		scripts[key] = `pnpm run emdash:${key} && pnpm run superboard:${key}`;
	}
	scripts["emdash:overlay"] = "node scripts/emdash-overlay.mjs apply";
	scripts["emdash:overlay:check"] = "node scripts/emdash-overlay.mjs check";
	scripts["emdash:integration:test"] = "node --test scripts/emdash-overlay.test.mjs";
	scripts["emdash:lint"] = "node scripts/emdash-overlay.mjs lint-upstream";
	scripts["emdash:workspace-deps"] = "node scripts/emdash-overlay.mjs workspace-deps";
	scripts["emdash:workspace-deps:check"] = "node scripts/emdash-overlay.mjs workspace-deps --check";
	scripts["emdash:format:full"] = scripts.format;
	scripts["emdash:format:check:full"] = scripts["format:check"];
	scripts.format = "node scripts/emdash-overlay.mjs format";
	scripts["format:check"] = "node scripts/emdash-overlay.mjs format-check";

	return {
		...upstreamPackage,
		...product.metadata,
		scripts,
		devDependencies: {
			...product.devDependencies,
			...upstreamPackage.devDependencies,
		},
		optionalDependencies: {
			...upstreamPackage.optionalDependencies,
			...product.optionalDependencies,
		},
	};
}

function renderYamlValue(value, indent) {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return `\n${Object.entries(value)
			.map(([key, nested]) => {
				const renderedValue = renderYamlValue(nested, indent + 2);
				const separator = renderedValue.startsWith("\n") ? "" : " ";
				return `${" ".repeat(indent)}${JSON.stringify(key)}:${separator}${renderedValue}`;
			})
			.join("\n")}`;
	}
	throw new Error(`Unsupported pnpm override value: ${JSON.stringify(value)}`);
}

function isCoveredByUpstreamWorkspace(path) {
	return path.startsWith("apps/") || path.startsWith("packages/");
}

function flattenPnpmOverrides(overrides, parent = "") {
	const flattened = {};
	for (const [key, value] of Object.entries(overrides)) {
		const selector = parent ? `${parent}>${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			Object.assign(flattened, flattenPnpmOverrides(value, selector));
		} else {
			flattened[selector] = value;
		}
	}
	return flattened;
}

export function renderPnpmWorkspace(upstreamWorkspace, overlay, compatibility) {
	const hoistPatternLines = compatibility.hoistPattern
		.map((value) => `  - ${JSON.stringify(value)}`)
		.join("\n");
	const supportedOperatingSystems = compatibility.supportedArchitectures.os
		.map((value) => `    - ${JSON.stringify(value)}`)
		.join("\n");
	const supportedCpus = compatibility.supportedArchitectures.cpu
		.map((value) => `    - ${JSON.stringify(value)}`)
		.join("\n");
	const packageExtensionLines = Object.entries(compatibility.packageExtensions)
		.map(([key, value]) => {
			const renderedValue = renderYamlValue(value, 4);
			const separator = renderedValue.startsWith("\n") ? "" : " ";
			return `  ${JSON.stringify(key)}:${separator}${renderedValue}`;
		})
		.join("\n");
	let rendered = `# SuperBoard keeps the virtual store deterministic and package peer graphs isolated.\nvirtualStoreType: ${compatibility.virtualStoreType}\nresolvePeersFromWorkspaceRoot: ${String(compatibility.resolvePeersFromWorkspaceRoot)}\ndedupePeerDependents: ${String(compatibility.dedupePeerDependents)}\nsupportedArchitectures:\n  os:\n${supportedOperatingSystems}\n  cpu:\n${supportedCpus}\nhoistPattern:\n${hoistPatternLines}\npackageExtensions:\n${packageExtensionLines}\n\n${upstreamWorkspace}`;
	const trustPolicyAnchor = "trustPolicyExclude:\n";
	if (!rendered.includes(trustPolicyAnchor)) {
		throw new Error("The pinned pnpm trustPolicyExclude anchor has drifted");
	}
	const trustPolicyLines = compatibility.trustPolicyExclude
		.map((value) => `  - ${JSON.stringify(value)}`)
		.join("\n");
	rendered = rendered.replace(
		trustPolicyAnchor,
		`${trustPolicyAnchor}  # SuperBoard reviewed exact-version trust exceptions.\n${trustPolicyLines}\n`,
	);
	const allowBuildsAnchor = "allowBuilds:\n";
	if (!rendered.includes(allowBuildsAnchor)) {
		throw new Error("The pinned pnpm allowBuilds anchor has drifted");
	}
	const allowBuildLines = Object.entries(compatibility.allowBuilds)
		.map(([key, value]) => `  ${JSON.stringify(key)}: ${String(value)}`)
		.join("\n");
	rendered = rendered.replace(
		allowBuildsAnchor,
		`${allowBuildsAnchor}  # SuperBoard reviewed dependency scripts.\n${allowBuildLines}\n`,
	);
	const workspaces = overlay.package.workspaces.filter(
		(path) => !isCoveredByUpstreamWorkspace(path),
	);
	const workspaceAnchor = "  - infra/*\ncatalog:";
	if (!rendered.includes(workspaceAnchor)) {
		throw new Error("The pinned pnpm workspace package anchor has drifted");
	}
	const workspaceLines = workspaces.map((path) => `  - ${path}`).join("\n");
	rendered = rendered.replace(
		workspaceAnchor,
		`  - infra/*\n  # SuperBoard overlay workspaces.\n${workspaceLines}\ncatalog:`,
	);

	const overrideAnchor = "overrides:\n";
	if (!rendered.includes(overrideAnchor)) {
		throw new Error("The pinned pnpm overrides anchor has drifted");
	}
	const overrides = flattenPnpmOverrides({
		"eslint-import-resolver-typescript": compatibility.eslintImportResolverTypescript,
		...overlay.package.overrides,
		...compatibility.additionalOverrides,
	});
	const overrideLines = Object.entries(overrides)
		.map(([key, value]) => `  ${JSON.stringify(key)}: ${renderYamlValue(value, 4)}`)
		.join("\n");
	rendered = rendered.replace(
		overrideAnchor,
		`${overrideAnchor}  # SuperBoard compatibility overrides.\n${overrideLines}\n`,
	);

	const patchedDependenciesAnchor = "patchedDependencies:\n";
	if (!rendered.includes(patchedDependenciesAnchor)) {
		throw new Error("The pinned pnpm patchedDependencies anchor has drifted");
	}
	const patchedDependencyLines = Object.entries(compatibility.patchedDependencies)
		.map(([key, value]) => `  ${JSON.stringify(key)}: ${value}`)
		.join("\n");
	rendered = rendered.replace(
		patchedDependenciesAnchor,
		`${patchedDependenciesAnchor}  # SuperBoard retained dependency patches.\n${patchedDependencyLines}\n`,
	);
	return rendered;
}

export function renderGitignore(upstreamGitignore, overlay) {
	const localLines = overlay.gitignore
		.split("\n")
		.filter((line) => line.trim() !== "/pnpm-lock.yaml" && line.trim() !== "pnpm-lock.yaml");
	return `${upstreamGitignore.trimEnd()}\n!.dev.vars.example\n\n# SuperBoard overlay\n${localLines.join("\n").trim()}\npackage-lock.json\n`;
}

export function isLintSourcePath(path) {
	return lintSourcePattern.test(path) && !upstreamLintBaselineExclusions.has(path);
}

export async function lintUpstream() {
	const config = await readIntegrationConfig();
	const upstreamPaths = runGit([
		"ls-tree",
		"-r",
		"--name-only",
		config.upstream.commit,
	]).stdout.split("\n");
	const overlayRootSources = (
		await Promise.all(
			overlayLintRoots.map((root) => listLintSources(resolve(repositoryRoot, root))),
		)
	)
		.flat()
		.map((path) => relative(repositoryRoot, path));
	const paths = [
		...new Set([...upstreamPaths, ...overlayLintSources, ...overlayRootSources]),
	].filter((path) => isLintSourcePath(path) && existsSync(resolve(repositoryRoot, path)));
	const executable = resolve(repositoryRoot, "node_modules/.bin/oxlint");
	const result = spawnSync(executable, ["--type-aware", "--deny-warnings", ...paths], {
		cwd: repositoryRoot,
		stdio: "inherit",
	});
	return result.status ?? 1;
}

export async function formatIntegrated({ write = false } = {}) {
	const config = await readIntegrationConfig();
	const upstreamPaths = runGit([
		"ls-tree",
		"-r",
		"--name-only",
		config.upstream.commit,
	]).stdout.split("\n");
	const overlayRootSources = (
		await Promise.all(
			overlayLintRoots.map((root) => listLintSources(resolve(repositoryRoot, root))),
		)
	)
		.flat()
		.map((path) => relative(repositoryRoot, path));
	const paths = [
		...new Set([...upstreamPaths, ...overlayFormatSources, ...overlayRootSources]),
	].filter(
		(path) =>
			formatSourcePattern.test(path) &&
			existsSync(resolve(repositoryRoot, path)) &&
			!path.includes("/generated/") &&
			!path.endsWith("worker-configuration.d.ts"),
	);
	const astroPaths = paths.filter((path) => path.endsWith(".astro"));
	const oxfmtPaths = paths.filter((path) => !path.endsWith(".astro"));
	const oxfmt = spawnSync(
		resolve(repositoryRoot, "node_modules/.bin/oxfmt"),
		["--ignore-path", ".gitignore", ...(write ? [] : ["--check"]), ...oxfmtPaths],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
	if ((oxfmt.status ?? 1) !== 0) return oxfmt.status ?? 1;
	if (astroPaths.length === 0) return 0;
	const prettier = spawnSync(
		resolve(repositoryRoot, "node_modules/.bin/prettier"),
		[write ? "--write" : "--check", ...astroPaths],
		{ cwd: repositoryRoot, stdio: "inherit" },
	);
	return prettier.status ?? 1;
}

async function listLintSources(root) {
	const entries = await readdir(root, { withFileTypes: true });
	const paths = [];
	for (const entry of entries) {
		if (["dist", "node_modules", "generated"].includes(entry.name)) continue;
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) {
			paths.push(...(await listLintSources(path)));
		} else if (isLintSourcePath(path) && !path.endsWith("worker-configuration.d.ts")) {
			paths.push(path);
		}
	}
	return paths;
}

const dependencySections = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

export function normalizeLocalWorkspaceDependencies(packageJson, localPackageNames) {
	let changed = false;
	for (const section of dependencySections) {
		const dependencies = packageJson[section];
		if (!dependencies) {
			continue;
		}
		for (const dependency of Object.keys(dependencies)) {
			if (localPackageNames.has(dependency) && dependencies[dependency] !== "workspace:*") {
				dependencies[dependency] = "workspace:*";
				changed = true;
			}
		}
	}
	return changed;
}

const ignoredPackageDirectories = new Set([
	".git",
	".next",
	".open-next",
	".wrangler",
	"build",
	"coverage",
	"dist",
	"node_modules",
]);
const integratedWorkspacePatterns = [
	/^apps\/[^/]+$/,
	/^packages\/[^/]+$/,
	/^packages\/plugins\/[^/]+$/,
];

async function discoverPackageJsonFiles(directory) {
	if (!existsSync(directory)) {
		return [];
	}
	const discovered = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredPackageDirectories.has(entry.name)) {
			continue;
		}
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			discovered.push(...(await discoverPackageJsonFiles(path)));
		} else if (entry.isFile() && entry.name === "package.json") {
			discovered.push(path);
		}
	}
	return discovered;
}

export function isIntegratedWorkspaceDirectory(directory, exactWorkspaces) {
	return (
		exactWorkspaces.has(directory) ||
		integratedWorkspacePatterns.some((pattern) => pattern.test(directory))
	);
}

export async function reconcileLocalWorkspaceDependencies({ check = false } = {}) {
	const config = await readIntegrationConfig();
	const overlay = await readJson(rootOverlayPath(config));
	const exactWorkspaces = new Set(overlay.package.workspaces);
	const roots = ["apps", "packages", "workers", "sdks"].map((path) =>
		resolve(repositoryRoot, path),
	);
	const packageFiles = (await Promise.all(roots.map(discoverPackageJsonFiles))).flat();
	const discoveredPackages = await Promise.all(
		packageFiles.map(async (path) => ({ path, source: await readFile(path, "utf8") })),
	);
	const packages = discoveredPackages.filter(({ path }) =>
		isIntegratedWorkspaceDirectory(relative(repositoryRoot, dirname(path)), exactWorkspaces),
	);
	const localPackageNames = new Set(
		packages
			.map(({ source }) => JSON.parse(source).name)
			.filter((name) => typeof name === "string" && name.startsWith("@superboard/")),
	);
	const changed = [];
	for (const entry of packages) {
		const packageJson = JSON.parse(entry.source);
		if (!normalizeLocalWorkspaceDependencies(packageJson, localPackageNames)) {
			continue;
		}
		const path = relative(repositoryRoot, entry.path);
		changed.push(path);
		if (!check) {
			const indentation = entry.source.includes('\n\t"') ? "\t" : 2;
			await writeFile(entry.path, `${JSON.stringify(packageJson, null, indentation)}\n`);
		}
	}
	return changed;
}

export async function captureRootOverlay(sourceRoot) {
	const absoluteSource = resolve(sourceRoot);
	const sourcePackage = await readJson(resolve(absoluteSource, "package.json"));
	const config = await readIntegrationConfig();
	const overlayPath = rootOverlayPath(config);
	const existing = existsSync(overlayPath) ? await readJson(overlayPath) : null;
	const sourceCommit = runGit(["rev-parse", "HEAD"], absoluteSource).stdout.trim();
	const sourceStatus = runGit(["status", "--porcelain=v1"], absoluteSource).stdout;
	const overlay = {
		schemaVersion: 1,
		capturedFrom: {
			commit: sourceCommit,
			sourceStatus: sourceStatus.trim() ? "unvalidated" : "delivered",
			statusSha256: sha256(sourceStatus),
		},
		package: {
			metadata: copyDefinedKeys(sourcePackage, [
				"name",
				"version",
				"private",
				"license",
				"description",
				"repository",
				"homepage",
				"bugs",
			]),
			scripts: sourcePackage.scripts ?? {},
			workspaces: [
				...new Set([...(sourcePackage.workspaces ?? []), ...(existing?.package?.workspaces ?? [])]),
			],
			overrides: sourcePackage.overrides ?? {},
			devDependencies: {
				...sourcePackage.devDependencies,
				...existing?.package?.devDependencies,
			},
		},
		gitignore: await readFile(resolve(absoluteSource, ".gitignore"), "utf8"),
		readme: await readFile(resolve(absoluteSource, "README.md"), "utf8"),
		ci: await readFile(resolve(absoluteSource, ".github/workflows/ci.yml"), "utf8"),
	};
	await writeFile(overlayPath, serializeJson(overlay));
	return overlay;
}

export async function expectedGeneratedFiles() {
	const config = await readIntegrationConfig();
	const overlay = await readJson(rootOverlayPath(config));
	const upstreamPackage = JSON.parse(readFileAtCommit(config.upstream.commit, "package.json"));
	const upstreamWorkspace = readFileAtCommit(config.upstream.commit, "pnpm-workspace.yaml");
	const upstreamGitignore = readFileAtCommit(config.upstream.commit, ".gitignore");
	return new Map([
		["package.json", serializeJson(renderRootPackage(upstreamPackage, overlay))],
		["pnpm-workspace.yaml", renderPnpmWorkspace(upstreamWorkspace, overlay, config.compatibility)],
		[".gitignore", renderGitignore(upstreamGitignore, overlay)],
		["README.md", renderIntegratedReadme(overlay.readme, config.upstream)],
		[".github/workflows/superboard-ci.yml", renderSuperboardCi(overlay.ci)],
	]);
}

async function verifyUpstreamAncestry(config) {
	const object = runGit(["cat-file", "-t", config.upstream.commit]).stdout.trim();
	if (object !== "commit") {
		throw new Error(`Pinned upstream object is ${object}, expected commit`);
	}
	const ancestry = runGit(
		["merge-base", "--is-ancestor", config.upstream.commit, "HEAD"],
		repositoryRoot,
		{
			allowFailure: true,
		},
	);
	if (ancestry.status !== 0) {
		throw new Error(`Pinned upstream commit ${config.upstream.commit} is not an ancestor of HEAD`);
	}
}

export async function applyOverlay() {
	const expected = await expectedGeneratedFiles();
	const changed = [];
	for (const [path, contents] of expected) {
		const absolutePath = resolve(repositoryRoot, path);
		const current = existsSync(absolutePath) ? await readFile(absolutePath, "utf8") : null;
		if (current !== contents) {
			await writeFile(absolutePath, contents);
			changed.push(path);
		}
	}
	return changed;
}

export async function checkOverlay() {
	const config = await readIntegrationConfig();
	await verifyUpstreamAncestry(config);
	const expected = await expectedGeneratedFiles();
	const mismatches = [];
	for (const [path, contents] of expected) {
		const absolutePath = resolve(repositoryRoot, path);
		const current = existsSync(absolutePath) ? await readFile(absolutePath, "utf8") : null;
		if (current !== contents) {
			mismatches.push(path);
		}
	}
	return mismatches;
}

function parsePorcelainZ(output) {
	const records = output.toString("utf8").split("\0").filter(Boolean);
	const entries = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		const status = record.slice(0, 2);
		const path = record.slice(3);
		if (status.includes("R") || status.includes("C")) {
			throw new Error(`Rename/copy status requires an explicit overlay decision: ${record}`);
		}
		entries.push({ status, path });
	}
	return entries;
}

function assertSafeRelativePath(path) {
	if (!path || isAbsolute(path) || path === ".." || path.startsWith("../")) {
		throw new Error(`Unsafe worktree path: ${path}`);
	}
}

export async function copyWorktreeOverlay(sourceRoot) {
	const config = await readIntegrationConfig();
	const absoluteSource = resolve(sourceRoot);
	const status = runGit(
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		absoluteSource,
		{ encoding: "buffer" },
	).stdout;
	const excluded = new Set(config.overlay.excludedWorktreePaths);
	const copied = [];
	for (const entry of parsePorcelainZ(status)) {
		assertSafeRelativePath(entry.path);
		if (excluded.has(entry.path)) {
			continue;
		}
		const sourcePath = resolve(absoluteSource, entry.path);
		const destinationPath = resolve(repositoryRoot, entry.path);
		if (relative(repositoryRoot, destinationPath).startsWith("..")) {
			throw new Error(`Overlay destination escaped the repository: ${entry.path}`);
		}
		if (entry.status.includes("D") || !existsSync(sourcePath)) {
			await rm(destinationPath, { force: true, recursive: true });
		} else {
			await mkdir(dirname(destinationPath), { recursive: true });
			const sourceStats = await lstat(sourcePath);
			await cp(sourcePath, destinationPath, {
				recursive: sourceStats.isDirectory(),
				force: true,
				preserveTimestamps: true,
			});
		}
		copied.push(entry.path);
	}
	return copied;
}

async function main() {
	const [command, ...arguments_] = process.argv.slice(2);
	if (command === "capture") {
		const sourceIndex = arguments_.indexOf("--source");
		if (sourceIndex === -1 || !arguments_[sourceIndex + 1]) {
			throw new Error("capture requires --source <SuperBoard checkout>");
		}
		const overlay = await captureRootOverlay(arguments_[sourceIndex + 1]);
		console.log(JSON.stringify({ captured: true, source: overlay.capturedFrom }));
		return;
	}
	if (command === "copy-worktree") {
		const sourceIndex = arguments_.indexOf("--source");
		if (sourceIndex === -1 || !arguments_[sourceIndex + 1]) {
			throw new Error("copy-worktree requires --source <SuperBoard checkout>");
		}
		const copied = await copyWorktreeOverlay(arguments_[sourceIndex + 1]);
		console.log(JSON.stringify({ copied }));
		return;
	}
	if (command === "apply") {
		console.log(JSON.stringify({ changed: await applyOverlay() }));
		return;
	}
	if (command === "workspace-deps") {
		const check = arguments_.includes("--check");
		const changed = await reconcileLocalWorkspaceDependencies({ check });
		if (check && changed.length > 0) {
			console.error(JSON.stringify({ valid: false, mismatches: changed }));
			process.exitCode = 1;
			return;
		}
		console.log(JSON.stringify({ valid: true, changed }));
		return;
	}
	if (command === "lint-upstream") {
		process.exitCode = await lintUpstream();
		return;
	}
	if (command === "format-check") {
		process.exitCode = await formatIntegrated();
		return;
	}
	if (command === "format") {
		process.exitCode = await formatIntegrated({ write: true });
		return;
	}
	if (command === "check") {
		const mismatches = await checkOverlay();
		if (mismatches.length > 0) {
			console.error(JSON.stringify({ valid: false, mismatches }));
			process.exitCode = 1;
			return;
		}
		console.log(JSON.stringify({ valid: true }));
		return;
	}
	throw new Error(
		"Usage: emdash-overlay.mjs <capture|copy-worktree|apply|check|workspace-deps|lint-upstream|format|format-check>",
	);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
