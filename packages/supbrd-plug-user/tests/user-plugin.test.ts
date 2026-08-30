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
	test("preserves every canonical Store authority while upgrading the Front artifact", () => {
		expect(userPluginManifest.stores.map(({ store_id }) => store_id).toSorted()).toEqual([
			"supbrd-plug-user.store.access_keys",
			"supbrd-plug-user.store.credentials",
			"supbrd-plug-user.store.customers",
			"supbrd-plug-user.store.directory",
			"supbrd-plug-user.store.referrals",
			"supbrd-plug-user.store.sessions",
		]);
		expect(
			userPluginManifest.data_sources
				.map(({ store_id }) => store_id)
				.every((storeId) => userPluginManifest.stores.some(({ store_id }) => store_id === storeId)),
		).toBe(true);
	});

	test("detects mutation of the packaged implementation contract", async () => {
		expect(await validateUserPluginManifest(userPluginManifest)).toEqual({ valid: true, errors: [] });
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
			userPluginManifest.renderers.every(({ props_schema }) => schemaIds.has(props_schema.schema_id)),
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
