import { describe, expect, test } from "vitest";
import { compileFrontRelease, resolveFrontRequest } from "@superboard/supbrd-core";

import {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	USER_RENDERER_IDS,
	assertRendererCompatibility,
	composeUserFrontReleaseInput,
	mountUserRenderer,
	userPluginManifest,
	validateUserPluginManifest,
	visibleUserNavigation,
} from "../src/index.js";
import * as userPluginExports from "../src/index.js";

const identifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000201",
	draft_snapshot_id: "01J00000000000000000000202",
	compilation_id: "01J00000000000000000000203",
	candidate_id: "01J00000000000000000000204",
	release_id: "01J00000000000000000000205",
	created_at: "2026-08-30T00:30:00.000Z",
};

const operator = { id: "operator-1", email: "operator@example.com", name: "Operator", role: 50, disabled: false };

describe("supbrd-plug-user", () => {
	test("rejects manifest drift because the common contract verifies canonical content", async () => {
		expect(await validateUserPluginManifest(userPluginManifest)).toEqual({ valid: true, errors: [] });
		const drifted = structuredClone(userPluginManifest);
		drifted.capabilities.push("identity.undeclared");
		expect(await validateUserPluginManifest(drifted)).toMatchObject({
			valid: false,
			errors: expect.arrayContaining(["ARTIFACT_CHECKSUM_MISMATCH"]),
		});
	});

	test("leaves final URLs, pages and navigation to the Front Release composer", () => {
		const forbiddenOwnershipExports = Object.keys(userPluginExports).filter((name) =>
			/^(?:routes|pages|navigation)$/u.test(name),
		);
		expect(forbiddenOwnershipExports).toEqual([]);
	});

	test("resolves anonymous login and permission-filtered operator navigation", async () => {
		const input = await composeUserFrontReleaseInput(identifiers);
		const runtime = {
			front_route_manifest: { ...input.front_route_manifest, route_manifest_checksum: "checksum" },
			dependency_policies: input.dependency_policies,
		};
		expect(resolveFrontRequest({ last_verified_release: runtime, requested_path: "/login", admin_session: "absent", permissions: [], dependency_health: { "dependency.supbrd_plug_user": "ready" } }).result).toBe("rendered");
		expect(resolveFrontRequest({ last_verified_release: runtime, requested_path: "/app/users", admin_session: "absent", application_token_audience: "vocostar.application", permissions: ["users.read"], dependency_health: { "dependency.supbrd_plug_user": "ready" } }).result).toBe("redirect");
		expect(visibleUserNavigation(input, [])).toHaveLength(0);
		expect(visibleUserNavigation(input, ["users.read"])).toHaveLength(2);
	});

	test("compiles the slice with every validation receipt passing", async () => {
		const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
		const release = await compileFrontRelease(await composeUserFrontReleaseInput(identifiers), { kid: "user-slice-test-key", private_key: keys.privateKey });
		expect(release.validation_receipts.every(({ status }) => status === "passed")).toBe(true);
	});

	test("renders real passkey, profile and member data through the typed registry", () => {
		const login = mountUserRenderer({ renderer_id: USER_RENDERER_IDS.login, props: { kind: "login", title_message_id: "user.page.sign_in" } });
		expect(login).toMatchObject({ kind: "login", action_id: "emdash.core.action.admin_session_start" });
		const profile = mountUserRenderer({ renderer_id: USER_RENDERER_IDS.profile, props: { kind: "profile", operator } });
		expect(profile).toMatchObject({ kind: "profile", operator: { email: "operator@example.com" } });
		const members = mountUserRenderer({ renderer_id: USER_RENDERER_IDS.members, props: { kind: "members", page_size: 10, members: [operator] } });
		expect(members).toMatchObject({ kind: "members", members: [{ id: "operator-1" }] });
	});

	test("isolates plugin failures and rejects an incompatible real root layout", () => {
		expect(mountUserRenderer({ renderer_id: USER_RENDERER_IDS.members, props: { kind: "members", page_size: 5, members: [] } })).toMatchObject({ state: "error", isolated: true });
		const incompatibleRoot = { ...CORE_ADMIN_SHELL_DESCRIPTOR, abi_version: "2.0.0" };
		expect(() => assertRendererCompatibility(incompatibleRoot)).toThrow(/compatibility rejected/u);
		expect(() => mountUserRenderer({ renderer_id: incompatibleRoot.renderer_id, descriptor: incompatibleRoot, props: { kind: "login", title_message_id: "user.page.sign_in" }, root_layout: true })).toThrow(/compatibility rejected/u);
	});
});
