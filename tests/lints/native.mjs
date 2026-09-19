import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyBaseline, captureBaseline } from "./quality.mjs";
import { diagnostic, maintainedFile, trackedFiles } from "./repository.mjs";

const root = resolve(import.meta.dirname, "../..");
const baselinePath = resolve(root, "tests/lints/baseline.json");

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		timeout: 180_000,
		...options,
	});
	if (result.error || result.signal || result.status === null)
		throw new Error(`${command}: ${result.error?.message ?? result.signal}`);
	return result;
}

export function parseDartDiagnostics(output) {
	return output
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [severity, kind, code, file, lineNumber, , , ...message] = line.split("|");
			if (!["INFO", "WARNING", "ERROR"].includes(severity) || !kind || !file)
				throw new Error(`Unexpected Dart analyzer output: ${line}`);
			return diagnostic(
				relative(root, file),
				`native-dart-${code}`,
				message.join("|"),
				Number(lineNumber),
			);
		});
}

export function parseSarif(report) {
	if (!Array.isArray(report.runs)) throw new Error("The analyzer did not produce a SARIF report");
	return report.runs.flatMap((run) =>
		(run.results ?? []).map((item) => {
			const location = item.locations?.[0]?.physicalLocation;
			const artifact = location?.artifactLocation;
			const uri = artifact?.uri ?? "tests/lints/android.gradle";
			const base = run.originalUriBaseIds?.[artifact?.uriBaseId]?.uri;
			const resolvedUri = base ? new URL(uri, base).href : uri;
			const path = resolvedUri.startsWith("file:")
				? relative(root, fileURLToPath(resolvedUri))
				: resolvedUri;
			return diagnostic(
				path,
				`native-android-${item.ruleId}`,
				item.message.text,
				location?.region?.startLine,
			);
		}),
	);
}

export function lintNative(group) {
	const diagnostics = [];
	try {
		const paths = trackedFiles(root)
			.filter(maintainedFile)
			.filter((path) => !path.startsWith("sdks/web/flows/upstream/"));
		if (group === "automation") {
			const workflows = paths.filter((path) => /^\.github\/workflows\/.*\.ya?ml$/u.test(path));
			if (!workflows.length) throw new Error("No workflows were selected");
			const result = run("actionlint", ["-format", "{{json .}}", ...workflows]);
			const errors = JSON.parse(result.stdout || "null") ?? [];
			if (result.status && !errors.length)
				throw new Error(result.stderr || "Actionlint failed without diagnostics");
			for (const error of errors)
				diagnostics.push(
					diagnostic(error.filepath, `native-workflow-${error.kind}`, error.message, error.line),
				);
			const scripts = paths.filter(
				(path) => path.endsWith(".sh") || /^\.husky\/[^/.]+$/u.test(path),
			);
			for (const script of scripts) {
				const report = run("shellcheck", [
					"--format=json",
					...(script.startsWith(".husky/") ? ["--shell=sh"] : []),
					script,
				]);
				const issues = JSON.parse(report.stdout);
				if (report.status && !issues.length)
					throw new Error(report.stderr || "ShellCheck failed without diagnostics");
				for (const issue of issues)
					diagnostics.push(
						diagnostic(issue.file, `native-shell-SC${issue.code}`, issue.message, issue.line),
					);
			}
		} else if (group === "dart") {
			for (const sdk of ["flutter", "flutterflow"]) {
				const report = run("dart", ["analyze", "--format=machine", "lib"], {
					cwd: resolve(root, "sdks", sdk),
				});
				const issues = parseDartDiagnostics(report.stdout.trim());
				if (report.status && !issues.length)
					throw new Error(report.stderr || `Dart failed for ${sdk} without diagnostics`);
				diagnostics.push(...issues);
			}
		} else if (group === "swift") {
			const files = paths.filter(
				(path) => path.endsWith(".swift") && /^(?:sdks|tests\/checks\/sdks)\//u.test(path),
			);
			if (!files.length) throw new Error("No Swift source files were selected");
			const report = run(
				"swiftlint",
				[
					"lint",
					"--quiet",
					"--strict",
					"--reporter",
					"json",
					"--config",
					"tests/lints/swiftlint.yml",
					"--use-script-input-files",
				],
				{
					env: {
						...process.env,
						SCRIPT_INPUT_FILE_COUNT: String(files.length),
						...Object.fromEntries(
							files.map((path, i) => [`SCRIPT_INPUT_FILE_${i}`, resolve(root, path)]),
						),
					},
				},
			);
			const issues = JSON.parse(report.stdout);
			if (report.status && !issues.length)
				throw new Error(report.stderr || "SwiftLint failed without diagnostics");
			for (const issue of issues)
				diagnostics.push(
					diagnostic(
						relative(root, issue.file),
						`native-swift-${issue.rule_id}`,
						issue.reason,
						issue.line,
					),
				);
		} else if (group === "android") {
			const project = "sdks/flutter/native/android/SuperBoard";
			const reports = [
				`${project}/SuperBoard/build/reports/lint-results-release.sarif`,
				`${project}/build/reports/detekt.sarif`,
			];
			for (const report of reports) rmSync(resolve(root, report), { force: true });
			const result = run(
				`${project}/gradlew`,
				[
					"-p",
					project,
					"--init-script",
					resolve(root, "tests/lints/android.gradle"),
					":SuperBoard:lintRelease",
					"lintKotlin",
					"--console=plain",
				],
				{ timeout: 600_000 },
			);
			if (result.status !== 0)
				throw new Error(
					`Gradle exited ${result.status}: ${(result.stderr || result.stdout).slice(-4000)}`,
				);
			for (const report of reports) {
				if (!existsSync(resolve(root, report)))
					throw new Error(`Missing analyzer report: ${report}`);
				diagnostics.push(...parseSarif(JSON.parse(readFileSync(resolve(root, report), "utf8"))));
			}
		} else throw new Error(`Unknown analyzer group: ${group}`);
	} catch (error) {
		diagnostics.push(diagnostic("tests/lints/native.mjs", "native-tool-failure", error.message));
	}
	return diagnostics;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const diagnostics = lintNative(process.argv[2]);
	let baseline = existsSync(baselinePath)
		? JSON.parse(readFileSync(baselinePath, "utf8"))
		: { version: 1, rules: {}, entries: {} };
	if (process.argv.includes("--capture-baseline")) {
		const captured = captureBaseline(diagnostics);
		baseline = {
			...baseline,
			entries: { ...baseline.entries, ...captured.entries },
			rules: { ...baseline.rules, ...captured.rules },
		};
		writeFileSync(baselinePath, `${JSON.stringify(baseline, null, "\t")}\n`);
	}
	const report = process.argv.includes("--raw")
		? { diagnostics }
		: applyBaseline(diagnostics, baseline);
	console.log(JSON.stringify(report, null, 2));
	if (report.diagnostics.length) process.exitCode = 1;
}
