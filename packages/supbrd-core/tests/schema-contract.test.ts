import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, test } from "vitest";

import schema from "../schemas/front-release-input.schema.json";

const minimalInput = {
	schema_version: "1.0.0",
	compiler_version: "0.1.0",
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000001",
	draft_snapshot_id: "01J00000000000000000000002",
	compilation_id: "01J00000000000000000000003",
	candidate_id: "01J00000000000000000000004",
	release_id: "01J00000000000000000000005",
	release_sequence: 1,
	previous_release_id: null,
	created_at: "2026-08-29T18:00:00.000Z",
	front_route_manifest: {
		schema_version: "1.0.0",
		manifest_id: "01J00000000000000000000006",
		normalization: {
			unicode: "NFC",
			case_sensitive: true,
			trailing_slash: "strip",
			percent_decoding: "once",
		},
		auth_transitions: {
			login_route_id: "superboard.login",
			authenticated_home_route_id: "superboard.admin.home",
		},
		system_routes: [],
		routes: [],
	},
	gateway_manifest: {
		schema_version: "1.0.0",
		gateway_manifest_id: "01J00000000000000000000007",
		routes: [],
	},
	presentation: {
		pages: [],
		layouts: [],
		navigation: [],
		translations: [],
		media: [],
		theme: { theme_id: "theme.superboard", tokens: {} },
	},
	renderers: [],
	plugin_lock: [],
	dependency_policies: [],
	rollback: { classification: "pointer_only", restore_point_id: null, conditions: [] },
	core_concrete_pages: [],
};

describe("persistent Front Release input contract", () => {
	test("is a closed JSON Schema 2020-12 contract", () => {
		const validate = new Ajv2020({ strict: true }).compile(schema);
		expect(validate(minimalInput)).toBe(true);
		expect(validate({ ...minimalInput, unknown: true })).toBe(false);
		expect(validate.errors).toContainEqual(
			expect.objectContaining({ keyword: "additionalProperties" }),
		);
	});
});
