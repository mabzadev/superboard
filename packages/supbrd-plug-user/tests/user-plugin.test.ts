import { describe, expect, test } from "vitest";

import {
	USER_RENDERER_IDS,
	mountUserRenderer,
	userPluginManifest,
	validateUserPluginManifest,
} from "../src/index.js";

const operator = {
	id: "operator-1",
	email: "operator@example.com",
	name: "Operator",
	role: 50,
	disabled: false,
};

describe("supbrd-plug-user", () => {
	test("preserves the canonical issue #48 Store, command, data source and settings names", () => {
		expect(userPluginManifest.stores.map(({ store_id }) => store_id).toSorted()).toEqual([
			"supbrd-plug-user.store.user_credentials",
			"supbrd-plug-user.store.user_directory",
			"supbrd-plug-user.store.user_sessions",
		]);
		expect(userPluginManifest.commands.map(({ command_id }) => command_id).toSorted()).toEqual([
			"supbrd-plug-user.command.application_sign_in",
			"supbrd-plug-user.command.link_provider",
			"supbrd-plug-user.command.revoke_application_session",
			"supbrd-plug-user.command.suspend_member",
			"supbrd-plug-user.command.update_profile",
		]);
		expect(
			userPluginManifest.data_sources.map(({ data_source_id }) => data_source_id).toSorted(),
		).toEqual([
			"supbrd-plug-user.data_source.active_sessions",
			"supbrd-plug-user.data_source.current_profile",
			"supbrd-plug-user.data_source.linked_providers",
			"supbrd-plug-user.data_source.members",
		]);
		expect(Object.keys(userPluginManifest.settings.schema.properties).toSorted()).toEqual([
			"allow_anonymous_upgrade",
			"max_active_sessions",
			"mfa_policy",
		]);
		const signInSchema = userPluginManifest.schemas.find(
			({ schema_id: schemaId }) => schemaId === "supbrd-plug-user.schema.application_sign_in.v1",
		);
		expect(signInSchema?.json_schema).toMatchObject({
			type: "object",
			additionalProperties: false,
			required: ["email", "password"],
			properties: { email: { type: "string" }, password: { type: "string" } },
		});
		expect(
			userPluginManifest.schemas
				.filter(({ schema_id: schemaId }) => !schemaId.endsWith(".schema.empty.v1"))
				.every(
					({ json_schema: schema }) => Array.isArray(schema.required) && schema.required.length > 0,
				),
		).toBe(true);
		expect(
			userPluginManifest.data_sources
				.map(({ store_id }) => store_id)
				.every((storeId) => userPluginManifest.stores.some(({ store_id }) => store_id === storeId)),
		).toBe(true);
		expect(
			userPluginManifest.commands.every(({ store_id: storeId }) =>
				userPluginManifest.stores.some(({ store_id }) => store_id === storeId),
			),
		).toBe(true);
	});

	test("rejects a command whose Store is outside the plugin manifest", async () => {
		const drifted = structuredClone(userPluginManifest);
		drifted.commands[0]!.store_id = "supbrd-plug-user.store.undeclared";
		expect(await validateUserPluginManifest(drifted)).toMatchObject({
			valid: false,
			errors: expect.arrayContaining(["COMMAND_STORE_REFERENCE_INVALID"]),
		});
	});

	test("detects mutation of the packaged implementation contract", async () => {
		expect(await validateUserPluginManifest(userPluginManifest)).toEqual({
			valid: true,
			errors: [],
		});
		const drifted = structuredClone(userPluginManifest);
		drifted.capabilities.push("identity.undeclared");
		expect(await validateUserPluginManifest(drifted)).toMatchObject({
			valid: false,
			errors: expect.arrayContaining(["ARTIFACT_CHECKSUM_MISMATCH"]),
		});
	});

	test("registers every renderer props schema in the common manifest", () => {
		const schemaIds = new Set(userPluginManifest.schemas.map(({ schema_id }) => schema_id));
		expect(
			userPluginManifest.renderers.every(({ props_schema }) =>
				schemaIds.has(props_schema.schema_id),
			),
		).toBe(true);
	});

	test("rejects unknown fields inside contribution descriptors", async () => {
		const openContribution = structuredClone(userPluginManifest);
		Object.assign(openContribution.stores[0]!, { undeclared_policy: "allow" });
		expect(await validateUserPluginManifest(openContribution)).toMatchObject({
			valid: false,
			errors: expect.arrayContaining(["CONTRIBUTION_NOT_CLOSED"]),
		});
	});

	test("renders passkey, profile and member data through validated props", () => {
		const login = mountUserRenderer({
			renderer_id: USER_RENDERER_IDS.login,
			props: { kind: "login", title_message_id: "user.page.sign_in" },
		});
		expect(login).toMatchObject({
			kind: "login",
			action_id: "emdash.core.action.admin_session_start",
		});
		const profile = mountUserRenderer({
			renderer_id: USER_RENDERER_IDS.profile,
			props: { kind: "profile", operator },
		});
		expect(profile).toMatchObject({ kind: "profile", operator: { email: "operator@example.com" } });
		const members = mountUserRenderer({
			renderer_id: USER_RENDERER_IDS.members,
			props: { kind: "members", page_size: 10, members: [operator] },
		});
		expect(members).toMatchObject({ kind: "members", members: [{ id: "operator-1" }] });
		const admin = mountUserRenderer({
			renderer_id: USER_RENDERER_IDS.admin,
			props: {
				kind: "admin_surface",
				route_id: "superboard.identity.apps",
				path: "/identity/en/apps",
			},
		});
		expect(admin).toMatchObject({
			kind: "admin_surface",
			route_id: "superboard.identity.apps",
			path: "/identity/en/apps",
		});
	});

	test("isolates invalid plugin props", () => {
		expect(
			mountUserRenderer({
				renderer_id: USER_RENDERER_IDS.members,
				props: { kind: "members", page_size: 5, members: [] },
			}),
		).toMatchObject({ state: "error", isolated: true });
	});
});
