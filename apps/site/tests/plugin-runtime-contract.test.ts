import { verifySuperBoardPluginManifest } from "@superboard/supbrd-core";
import { expect, test, vi } from "vitest";

import packageCatalog from "../../../config/superboard-plugin-catalog.json";
import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";

test("each package exposes a verifiable contract including its legacy contributions", async () => {
	for (const { manifest } of packageCatalog.plugins) {
		const result = await verifySuperBoardPluginManifest(manifest);
		expect(result.errors, manifest.plugin_id).toEqual([]);
		const plugin = createConfiguredSuperBoardPlugin(manifest.plugin_id);
		expect(await plugin.routes.contract.handler()).toEqual(manifest);
	}
});

test("every SuperBoard plugin exposes its validated sandbox contract without inventing command handlers", async () => {
	for (const { manifest } of superBoardRuntimePluginCatalog().plugins) {
		const plugin = createConfiguredSuperBoardPlugin(manifest.plugin_id);
		expect(plugin.id).toBe(manifest.plugin_id);
		expect(Object.keys(plugin.admin.settingsSchema ?? {}).toSorted()).toEqual(
			Object.keys(manifest.settings.schema.properties).toSorted(),
		);
		expect(plugin.admin.pages).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "/" })]),
		);
		if (manifest.plugin_id === "supbrd-plug-settings")
			expect(plugin.admin.pages.some((page) => page.path === "/configuration")).toBe(true);
		expect(Object.keys(plugin.routes)).toEqual(
			expect.arrayContaining([
				"admin",
				"contract",
				"health",
				"settings/effective",
				"commands/catalog",
				"data-sources/catalog",
			]),
		);
		expect(Object.keys(plugin.routes)).not.toContain("commands/execute");
		const admin = await plugin.routes.admin!.handler({} as never);
		expect(admin).toMatchObject({ blocks: expect.any(Array) });
		const health = await plugin.routes.health!.handler({
			kv: { list: vi.fn(async () => []) },
		} as never);
		expect(health).toMatchObject({
			plugin_id: manifest.plugin_id,
			status: "ready",
			commands: manifest.commands.length,
			data_sources: manifest.data_sources.length,
		});
	}
});

test.each([
	{
		name: "the French admin cookie takes priority over the browser language",
		headers: { Cookie: "session=opaque; emdash-locale=fr", "Accept-Language": "en-US,en;q=0.9" },
		labels: ["Paramètres", "Stockages", "Commandes", "Sources de données", "Moteurs de rendu"],
	},
	{
		name: "the Arabic admin cookie selects Arabic labels",
		headers: { Cookie: "emdash-locale=ar", "Accept-Language": "fr" },
		labels: ["الإعدادات", "مخازن البيانات", "الأوامر", "مصادر البيانات", "مكوّنات العرض"],
	},
	{
		name: "a French browser locale works before choosing an admin language",
		headers: { "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.8" },
		labels: ["Paramètres", "Stockages", "Commandes", "Sources de données", "Moteurs de rendu"],
	},
	{
		name: "an unsupported cookie falls back to the native request locale",
		headers: { Cookie: "emdash-locale=unknown", "Accept-Language": "ar" },
		labels: ["الإعدادات", "مخازن البيانات", "الأوامر", "مصادر البيانات", "مكوّنات العرض"],
	},
	{
		name: "native locales without a plugin translation retain the English fallback",
		headers: { Cookie: "emdash-locale=de", "Accept-Language": "fr" },
		labels: ["Settings", "Stores", "Commands", "Data sources", "Renderers"],
	},
])("localizes the plugin summary when $name", async ({ headers, labels }) => {
	const plugin = createConfiguredSuperBoardPlugin("supbrd-plugmod-analytics");
	const summary = await plugin.routes.admin.handler({
		request: new Request("https://site.test/_emdash/api/plugins/supbrd-plugmod-analytics/admin", {
			headers,
		}),
	} as never);
	const fields = summary.blocks.find((block) => block.type === "fields");
	expect(fields?.fields?.map(({ label }) => label)).toEqual(labels);
	const sections = summary.blocks.filter((block) => block.type === "section");
	expect(sections.map(({ text }) => text?.split("\n")[0])).toEqual(
		labels.slice(0, 4).map((label) => `**${label}**`),
	);
	expect(JSON.stringify(summary)).toContain("supbrd-plugmod-analytics");
});
