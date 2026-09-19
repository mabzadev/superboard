import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { diagnostic, lintRepository, maintainedFile, trackedFiles } from "./repository.mjs";

const root = resolve(import.meta.dirname, "../..");
const baselinePath = resolve(root, "tests/lints/baseline.json");
const sourcePattern = /(?:\.[cm]?[jt]sx?|\.astro)$/u;
const fatalPattern =
	/(?:secret-access:build|tool-failure|parse-error|tsconfig-error|configuration-syntax|duplicate-key|command-path|schema-path|configuration-schema|migration-changed|baseline-expanded|no-focused-tests|test-integrity.*focused)/u;

export function qualitySources(paths) {
	return paths.filter(
		(path) =>
			maintainedFile(path) &&
			sourcePattern.test(path) &&
			!path.startsWith("sdks/web/flows/upstream/") &&
			!/(?:^|\/)worker-configuration\.d\.ts$/u.test(path) &&
			!path.startsWith("tests/fixtures/lints/"),
	);
}

export function parseToolResult(result, name) {
	if (result.error || result.signal || result.status === null)
		throw new Error(
			`${name}: ${result.error?.message ?? result.signal ?? "process did not finish"}`,
		);
	const parsed = JSON.parse(result.stdout);
	if (result.status !== 0 && result.status !== 1)
		throw new Error(`${name}: exit ${result.status}: ${result.stderr}`);
	return parsed;
}

export function baselineKey(item, source = "") {
	const line = item.labels?.[0]?.span?.line;
	const excerpt = line ? (source.split("\n")[line - 1]?.trim() ?? "") : "";
	const message = item.code.includes("react-hooks/")
		? item.message.replace(/\n\n(?:\/|[A-Za-z]:[\\/])[^\n]+:\d+:\d+\n[\s\S]*$/u, "")
		: item.message;
	const hash = createHash("sha256").update(`${message}\0${excerpt}`).digest("hex").slice(0, 20);
	return `${item.filename}|${item.code}|${hash}`;
}

function readDiagnosticSource(filename) {
	const path = resolve(root, filename);
	return statSync(path, { throwIfNoEntry: false })?.isFile() ? readFileSync(path, "utf8") : "";
}

export function applyBaseline(diagnostics, baseline, readSource = readDiagnosticSource) {
	const remaining = { ...baseline.entries };
	const sources = new Map();
	const fresh = [];
	let existing = 0;
	for (const item of diagnostics) {
		if (!sources.has(item.filename)) sources.set(item.filename, readSource(item.filename));
		const key = baselineKey(item, sources.get(item.filename));
		if (!fatalPattern.test(item.code) && remaining[key] > 0) {
			remaining[key]--;
			existing++;
		} else fresh.push(item);
	}
	return { diagnostics: fresh, existing, total: diagnostics.length };
}

export function captureBaseline(diagnostics) {
	if (diagnostics.some((item) => fatalPattern.test(item.code)))
		throw new Error(
			"Fix command paths, invalid configuration and analyzer failures before capturing a baseline.",
		);
	const entries = {};
	const rules = {};
	const sources = new Map();
	for (const item of diagnostics) {
		if (!sources.has(item.filename))
			sources.set(item.filename, readDiagnosticSource(item.filename));
		const key = baselineKey(item, sources.get(item.filename));
		entries[key] = (entries[key] ?? 0) + 1;
		rules[item.code] = (rules[item.code] ?? 0) + 1;
	}
	return {
		version: 2,
		rules,
		entries: Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))),
	};
}

export function lintMigrations(baseRef, workspaceRoot = root) {
	const result = spawnSync(
		"git",
		[
			"diff",
			"--name-status",
			"--no-renames",
			baseRef,
			"--",
			"**/migrations/*.sql",
			"**/migrations/[0-9]*.ts",
		],
		{ cwd: workspaceRoot, encoding: "utf8" },
	);
	if (result.status !== 0) throw new Error(result.stderr || "Cannot compare migrations");
	return result.stdout
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			const [status, filename] = line.split("\t");
			return status === "M" || status === "D"
				? [
						diagnostic(
							filename,
							"migration-changed",
							`An existing migration changed relative to ${baseRef}; add a forward migration.`,
						),
					]
				: [];
		});
}

