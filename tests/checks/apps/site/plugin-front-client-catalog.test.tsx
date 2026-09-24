import { expect, test } from "vitest";

import { loadPluginClientView } from "../../../../apps/site/src/lib/plugin-client-catalog.js";
import { parityFrontPluginCatalog } from "../../../../apps/site/src/lib/plugin-front-catalog.js";

const publishedViews = parityFrontPluginCatalog.flatMap((plugin) =>
	plugin.surfaces.map((surface) => ({
		plugin_id: plugin.plugin_id,
		route_id: surface.route_id,
		path: surface.path_pattern,
	})),
);

test.each([
	["supbrd-plugmod-files", "/data/settings"],
	["supbrd-plug-products", "/monetization/settings"],
	["supbrd-plugmod-flows", "/acquisition/settings"],
])("publishes and loads the settings entry for %s", async (pluginId, path) => {
	const surface = publishedViews.find((view) => view.plugin_id === pluginId && view.path === path);
	expect(surface, `Missing settings entry: ${path}`).toBeDefined();
	if (!surface) return;
	const { Page } = await loadPluginClientView(pluginId, surface.route_id);
	expect(Page).toBeDefined();
});

test.each(publishedViews)(
	"loads the published $path view from its owning plugin",
	async ({ plugin_id, route_id }) => {
		const { Page } = await loadPluginClientView(plugin_id, route_id);
		expect(Page).toBeDefined();
	},
	15000,
);

test("rejects a route belonging to another plugin", async () => {
	await expect(
		loadPluginClientView("supbrd-plugmod-billing", "superboard.communication_statistics"),
	).rejects.toThrow("View is not registered");
});

test("keeps the historical purchases view loadable under its billing owner", async () => {
	const { Page } = await loadPluginClientView(
		"supbrd-plugmod-billing",
		"superboard.products_purchases",
	);
	expect(Page).toBeDefined();
});

test("paywall statistics resolves to the statistics screen, not the editor", async () => {
	const statistics = await loadPluginClientView(
		"supbrd-plugmod-paywalls",
		"superboard.acquisition_paywalls_statistics",
	);
	const editor = await loadPluginClientView(
		"supbrd-plugmod-paywalls",
		"superboard.acquisition_paywalls",
	);
	const original = await loadPluginClientView(
		"supbrd-plugmod-paywalls",
		"superboard.paywalls_statistics",
	);
	expect(statistics.Page).toBe(original.Page);
	expect(statistics.Page).not.toBe(editor.Page);
});
