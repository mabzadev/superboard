import { describe, expect, test } from "vitest";

import { unwrapMigratedPayload } from "../src/lib/plugin-data-source.js";

describe("plugin data source payloads", () => {
	test("unwraps migrated repository rows into their business object", () => {
		expect(
			unwrapMigratedPayload({
				entity_id: "workflow-1",
				project_id: "1",
				payload_json: '{"id":"workflow-1","name":"Welcome"}',
			}),
		).toEqual({ id: "workflow-1", name: "Welcome" });
	});

	test("preserves records written directly by a plugin repository", () => {
		expect(unwrapMigratedPayload({ id: "direct-1", active: true })).toEqual({
			id: "direct-1",
			active: true,
		});
	});

	test("fails closed on a corrupt migrated payload", () => {
		expect(() => unwrapMigratedPayload({ payload_json: "{" })).toThrow(
			"PLUGIN_STORE_PAYLOAD_INVALID",
		);
	});
});
