import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lifecycleScenarios = [
	"activate",
	"deactivate",
	"reactivate",
	"standalone",
	"data-retention",
	"direct-route-rejection",
	"direct-api-rejection",
];
const browserScenarios = ["render", "reload", "navigation", "functional"];
const navigationScenarios = ["menu-active", "menu-disabled", "menu-reactivated"];
const key = ({ plugin_id, route_id, scenario }) =>
	JSON.stringify([plugin_id, route_id ?? null, scenario]);

function requirements(baseline, addedViews, addedContributions) {
	const checks = [
		{
			plugin_id: "emdash-core",
			route_id: null,
			scenario: "all-disabled",
			surface: "core",
			minimum: "integration",
		},
	];
	for (const plugin of baseline.plugins) {
		for (const scenario of lifecycleScenarios)
			checks.push({
				plugin_id: plugin.plugin_id,
				route_id: null,
				scenario,
				surface: "lifecycle",
				minimum: "integration",
			});
		for (const route of plugin.routes) {
			for (const scenario of browserScenarios)
				checks.push({
					plugin_id: plugin.plugin_id,
					route_id: route.route_id,
					path: route.path,
					scenario,
					surface: "view",
					minimum: "browser",
				});
		}
		for (const navigation of plugin.navigation) {
			for (const scenario of navigationScenarios)
				checks.push({
					plugin_id: plugin.plugin_id,
					route_id: navigation.route_id,
					path: navigation.href,
					scenario,
					surface: "navigation",
					minimum: "browser",
				});
		}
		for (const api of plugin.api)
			checks.push({
				plugin_id: plugin.plugin_id,
				route_id: api.route_id,
				path: api.path_pattern,
				scenario: api.method === "GET" ? "read" : "mutation",
				surface: "api",
				minimum: "integration",
			});
	}
	const knownViews = new Set(
		checks
			.filter((check) => check.surface === "view")
			.map((check) => JSON.stringify([check.plugin_id, check.route_id])),
	);
	for (const view of addedViews) {
		const id = JSON.stringify([view.plugin_id, view.route_id]);
		if (knownViews.has(id)) continue;
		knownViews.add(id);
		for (const scenario of browserScenarios)
			checks.push({
				plugin_id: view.plugin_id,
				route_id: view.route_id,
				path: view.path,
				scenario,
				surface: "view",
				minimum: "browser",
				added: true,
			});
	}
	const knownApi = new Set(
		checks.filter((check) => check.surface === "api").map((check) => check.route_id),
	);
	for (const contribution of addedContributions) {
		const routeId = `gateway.${contribution.id}`;
		if (knownApi.has(routeId)) continue;
		knownApi.add(routeId);
		const command = contribution.id.startsWith(`${contribution.plugin_id}.command.`);
		checks.push({
			plugin_id: contribution.plugin_id,
			route_id: routeId,
			path: `/_emdash/api/superboard/plugins/${contribution.plugin_id}/${command ? "commands" : "data-sources"}/${contribution.id}`,
			scenario: command ? "mutation" : "read",
			surface: "api",
			minimum: "integration",
			added: true,
		});
	}
	return checks;
}

export function buildPluginValidationReport(
	baseline,
	evidence,
	addedViews = [],
	addedContributions = [],
) {
	const expected = requirements(baseline, addedViews, addedContributions);
	const expectedKeys = new Set(expected.map(key));
	const records = new Map();
	const problems = [];
	for (const record of evidence) {
		const recordKey = key(record);
		if (!expectedKeys.has(recordKey)) {
			problems.push({
				code: "UNRECOGNIZED_EVIDENCE",
				plugin_id: record.plugin_id,
				route_id: record.route_id,
				scenario: record.scenario,
			});
			continue;
		}
		const entries = records.get(recordKey) ?? [];
		entries.push(record);
		records.set(recordKey, entries);
	}
	const checks = expected.map((check) => {
		const entries = records.get(key(check)) ?? [];
		let status = "unverified";
		if (entries.some((entry) => entry.status === "failed")) status = "failed";
		else if (entries.length) {
			const acceptable = entries.some(
				(entry) =>
					entry.status === "passed" &&
					(entry.type === "browser" ||
						(check.minimum === "integration" && entry.type === "integration")) &&
					typeof entry.evidence_path === "string" &&
					existsSync(resolve(repositoryRoot, entry.evidence_path)) &&
					(check.scenario !== "mutation" ||
						(Array.isArray(entry.data_ids) &&
							entry.data_ids.some((id) => typeof id === "string" && id.trim()))),
			);
			status = acceptable ? "passed" : "inadequate";
		}
		return { ...check, status, evidence: entries };
	});
	return {
		schema_version: 1,
		baseline_source_commit: baseline.source_commit ?? null,
		baseline_source_release_sha256: baseline.source_release_sha256 ?? null,
		complete: problems.length === 0 && checks.every((check) => check.status === "passed"),
		summary: Object.fromEntries(
			["passed", "failed", "unverified", "inadequate"].map((status) => [
				status,
				checks.filter((check) => check.status === status).length,
			]),
		),
		problems,
		checks,
	};
}

export function renderPluginValidationMarkdown(report) {
	const lines = [
		"# Plugin and view validation",
		"",
		`Status: ${report.complete ? "complete" : "incomplete"}.`,
		"",
		"| Plugin | Surface | Route or scenario | Result | Evidence |",
		"| --- | --- | --- | --- | --- |",
	];
	for (const check of report.checks) {
		const artifacts = [
			...new Set(check.evidence.map((entry) => entry.evidence_path).filter(Boolean)),
		].join(", ");
		lines.push(
			`| ${check.plugin_id} | ${check.surface} | ${check.path ?? check.route_id ?? ""} · ${check.scenario} | ${check.status} | ${artifacts} |`,
		);
	}
	if (report.problems.length)
		lines.push(
			"",
			"Unrecognized evidence:",
			"",
			...report.problems.map(
				(problem) => `- ${problem.plugin_id}: ${problem.route_id ?? ""} ${problem.scenario}`,
			),
		);
	return `${lines.join("\n")}\n`;
}

function main() {
	const arguments_ = process.argv.slice(2);
	const value = (flag) => {
		const index = arguments_.indexOf(flag);
		return index === -1 ? null : arguments_[index + 1];
	};
	const evidencePath = value("--evidence");
	const outputPath = value("--output");
	if (!evidencePath || !outputPath)
		throw new Error(
			"Usage: superboard-plugin-validation-report.mjs --evidence <JSON array> --output <report.json>",
		);
	const baseline = JSON.parse(
		readFileSync(
			resolve(repositoryRoot, "config/superboard-plugin-independence-baseline.json"),
			"utf8",
		),
	);
	const evidence = JSON.parse(readFileSync(resolve(evidencePath), "utf8"));
	if (!Array.isArray(evidence)) throw new Error("Evidence must be a JSON array");
	const implementations = JSON.parse(
		readFileSync(
			resolve(repositoryRoot, "config/superboard-front-view-implementations.json"),
			"utf8",
		),
	);
	const adapters = JSON.parse(
		readFileSync(resolve(repositoryRoot, "config/superboard-plugin-api-adapters.json"), "utf8"),
	);
	const report = buildPluginValidationReport(
		baseline,
		evidence,
		implementations.views,
		adapters.additional_contributions ?? [],
	);
	const output = resolve(outputPath);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
	writeFileSync(`${output}.md`, renderPluginValidationMarkdown(report));
	console.log(JSON.stringify({ complete: report.complete, summary: report.summary, output }));
	if (!report.complete) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
