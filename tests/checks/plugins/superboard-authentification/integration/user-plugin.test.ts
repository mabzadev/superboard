import { describe, expect, test } from "vitest";

import {
	USER_RENDERER_IDS,
	mountUserRenderer,
	userPluginManifest,
	validateUserPluginManifest,
} from "../../../../../packages/plugins/superboard-authentification/src/user.js";

const operator = {
	id: "operator-1",
	email: "operator@example.com",
	name: "Operator",
	role: 50,
	disabled: false,
};

describe("superboard-user", () => {
	test("preserves the canonical issue #48 Store, command, data source and settings names", () => {
		expect(userPluginManifest.stores.map(({ store_id }) => store_id).toSorted()).toEqual([
			"superboard-user.store.user_credentials",
			"superboard-user.store.user_directory",
			"superboard-user.store.user_sessions",
		]);
		expect(userPluginManifest.commands.map(({ command_id }) => command_id).toSorted()).toEqual([
			"superboard-user.command.application_sign_in",
			"superboard-user.command.link_provider",
			"superboard-user.command.revoke_application_session",
			"superboard-user.command.suspend_member",
			"superboard-user.command.update_profile",
		]);
		expect(
			userPluginManifest.data_sources.map(({ data_source_id }) => data_source_id).toSorted(),
		).toEqual([
			"superboard-user.data_source.active_sessions",
			"superboard-user.data_source.current_profile",
			"superboard-user.data_source.linked_providers",
			"superboard-user.data_source.members",
		]);
		expect(Object.keys(userPluginManifest.settings.schema.properties).toSorted()).toEqual([
			"allow_anonymous_upgrade",
			"max_active_sessions",
			"mfa_policy",
		]);
		const signInSchema = userPluginManifest.schemas.find(
			({ schema_id: schemaId }) => schemaId === "superboard-user.schema.application_sign_in.v1",
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

	test("renders login, profile and admin surfaces through validated props", () => {
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
				renderer_id: USER_RENDERER_IDS.profile,
				props: { kind: "profile", operator: { ...operator, id: 42 as unknown as string } },
			}),
		).toMatchObject({ state: "error", isolated: true });
	});
});
