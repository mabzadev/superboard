import { describe, expect, test } from "vitest";

import {
	CORE_FRONT_RENDERER_DESCRIPTORS,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
} from "../../../../apps/site/src/lib/core-front-contract.js";
import { validateReleaseRouteViews } from "../../../../apps/site/src/lib/release-route-view-validation.js";
import { superBoardRuntimePluginCatalog } from "../../../../apps/site/src/lib/superboard-plugin-catalog.js";

describe("Front Release Route View Validation", () => {
	const manifests = superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => manifest);
	const validRenderers = [
		...CORE_FRONT_RENDERER_DESCRIPTORS,
		...manifests.flatMap(({ renderers }) => renderers),
	];
	const pluginLock = [
		{
			plugin_id: "supbrd-core",
			version: "0.1.0",
			artifact_checksum: SUPBRD_CORE_ARTIFACT_CHECKSUM,
			native: true,
		},
		...manifests.map((manifest) => ({
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: false,
		})),
	];

	test("passes when all routes have loadable views in their owning plugins", async () => {
		const routes = [
			{
				route_id: "superboard.analytics",
				path_pattern: "/analytics",
				renderer_ids: ["supbrd-plugmod-analytics.renderer.admin_surface"],
			},
			{
				route_id: "superboard.communication_statistics",
				path_pattern: "/communication/statistics",
				renderer_ids: ["supbrd-plugmod-marketing.renderer.admin_surface"],
			},
			{
				route_id: "emdash.core.operator_login",
				path_pattern: "/_emdash/admin/login",
				renderer_ids: ["emdash.core.renderer.operator_login"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers, pluginLock);
		expect(failures).toEqual([]);
	});

	test("fails with diagnostic identifying plugin and route when component is missing or unmapped", async () => {
		const routes = [
			{
				route_id: "superboard.missing_view_route",
				path_pattern: "/missing-view",
				renderer_ids: ["supbrd-plugmod-analytics.renderer.admin_surface"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers, pluginLock);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.missing_view_route",
			path_pattern: "/missing-view",
			plugin_id: "supbrd-plugmod-analytics",
		});
		expect(failures[0]?.error).toContain("View is not registered by supbrd-plugmod-analytics");
	});

	test("fails with diagnostic identifying plugin and route when route is attached to the wrong plugin", async () => {
		const routes = [
			{
				route_id: "superboard.communication_statistics",
				path_pattern: "/communication/statistics",
				renderer_ids: ["supbrd-plugmod-billing.renderer.admin_surface"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers, pluginLock);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.communication_statistics",
			path_pattern: "/communication/statistics",
			plugin_id: "supbrd-plugmod-billing",
		});
		expect(failures[0]?.error).toContain("View is not registered by supbrd-plugmod-billing");
	});

	test("fails when renderer descriptor is missing", async () => {
		const routes = [
			{
				route_id: "superboard.orphan_route",
				path_pattern: "/orphan",
				renderer_ids: ["unknown.renderer"],
			},
		];

		const failures = await validateReleaseRouteViews(routes, validRenderers, pluginLock);
		expect(failures).toHaveLength(1);
		expect(failures[0]).toMatchObject({
			route_id: "superboard.orphan_route",
			path_pattern: "/orphan",
			plugin_id: "unknown",
		});
	});
});
