import { resolveFrontRoute } from "@superboard/supbrd-core";
import { expect, test } from "vitest";

import navigation from "../../../config/superboard-dashboard-navigation.json";
import seed from "../seed/seed.json";
import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";
import { composeUserFrontReleaseInput } from "../src/lib/user-front-release.js";

test("the EmDash seed exposes every Dashboard screen as a plugin-owned View", () => {
	expect(Object.keys(seed.content)).toEqual(["views"]);
	expect(seed.collections.map(({ slug }) => slug)).toEqual(["views"]);
	const expectedPaths = navigation.sections.flatMap((section) =>
		section.pages.map(({ href }) => href),
	);
	const views = new Map(seed.content.views.map((view) => [view.data.path, view]));

	expect(expectedPaths).toHaveLength(71);
	expect(views.size).toBe(expectedPaths.length);
	for (const path of expectedPaths) {
		const view = views.get(path);
		expect(view, path).toBeDefined();
		expect(view!.data.plugin_id).toMatch(/^supbrd-(?:plug|plugmod)-/u);
		expect(view!.data.route_id).toMatch(/^superboard\./u);
		expect(view!.data.renderer_id, path).toBe(`${view!.data.plugin_id}.renderer.admin_surface`);
		expect(view!.data.presentation.schema_version).toBe("1.0.0");
		expect(view!.data.presentation.blocks).toBeInstanceOf(Array);
		expect(view!.data.bindings.data_sources.length, path).toBeGreaterThan(0);
		expect(view!.data.bindings.commands.length, path).toBeGreaterThan(0);
	}
	expect(JSON.stringify(seed)).not.toContain("No data available for this surface yet.");
});

test("Remote Config selects its real Dashboard renderer and plugin capabilities", () => {
	const remoteConfig = seed.content.views.find(
		({ data }) => data.path === "/analytics/remote-config",
	);

	expect(remoteConfig?.data.description).toBe(
		"Publish versioned JSON values with deterministic rollouts for the selected environment.",
	);
	expect(remoteConfig?.data.renderer_id).toBe("supbrd-plugmod-analytics.renderer.admin_surface");
	expect(remoteConfig?.data.presentation.blocks).toEqual([]);
	expect(remoteConfig?.data.bindings.data_sources).toContain(
		"supbrd-plugmod-analytics.data_source.analytics_remote_config",
	);
	expect(remoteConfig?.data.bindings.commands).toContain(
		"supbrd-plugmod-analytics.command.upsert_analytics_remote_config",
	);
});

test("every View resolves to the matching plugin route", async () => {
	const catalog = superBoardRuntimePluginCatalog();
	const input = await composeUserFrontReleaseInput({
		instance_id: "local",
		front_draft_id: "01J00000000000000000000501",
		draft_snapshot_id: "01J00000000000000000000502",
		compilation_id: "01J00000000000000000000503",
		candidate_id: "01J00000000000000000000504",
		release_id: "01J00000000000000000000505",
		release_sequence: 1,
		previous_release_id: null,
		plugin_lock: catalog.plugins.map(({ manifest }) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: manifest.execution.backend === "native",
		})),
		created_at: "2026-09-01T12:00:00.000Z",
	});
	const rendererPlugin = new Map(
		input.renderers.map((renderer) => [renderer.renderer_id, renderer.plugin_id]),
	);

	for (const view of seed.content.views) {
		const resolution = resolveFrontRoute(input.front_route_manifest, view.data.path);
		expect(resolution.result, view.data.path).toBe("matched");
		if (resolution.result !== "matched") continue;
		expect(resolution.route_id, view.data.path).toBe(view.data.route_id);
		expect(
			resolution.route.renderer_ids.some(
				(rendererId) => rendererPlugin.get(rendererId) === view.data.plugin_id,
			),
			view.data.path,
		).toBe(true);
	}
});