export function lintBaselineChanges(baseRef, workspaceRoot = root) {
	const filename = "tests/lints/baseline.json";
	if (!existsSync(resolve(workspaceRoot, filename))) return [];
	const listing = spawnSync("git", ["ls-tree", "--name-only", baseRef, "--", filename], {
		cwd: workspaceRoot,
		encoding: "utf8",
	});
	if (listing.status !== 0) throw new Error(listing.stderr || "Cannot inspect baseline history");
	if (!listing.stdout.trim()) return [];
	const result = spawnSync("git", ["show", `${baseRef}:${filename}`], {
		cwd: workspaceRoot,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	if (result.status !== 0) throw new Error(result.stderr || "Cannot read baseline history");
	const previous = JSON.parse(result.stdout);
	const current = JSON.parse(readFileSync(resolve(workspaceRoot, filename), "utf8"));
	const additions = Object.entries(current.entries).filter(
		([key, count]) => count > (previous.entries[key] ?? 0),
	);
	return additions.length
		? [
				diagnostic(
					filename,
					"baseline-expanded",
					`${additions.length} baseline allowances were added or increased. Fix new findings; a baseline must not hide regressions.`,
				),
			]
		: [];
}

async function lintSyntax(paths) {
	if (!paths.length) return [];
	mkdirSync(resolve(root, "node_modules/.cache/superboard-lint"), { recursive: true });
	const configurationHash = createHash("sha256");
	for (const path of [
		"tests/lints/quality.config.mjs",
		"tests/lints/quality-rules.mjs",
		"pnpm-lock.yaml",
	])
		configurationHash.update(readFileSync(resolve(root, path)));
	const eslint = new ESLint({
		allowInlineConfig: false,
		cwd: root,
		overrideConfigFile: resolve(root, "tests/lints/quality.config.mjs"),
		cache: true,
		cacheStrategy: "content",
		cacheLocation: resolve(
			root,
			`node_modules/.cache/superboard-lint/eslint-${configurationHash.digest("hex").slice(0, 16)}`,
		),
	});
	const reports = await eslint.lintFiles(paths);
	return reports.flatMap((report) =>
		report.messages.map((message) => ({
			filename: relative(root, report.filePath),
			code: `quality-eslint(${message.ruleId ?? "parse-error"}${message.messageId ? `:${message.messageId}` : ""})`,
			message: message.message,
			severity: message.severity === 2 ? "error" : "warning",
			labels: [{ span: { line: message.line, column: message.column } }],
		})),
	);
}

function lintTyped(paths, quick) {
	const diagnostics = [];
	const typescriptPaths = paths.filter(
		(path) => /\.[cm]?tsx?$/u.test(path) && !path.startsWith("tests/fixtures/"),
	);
	for (let offset = 0; offset < typescriptPaths.length; offset += 1000) {
		const result = spawnSync(
			resolve(root, "node_modules/.bin/oxlint"),
			[
				"--config",
				"tests/lints/quality.oxlintrc.json",
				"--disable-nested-config",
				"--format",
				"json",
				...(quick ? [] : ["--type-aware"]),
				...typescriptPaths.slice(offset, offset + 1000),
			],
			{
				cwd: root,
				encoding: "utf8",
				maxBuffer: 128 * 1024 * 1024,
				timeout: 180_000,
				env: { ...process.env, GOMAXPROCS: process.env.GOMAXPROCS || "2" },
			},
		);
		const parsed = parseToolResult(result, "typed lint");
		if (!Array.isArray(parsed.diagnostics) || (result.status && !parsed.diagnostics.length))
			throw new Error(result.stderr || "Typed analyzer failed without diagnostics");
		diagnostics.push(
			...parsed.diagnostics.map((item) => ({ ...item, code: `quality-${item.code}` })),
		);
	}
	return diagnostics;
}

export function normalizeKnip(report) {
	if (!Array.isArray(report.files) || !Array.isArray(report.issues))
		throw new Error("Knip returned an invalid report");
	const diagnostics = report.files.map((file) =>
		diagnostic(
			typeof file === "string" ? file : file.filePath,
			"unused-file",
			"File is unreachable from the declared runtime, build and test entries.",
		),
	);
	for (const issue of report.issues) {
		for (const [kind, symbols] of Object.entries(issue)) {
			if (["file", "owners"].includes(kind)) continue;
			const values = Array.isArray(symbols)
				? symbols.flat()
				: symbols && typeof symbols === "object"
					? Object.entries(symbols).flatMap(([parent, members]) =>
							members.map((member) => ({ ...member, name: `${parent}.${member.name}` })),
						)
					: [];
			for (const symbol of values)
				diagnostics.push(
					diagnostic(
						issue.file,
						`knip-${kind}`,
						`${kind}: ${typeof symbol === "string" ? symbol : (symbol.name ?? JSON.stringify(symbol))}`,
						symbol.line,
					),
				);
		}
	}
	return diagnostics;
}

export function testDependencyDeclared(filename, name, workspaceRoot = root) {
	if (!filename.startsWith("tests/checks/")) return false;
	const path = filename.slice("tests/checks/".length).replace(/^plugins\//u, "packages/plugins/");
	if (!/^(?:apps|packages|sdks|infra)\//u.test(path)) return false;
	let directory = resolve(workspaceRoot, path, "..");
	while (directory !== workspaceRoot && directory.startsWith(`${workspaceRoot}/`)) {
		const manifestPath = resolve(directory, "package.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			return (
				name === manifest.name ||
				["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
					(section) => Object.hasOwn(manifest[section] ?? {}, name),
				)
			);
		}
		directory = resolve(directory, "..");
	}
	return false;
}

function lintKnip() {
	const result = spawnSync(resolve(root, "node_modules/.bin/knip"), ["--reporter", "json"], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 128 * 1024 * 1024,
		timeout: 180_000,
	});
	const reportLine = result.stdout.split("\n").findLast((line) => line.startsWith('{"files":'));
	const reported = normalizeKnip(
		parseToolResult({ ...result, stdout: reportLine ?? result.stdout }, "knip"),
	);
	if (result.status && !reported.length)
		throw new Error(result.stderr || "Knip failed without reporting an issue");
	return reported.filter(
		(item) =>
			item.code !== "quality(knip-unlisted)" ||
			!testDependencyDeclared(item.filename, item.message.slice("unlisted: ".length)),
	);
}

export async function lintQuality({
	paths = trackedFiles(root),
	quick = false,
	knipOnly = false,
	capture = false,
	raw = false,
} = {}) {
	const diagnostics = [];
	try {
		if (knipOnly) diagnostics.push(...lintKnip());
		else {
			const sources = qualitySources(paths);
			diagnostics.push(...(await lintSyntax(sources)));
			diagnostics.push(...lintTyped(sources, quick));
			diagnostics.push(...lintRepository(root));
			diagnostics.push(...lintMigrations(process.env.SUPERBOARD_LINT_BASE || "HEAD"));
			diagnostics.push(...lintBaselineChanges(process.env.SUPERBOARD_LINT_BASE || "HEAD"));
			if (!quick) diagnostics.push(...lintKnip());
		}
	} catch (error) {
		diagnostics.push(diagnostic("tests/lints/quality.mjs", "tool-failure", error.message));
	}
	if (capture) {
		if (quick || knipOnly) throw new Error("A baseline requires the complete quality analysis.");
		writeFileSync(baselinePath, `${JSON.stringify(captureBaseline(diagnostics), null, "\t")}\n`);
	}
	if (raw) return { diagnostics, existing: 0, total: diagnostics.length };
	const baseline = existsSync(baselinePath)
		? JSON.parse(readFileSync(baselinePath, "utf8"))
		: { entries: {} };
	return applyBaseline(diagnostics, baseline);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const options = new Set(process.argv.slice(2));
	const report = await lintQuality({
		quick: options.has("--quick"),
		knipOnly: options.has("--knip"),
		capture: options.has("--capture-baseline"),
		raw: options.has("--raw"),
	});
	console.log(JSON.stringify(report, null, 2));
	if (report.diagnostics.length) process.exitCode = 1;
}
