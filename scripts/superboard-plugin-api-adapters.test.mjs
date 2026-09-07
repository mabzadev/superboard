import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validatePluginApiAdapters } from "./superboard-plugin-api-adapters.mjs";

const baseline = {
	source_release_sha256: "reviewed",
	plugins: [
		{
			plugin_id: "example",
			api: [
				{ route_id: "gateway.example.command.publish", method: "POST" },
				{ route_id: "gateway.example.data_source.documents", method: "GET" },
			],
		},
	],
};

function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), "superboard-adapters-"));
	writeFileSync(
		join(root, "client.ts"),
		'export const publish = () => POST(path(id, "/publish"), {});\n',
	);
	const registry = {
		schema_version: 1,
		baseline_source_release_sha256: "reviewed",
		adapters: [
			{
				plugin_id: "example",
				id: "example.command.publish",
				kind: "command",
				status: "verified",
				operations: [
					{
						method: "POST",
						path: "/api/v1/documents/:id/publish",
						parameters: ["id"],
						server_bound_parameters: [],
						parameter_values: {},
						query: "none",
						body: "passthrough",
						sources: [
							{
								file: "client.ts",
								line: 1,
								symbol: "publish",
								expression: 'path(id, "/publish")',
								transport_method: "POST",
							},
						],
					},
				],
			},
			{
				plugin_id: "example",
				id: "example.data_source.documents",
				kind: "data_source",
				status: "unresolved",
				operations: [],
				reason: "A list endpoint has not been implemented.",
				candidates: [],
				sources: [{ file: "client.ts", line: 1, symbol: "publish", expression: "publish" }],
			},
		],
	};
	try {
		run(registry, root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("an explicitly unresolved adapter remains visible and cannot supply dispatch operations", () =>
	fixture((registry, root) => {
		const result = validatePluginApiAdapters(registry, baseline, root);
		assert.deepEqual(result.errors, []);
		assert.deepEqual(result.unresolved, ["example.data_source.documents"]);
		assert.equal(result.dispatch_complete, false);
		registry.adapters[1].operations = registry.adapters[0].operations;
		assert.ok(
			validatePluginApiAdapters(registry, baseline, root).errors.some(
				(error) => error.code === "UNRESOLVED_ADAPTER_DISPATCHABLE",
			),
		);
	}));

test("the frozen baseline catches removed or unknown command IDs", () =>
	fixture((registry, root) => {
		registry.adapters[0].id = "example.command.uninventoried";
		const result = validatePluginApiAdapters(registry, baseline, root);
		assert.ok(result.errors.some((error) => error.code === "UNKNOWN_ADAPTER"));
		assert.ok(result.errors.some((error) => error.code === "MISSING_ADAPTER"));
	}));

test("a changed transport method or stale source expression requires a new review", () =>
	fixture((registry, root) => {
		registry.adapters[0].operations[0].method = "PUT";
		assert.ok(
			validatePluginApiAdapters(registry, baseline, root).errors.some(
				(error) => error.code === "SOURCE_METHOD_MISMATCH",
			),
		);
		registry.adapters[0].operations[0].method = "POST";
		writeFileSync(
			join(root, "client.ts"),
			'export const publish = () => GET(path(id, "/publish"));\n',
		);
		assert.ok(
			validatePluginApiAdapters(registry, baseline, root).errors.some(
				(error) => error.code === "SOURCE_TRANSPORT_MISMATCH",
			),
		);
		writeFileSync(
			join(root, "client.ts"),
			'export const publish = () => POST(path(id, "/archive"), {});\n',
		);
		assert.ok(
			validatePluginApiAdapters(registry, baseline, root).errors.some(
				(error) => error.code === "SOURCE_EXPRESSION_MISMATCH",
			),
		);
	}));

test("external destinations, wildcard dispatch, and unbound path parameters are rejected", () =>
	fixture((registry, root) => {
		const operation = registry.adapters[0].operations[0];
		for (const path of ["https://example.test/publish", "/api/v1/*", "/api/v1/:missing"]) {
			operation.path = path;
			assert.ok(validatePluginApiAdapters(registry, baseline, root).errors.length > 0);
		}
	}));

test("new contributions are declared separately while the historical baseline remains mandatory", () =>
	fixture((registry, root) => {
		const added = { ...registry.adapters[0], id: "example.command.import_history" };
		registry.additional_contributions = [{ plugin_id: "example", id: added.id }];
		registry.adapters.push(added);
		assert.deepEqual(validatePluginApiAdapters(registry, baseline, root).errors, []);
		registry.adapters.shift();
		assert.ok(
			validatePluginApiAdapters(registry, baseline, root).errors.some(
				({ code }) => code === "MISSING_ADAPTER",
			),
		);
	}));

test("additional contributions cannot replace historical ownership or introduce another plugin's IDs", () =>
	fixture((registry, root) => {
		for (const contribution of [
			{ plugin_id: "example", id: "example.command.publish" },
			{ plugin_id: "example", id: "other.command.import_history" },
			{ plugin_id: "other", id: "other.command.import_history" },
		]) {
			registry.additional_contributions = [contribution];
			assert.ok(
				validatePluginApiAdapters(registry, baseline, root).errors.some(
					({ code }) => code === "ADDITIONAL_CONTRIBUTION_INVALID",
				),
			);
		}
	}));
