import { describe, expect, test } from "vitest";
import { compileFrontRelease, resolveFrontRequest } from "@superboard/supbrd-core";

import {
	composeUserFrontReleaseInput,
	mountUserRenderer,
	userPluginManifest,
	validateUserPluginManifest,
	visibleUserNavigation,
} from "../src/index.js";

describe("supbrd-plug-user", () => {
	test("publishes a closed namespaced manifest with the three canonical aliases", () => {
		expect(validateUserPluginManifest(userPluginManifest)).toEqual({ valid: true, errors: [] });
		expect(userPluginManifest.aliases).toEqual({
			"user.login-form": "supbrd-plug-user.renderer.login_form",
			"user.profile-card": "supbrd-plug-user.renderer.profile_card",
			"user.members-table": "supbrd-plug-user.renderer.members_table",
		});
		expect(
			validateUserPluginManifest({ ...userPluginManifest, routes: ["/forbidden"] }),
		).toMatchObject({ valid: false });
	});

	test("composes login, shell, profile and users without plugin-owned routes", () => {
		const input = composeUserFrontReleaseInput({
			instance_id: "vocostar",
			front_draft_id: "01J00000000000000000000201",
			draft_snapshot_id: "01J00000000000000000000202",
			compilation_id: "01J00000000000000000000203",
			candidate_id: "01J00000000000000000000204",
			release_id: "01J00000000000000000000205",
			created_at: "2026-08-30T00:30:00.000Z",
		});
		expect(input.front_route_manifest.routes.map(({ path_pattern }) => path_pattern)).toEqual([
			"/login",
			"/app",
			"/app/profile",
			"/app/users",
		]);
		expect(Object.hasOwn(userPluginManifest, "routes")).toBe(false);
		expect(Object.hasOwn(userPluginManifest, "pages")).toBe(false);
		expect(Object.hasOwn(userPluginManifest, "navigation")).toBe(false);
		expect(visibleUserNavigation(input, [])).toEqual([]);
		expect(visibleUserNavigation(input, ["users.read"]).map(({ route_id }) => route_id)).toEqual([
			"superboard.profile",
			"superboard.users",
		]);
	});

	test("compiles the composed slice with all validation layers passing", async () => {
		const keys = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const input = composeUserFrontReleaseInput({
			instance_id: "vocostar",
			front_draft_id: "01J00000000000000000000231",
			draft_snapshot_id: "01J00000000000000000000232",
			compilation_id: "01J00000000000000000000233",
			candidate_id: "01J00000000000000000000234",
			release_id: "01J00000000000000000000235",
			created_at: "2026-08-30T00:30:00.000Z",
		});
		const release = await compileFrontRelease(input, {
			kid: "user-slice-test-key",
			private_key: keys.privateKey,
		});
		expect(release.validation_receipts.every(({ status }) => status === "passed")).toBe(true);
	});

	test("requires the EmDash operator session and ignores application JWT audience", () => {
		const input = composeUserFrontReleaseInput({
			instance_id: "vocostar",
			front_draft_id: "01J00000000000000000000211",
			draft_snapshot_id: "01J00000000000000000000212",
			compilation_id: "01J00000000000000000000213",
			candidate_id: "01J00000000000000000000214",
			release_id: "01J00000000000000000000215",
			created_at: "2026-08-30T00:30:00.000Z",
		});
		const runtime = {
			front_route_manifest: { ...input.front_route_manifest, route_manifest_checksum: "checksum" },
			dependency_policies: input.dependency_policies,
		};
		expect(
			resolveFrontRequest({
				last_verified_release: runtime,
				requested_path: "/app/users",
				admin_session: "absent",
				application_token_audience: "vocostar.application",
				permissions: ["users.read"],
				dependency_health: { "dependency.supbrd_plug_user": "ready" },
			}).result,
		).toBe("redirect");
		expect(
			resolveFrontRequest({
				last_verified_release: runtime,
				requested_path: "/app/users",
				admin_session: "valid",
				permissions: [],
				dependency_health: { "dependency.supbrd_plug_user": "ready" },
			}).result,
		).toBe("forbidden");
	});

	test("isolates renderer crashes but fails a root layout closed", () => {
		expect(() =>
			mountUserRenderer({
				renderer_id: "supbrd-plug-user.renderer.members_table",
				props: { page_size: 5 },
				render: () => ({
					state: "rendered",
					renderer_id: "supbrd-plug-user.renderer.members_table",
					title: "Users",
					description: "Users",
					isolated: false,
					fields: [],
				}),
				root_layout: false,
			}),
		).toThrow(/between 10 and 100/u);
		expect(
			mountUserRenderer({
				renderer_id: "supbrd-plug-user.renderer.profile_card",
				props: { show_devices: true },
				render: () => {
					throw new Error("renderer crash");
				},
				root_layout: false,
			}),
		).toMatchObject({ state: "error", isolated: true });
		expect(() =>
			mountUserRenderer({
				renderer_id: "supbrd-plug-user.renderer.profile_card",
				props: { show_devices: true },
				render: () => {
					throw new Error("root crash");
				},
				root_layout: true,
			}),
		).toThrow(/root crash/u);
	});
});
