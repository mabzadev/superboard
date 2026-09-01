import {
	assertRendererCompatibility,
	compileFrontRelease,
	resolveFrontRequest,
} from "@superboard/supbrd-core";
import { userPluginManifest } from "@superboard/supbrd-plug-user";
import { expect, test } from "vitest";

import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import {
	CORE_ADMIN_SHELL_DESCRIPTOR,
	composeUserFrontReleaseInput,
	visibleUserNavigation,
} from "../src/lib/user-front-release.js";

const identifiers = {
	instance_id: "vocostar",
	front_draft_id: "01J00000000000000000000201",
	draft_snapshot_id: "01J00000000000000000000202",
	compilation_id: "01J00000000000000000000203",
	candidate_id: "01J00000000000000000000204",
	release_id: "01J00000000000000000000205",
	release_sequence: 1,
	previous_release_id: null,
	plugin_lock: [
		{
			plugin_id: userPluginManifest.plugin_id,
			version: userPluginManifest.plugin_version,
			artifact_checksum: userPluginManifest.artifact_checksum,
			native: false,
		},
	],
	created_at: "2026-08-30T00:30:00.000Z",
};

test("locks Core plus every concrete runtime plugin with explicit dependency policies", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const input = await composeUserFrontReleaseInput({
		...identifiers,
		plugin_lock: catalog.plugins.map(({ manifest }) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		})),
	});
	expect(input.plugin_lock).toHaveLength(19);
	expect(new Set(input.plugin_lock.map(({ plugin_id }) => plugin_id)).size).toBe(19);
	expect(input.dependency_policies).toHaveLength(18);
	expect(input.dependency_policies.every(({ kind }) => kind === "required")).toBe(true);
	expect(input.plugin_lock.some(({ plugin_id }) => plugin_id.includes("*"))).toBe(false);
});

test("composes the next release against the exact active predecessor", async () => {
	const input = await composeUserFrontReleaseInput({
		...identifiers,
		candidate_id: "01J00000000000000000000206",
		release_id: "01J00000000000000000000207",
		release_sequence: 2,
		previous_release_id: identifiers.release_id,
	});
	expect(input.release_sequence).toBe(2);
	expect(input.previous_release_id).toBe(identifiers.release_id);
});

test("adds and removes plugin presentation only through the Release plugin lock", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const user = catalog.plugins.find(({ manifest }) => manifest.plugin_id === "supbrd-plug-user");
	const marketing = catalog.plugins.find(
		({ manifest }) => manifest.plugin_id === "supbrd-plugmod-marketing",
	);
	if (!user || !marketing) throw new Error("Expected native Front plugins are missing");
	const lockEntry = ({ manifest }: (typeof catalog.plugins)[number]) => ({
		plugin_id: manifest.plugin_id,
		version: manifest.plugin_version,
		artifact_checksum: manifest.artifact_checksum,
		native: manifest.execution.backend === "native",
	});

	const withoutMarketing = await composeUserFrontReleaseInput({
		...identifiers,
		plugin_lock: [lockEntry(user)],
	});
	const withMarketing = await composeUserFrontReleaseInput({
		...identifiers,
		plugin_lock: [lockEntry(user), lockEntry(marketing)],
	});
	const routeIds = (input: Awaited<ReturnType<typeof composeUserFrontReleaseInput>>) =>
		new Set(input.front_route_manifest.routes.map(({ route_id }) => route_id));
	const navigationRouteIds = (input: Awaited<ReturnType<typeof composeUserFrontReleaseInput>>) =>
		new Set(
			visibleUserNavigation(input, ["supbrd-plugmod-marketing.read"]).map(
				({ route_id }) => route_id,
			),
		);

	expect(routeIds(withoutMarketing)).not.toContain("superboard.marketing_campaigns");
	expect(navigationRouteIds(withoutMarketing)).not.toContain("superboard.marketing_campaigns");
	expect(routeIds(withMarketing)).toContain("superboard.marketing_campaigns");
	expect(navigationRouteIds(withMarketing)).toContain("superboard.marketing_campaigns");
	expect(
		withMarketing.presentation.pages.some(
			({ page_id }) => page_id === "page.superboard_marketing_campaigns",
		),
	).toBe(true);
});

test("the Site composes a permission-filtered user slice from plugin contributions", async () => {
	const input = await composeUserFrontReleaseInput(identifiers);
	const runtime = {
		front_route_manifest: { ...input.front_route_manifest, route_manifest_checksum: "checksum" },
		dependency_policies: input.dependency_policies,
	};
	expect(
		resolveFrontRequest({
			last_verified_release: runtime,
			requested_path: "/login",
			admin_session: "absent",
			permissions: [],
			dependency_health: { "dependency.supbrd_plug_user": "ready" },
		}).result,
	).toBe("rendered");
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
	expect(visibleUserNavigation(input, [])).toHaveLength(0);
	const userNavigation = visibleUserNavigation(input, ["users.read"]);
	expect(userNavigation).not.toContainEqual(
		expect.objectContaining({ route_id: "superboard.profile" }),
	);
	expect(userNavigation).toEqual(
		expect.arrayContaining([
			{ route_id: "superboard.app_customers", label: "Customers" },
			{ route_id: "superboard.users", label: "Users" },
			{ route_id: "superboard.identity_by_lang_dashboard", label: "Overview" },
		]),
	);
});

test("compiles the complete Site composition with every validation receipt passing", async () => {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const release = await compileFrontRelease(await composeUserFrontReleaseInput(identifiers), {
		kid: "user-slice-test-key",
		private_key: keys.privateKey,
	});
	expect(release.validation_receipts.every(({ status }) => status === "passed")).toBe(true);
});

test("rejects an ABI-incompatible EmDash admin root descriptor", () => {
	expect(() =>
		assertRendererCompatibility(
			{ ...CORE_ADMIN_SHELL_DESCRIPTOR, abi_version: "2.0.0" },
			{ abi_version: "1.0.0", runtime_version: "0.1.0" },
		),
	).toThrow(/compatibility rejected/u);
});
