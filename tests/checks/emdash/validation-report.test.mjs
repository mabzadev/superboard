import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPluginValidationReport } from "./validation-report.mjs";

const baseline = {
	plugins: [
		{
			plugin_id: "example",
			routes: [{ route_id: "example.detail", path: "/example/:id" }],
			navigation: [{ route_id: "example.detail", href: "/example/:id" }],
			api: [{ route_id: "example.save", method: "POST", path_pattern: "/example/:id" }],
		},
	],
};
const evidencePath = fileURLToPath(import.meta.url);

function completeEvidence() {
	return buildPluginValidationReport(baseline, []).checks.map((check) => ({
		plugin_id: check.plugin_id,
		route_id: check.route_id,
		scenario: check.scenario,
		status: "passed",
		type: "browser",
		evidence_path: evidencePath,
		data_ids: ["created-example"],
	}));
}

test("a compilation or composition proof cannot satisfy browser or persistence coverage", () => {
	const report = buildPluginValidationReport(
		baseline,
		completeEvidence().map((evidence) => ({ ...evidence, type: "unit" })),
	);
	assert.equal(report.complete, false);
	assert.ok(report.checks.every(({ status }) => status === "inadequate"));
});

test("removing a route from evidence leaves the frozen baseline route unverified", () => {
	const evidence = completeEvidence().filter(({ route_id }) => route_id !== "example.detail");
	const report = buildPluginValidationReport(baseline, evidence);
	assert.equal(report.complete, false);
	assert.ok(
		report.checks.some(
			({ route_id, status }) => route_id === "example.detail" && status === "unverified",
		),
	);
});

test("mutation proof requires persisted data identifiers and an existing artifact", () => {
	const evidence = completeEvidence();
	const mutation = evidence.find(({ scenario }) => scenario === "mutation");
	mutation.data_ids = [];
	assert.equal(buildPluginValidationReport(baseline, evidence).complete, false);
	mutation.data_ids = ["created-example"];
	mutation.evidence_path = `${evidencePath}.missing`;
	assert.equal(buildPluginValidationReport(baseline, evidence).complete, false);
});

test("explicit complete evidence passes and a recorded failure cannot be hidden by a successful duplicate", () => {
	const evidence = completeEvidence();
	assert.equal(buildPluginValidationReport(baseline, evidence).complete, true);
	const report = buildPluginValidationReport(baseline, [
		...evidence,
		{ ...evidence[0], status: "failed" },
	]);
	assert.equal(report.complete, false);
	assert.equal(report.checks[0].status, "failed");
});

test("evidence for a renamed or unknown route fails instead of silently shrinking coverage", () => {
	const report = buildPluginValidationReport(baseline, [
		...completeEvidence(),
		{
			plugin_id: "example",
			route_id: "example.uninventoried",
			scenario: "render",
			status: "passed",
			type: "browser",
			evidence_path: evidencePath,
		},
	]);
	assert.equal(report.complete, false);
	assert.equal(report.problems.length, 1);
});

test("added views require browser evidence without replacing any frozen baseline checks", () => {
	const additions = [{ plugin_id: "example", route_id: "example.extra", path: "/extra" }];
	const before = JSON.stringify(baseline);
	const report = buildPluginValidationReport(baseline, completeEvidence(), additions);
	assert.equal(report.complete, false);
	assert.equal(report.checks.filter((check) => check.route_id === "example.extra").length, 4);
	assert.ok(
		report.checks
			.filter((check) => check.route_id === "example.extra")
			.every((check) => check.status === "unverified"),
	);
	assert.ok(report.checks.some((check) => check.route_id === "example.detail"));
	assert.equal(JSON.stringify(baseline), before);
	const evidence = report.checks.map((check) => ({
		...check,
		status: "passed",
		type: "browser",
		evidence_path: evidencePath,
		data_ids: ["persisted"],
	}));
	assert.equal(buildPluginValidationReport(baseline, evidence, additions).complete, true);
});

test("the current implementation inventory cannot remove or duplicate historical view requirements", () => {
	const additions = [{ plugin_id: "example", route_id: "example.detail", path: "/changed" }];
	const report = buildPluginValidationReport(baseline, completeEvidence(), additions);
	assert.equal(report.complete, true);
	assert.equal(report.checks.filter((check) => check.surface === "view").length, 4);
	assert.ok(
		report.checks
			.filter((check) => check.surface === "view")
			.every((check) => check.path === "/example/:id"),
	);
});

test("added API commands need persisted mutation evidence alongside the historical API", () => {
	const additions = [
		{ plugin_id: "example", id: "example.command.import_history" },
		{ plugin_id: "example", id: "example.data_source.import_status" },
	];
	const report = buildPluginValidationReport(baseline, completeEvidence(), [], additions);
	assert.equal(report.complete, false);
	const added = report.checks.filter((check) => check.added && check.surface === "api");
	assert.equal(added.length, 2);
	assert.ok(added.every((check) => check.status === "unverified"));
	const proof = added.map((check) => ({
		...check,
		status: "passed",
		type: "integration",
		evidence_path: evidencePath,
		data_ids: ["imported-purchase"],
	}));
	assert.equal(
		buildPluginValidationReport(baseline, [...completeEvidence(), ...proof], [], additions)
			.complete,
		true,
	);
	assert.ok(report.checks.some((check) => check.route_id === "example.save"));
});
