import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SERVICE_PACKAGE_PATHS } from "../../scripts/cloudflare/services.mjs";
import { lintPluginPackageProject } from "../../scripts/emdash/plugin-packages.mjs";
import { lintSuperBoardBrandProject } from "./brand.mjs";
import { lintFrontMenuProject } from "./front-menu.mjs";
import { lintPlatformSeparation } from "./platform-separation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePattern = /\.[cm]?[jt]sx?$/u;
const generatedPattern =
	/(?:^|\/)(?:dist|node_modules|generated|\.next|\.open-next|\.wrangler|coverage)\//u;
const workerEslintRoots = [
	"packages/plugins/supbrd-plug-analytics/worker",
	"packages/plugins/supbrd-plug-journeys/flows",
	"packages/plugins/supbrd-plug-communication/marketing",
	"packages/plugins/supbrd-plug-support/worker",
];
const emdashPackagePattern = /^packages\/(?:plugins\/)?supbrd-[^/]+\//u;

function sourceOwnerPath(path) {
	if (path.startsWith("tests/checks/plugins/"))
		return path
			.replace("tests/checks/plugins/", "packages/plugins/")
			.replace(/^(packages\/plugins\/[^/]+)\/front\//u, "$1/src/front/")
			.replace("/unit/", "/src/")
			.replace("/runtime/", "/runtime-tests/");
	if (path.startsWith("tests/checks/apps/mcp/"))
		return path.replace("tests/checks/apps/mcp/", "apps/mcp/src/");
	if (path.startsWith("tests/checks/")) return path.slice("tests/checks/".length);
	if (path.startsWith("tests/e2e/site/")) return path.replace("tests/e2e/site/", "apps/site/e2e/");
	if (path.startsWith("tests/e2e/emdash/")) return path.replace("tests/e2e/emdash/", "e2e/tests/");
	return path;
}

export function classifyLintSources(paths, upstreamPaths) {
	const groups = new Map();
	const excluded = [];
	const upstreamRoots = new Set(
		[...upstreamPaths]
			.filter((path) => /^(?:apps|packages)\//u.test(path))
			.map((path) => path.split("/").slice(0, 2).join("/")),
	);
	for (const path of new Set(paths)) {
		if (!sourcePattern.test(path)) continue;
		let reason;
		if (path.endsWith(".d.ts")) reason = "generated-types";
		else if (generatedPattern.test(path)) reason = "generated-output";
		else if (
			path.startsWith("sdks/flows/upstream/reference/") ||
			path.startsWith("sdks/flows/upstream/product/")
		)
			reason = "imported-reference";
		else if (
			/^(?:\.agents|\.claude)\/skills\//u.test(path) ||
			/(?:^|\/)skills\/[^/]+\/scaffold\//u.test(path)
		)
			reason = "skill-template";
		if (reason) {
			excluded.push({ path, reason });
			continue;
		}
		let group = "native";
		const sourcePath = sourceOwnerPath(path);
		const workerRoot = workerEslintRoots.find(
			(root) => sourcePath.startsWith(`${root}/`) && path.endsWith(".ts"),
		);
		if (
			sourcePath.startsWith("packages/supbrd-front-ui/") ||
			(sourcePath.startsWith("packages/plugins/supbrd-") && sourcePath.includes("/src/front/"))
		) {
			group = "frontend";
		} else if (sourcePath.startsWith("apps/mcp/src/")) {
			group = "eslint:apps/mcp";
		} else if (workerRoot) {
			group = `eslint:${workerRoot}`;
		} else if (
			(path.startsWith("tests/checks/plugins/") && path.endsWith(".mjs")) ||
			Object.entries(SERVICE_PACKAGE_PATHS).some(
				([service, root]) => service !== "site" && sourcePath.startsWith(`${root}/`),
			) ||
			sourcePath.startsWith("apps/reference/worker/") ||
			(sourcePath.startsWith("packages/plugins/supbrd-") && sourcePath.includes("/scripts/"))
		) {
			group = "native";
		} else if (path.startsWith("sdks/flows/upstream/")) {
			group = "flows";
		} else if (
			upstreamPaths.has(path) ||
			upstreamRoots.has(sourcePath.split("/").slice(0, 2).join("/")) ||
			sourcePath.startsWith("apps/site/") ||
			path.startsWith("tests/e2e/emdash/") ||
			emdashPackagePattern.test(sourcePath)
		) {
			group = "emdash";
		}
		const members = groups.get(group) ?? [];
		members.push(path);
		groups.set(group, members);
	}
	return { groups, excluded };
}

export function normalizeEslintDiagnostics(results) {
	return results.flatMap(({ filePath, messages }) =>
		messages.map((message) => ({
			filename: filePath,
			message: message.message,
			severity: message.severity === 2 ? "error" : "warning",
			code: `eslint(${message.ruleId ?? (message.fatal ? "parse-error" : "configuration")})`,
			labels: [{ span: { line: message.line, column: message.column } }],
		})),
	);
}

function gitLines(arguments_) {
	const result = spawnSync("git", arguments_, {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(result.stderr || "Cannot enumerate lint coverage");
	return result.stdout.split("\0").filter(Boolean);
}

function inspectCoverage() {
	const config = JSON.parse(
		readFileSync(resolve(repositoryRoot, "scripts/config/emdash-integration.json"), "utf8"),
	);
	const upstream = new Set(
		gitLines(["ls-tree", "-r", "--name-only", "-z", config.upstream.commit]),
	);
	const paths = gitLines(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).filter(
		(path) => existsSync(resolve(repositoryRoot, path)),
	);
	return classifyLintSources(paths, upstream);
}

function runGroup(group, paths, { quick, fix }) {
	const eslintRoot =
		group === "frontend" ? "." : group.startsWith("eslint:") ? group.slice("eslint:".length) : null;
	const cwd = repositoryRoot;
	const executable = resolve(
		repositoryRoot,
		eslintRoot ?? ".",
		"node_modules/.bin",
		eslintRoot ? "eslint" : "oxlint",
	);
	const config =
		group === "native"
			? "tests/lints/superboard.oxlintrc.json"
			: group === "flows"
				? "sdks/flows/upstream/.oxlintrc.json"
				: ".oxlintrc.json";
	const arguments_ = eslintRoot
		? [
				"--format",
				"json",
				...(group === "frontend"
					? ["--config", "tests/lints/frontend.config.mjs"]
					: [
							"--config",
							`${eslintRoot}/eslint.config.${eslintRoot === "apps/mcp" ? "js" : "mjs"}`,
						]),
				...(fix ? ["--fix"] : []),
			]
		: [
				"--config",
				config,
				...(group === "flows" ? [] : ["--disable-nested-config"]),
				...(quick || group === "native" ? [] : ["--type-aware"]),
				"--format",
				"json",
				...(fix ? ["--fix"] : []),
			];
	const diagnostics = [];
	for (let offset = 0; offset < paths.length; offset += 4000) {
		const chunk = paths
			.slice(offset, offset + 4000)
			.map((path) => relative(cwd, resolve(repositoryRoot, path)));
		const result = spawnSync(executable, [...arguments_, ...chunk], {
			cwd,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		try {
			const parsed = JSON.parse(result.stdout);
			const reported = eslintRoot ? normalizeEslintDiagnostics(parsed) : parsed.diagnostics;
			if (!Array.isArray(reported)) throw new Error("Missing diagnostics");
			diagnostics.push(...reported);
			if (result.status !== 0 && reported.length === 0)
				throw new Error(result.stderr || "Linter exited without diagnostics");
		} catch (error) {
			diagnostics.push({
				filename: paths[offset],
				severity: "error",
				code: "lint(tool-failure)",
				message: `${group}: ${result.error?.message || result.stderr || error.message}`,
			});
		}
	}
	return diagnostics.map((diagnostic) => ({
		...diagnostic,
		filename: diagnostic.filename?.startsWith(repositoryRoot)
			? relative(repositoryRoot, diagnostic.filename)
			: diagnostic.filename,
	}));
}

async function main() {
	const options = new Set(process.argv.slice(2));
	const { groups, excluded } = inspectCoverage();
	const coverage = {
		checked: Object.fromEntries([...groups].map(([group, paths]) => [group, paths.length])),
		excluded,
	};
	if (options.has("--coverage")) {
		console.log(JSON.stringify({ ...coverage, files: Object.fromEntries(groups) }, null, 2));
		return;
	}
	const diagnostics = [...groups].flatMap(([group, paths]) =>
		runGroup(group, paths, { quick: options.has("--quick"), fix: options.has("--fix") }),
	);
	diagnostics.push(...(await lintFrontMenuProject(repositoryRoot)));
	diagnostics.push(...lintPluginPackageProject(repositoryRoot));
	diagnostics.push(...lintPlatformSeparation(repositoryRoot));
	diagnostics.push(...(await lintSuperBoardBrandProject(repositoryRoot)));

	if (options.has("--json")) console.log(JSON.stringify({ diagnostics, coverage }));
	else {
		for (const diagnostic of diagnostics)
			console.log(
				`${diagnostic.filename ?? "lint"}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
			);
		console.log(
			`Checked ${[...groups.values()].reduce((sum, paths) => sum + paths.length, 0)} source files across ${groups.size} lint configurations; ${diagnostics.length} diagnostics.`,
		);
	}
	if (diagnostics.some(({ severity }) => severity === "error" || severity === "warning"))
		process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
