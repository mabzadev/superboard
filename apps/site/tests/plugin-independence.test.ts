import {
	compileFrontRelease,
	parseFrontNavigation,
	resolveFrontRequest,
} from "@superboard/supbrd-core";
import { expect, test } from "vitest";

import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

const catalog = superBoardRuntimePluginCatalog().plugins;
const selections = [
	{ label: "no business plugins", plugins: [] },
	...catalog.map((plugin) => ({ label: plugin.manifest.plugin_id, plugins: [plugin] })),
];

test.each(selections)("publishes $label without another business plugin", async ({ plugins }) => {
	const input = await composeUserFrontReleaseInput({
		instance_id: "independent-instance",
		front_draft_id: "01J00000000000000000000601",
		draft_snapshot_id: "01J00000000000000000000602",
		compilation_id: "01J00000000000000000000603",
		candidate_id: "01J00000000000000000000604",
		release_id: "01J00000000000000000000605",
		release_sequence: 1,
		previous_release_id: null,
		created_at: "2026-09-05T18:00:00.000Z",
		plugin_lock: plugins.map(({ manifest }) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		})),
	});
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
		"sign",
		"verify",
	]);
	const release = await compileFrontRelease(input, {
		kid: "isolation-test",
		private_key: keys.privateKey,
	});
	expect(release.validation_receipts.filter(({ status }) => status !== "passed")).toEqual([]);
	const runtime = {
		last_verified_release: {
			front_route_manifest: release.payload.front_route_manifest,
			dependency_policies: release.payload.dependency_policies,
		},
		admin_session: "valid" as const,
		permissions: [],
		dependency_health: {},
	};
	const home = resolveFrontRequest({ ...runtime, requested_path: "/superboard-system/home" });
	expect(home.result).toBe("rendered");
	const auth = input.front_route_manifest.auth_transitions;
	expect(
		input.front_route_manifest.routes.find(({ route_id }) => route_id === auth.login_route_id)
			?.path_pattern,
	).toBe("/_emdash/admin/login");
	const owners = new Set(["supbrd-core", ...plugins.map(({ manifest }) => manifest.plugin_id)]);
	expect(input.renderers.every(({ plugin_id }) => owners.has(plugin_id))).toBe(true);
	const pluginId = plugins[0]?.manifest.plugin_id;
	if (pluginId === "supbrd-plugmod-paywalls" || pluginId === "supbrd-plugmod-onboardings") {
		const prefix = pluginId === "supbrd-plugmod-paywalls" ? "/paywalls" : "/onboardings";
		const links = parseFrontNavigation(
			input.presentation.navigation,
			input.front_route_manifest.routes,
		).flatMap(({ items }) => items.map(({ href }) => href));
		expect(links).toEqual([prefix, `${prefix}/statistics`]);
	}
	if (!plugins.some(({ manifest }) => manifest.plugin_id === "supbrd-plug-user")) {
		expect(resolveFrontRequest({ ...runtime, requested_path: "/app/users" }).result).toBe(
			"not_found",
		);
	}
});
