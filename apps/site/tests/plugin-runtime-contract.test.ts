import { expect, test, vi } from "vitest";

import { createConfiguredSuperBoardPlugin } from "../../../packages/supbrd-runtime-plugins/src/runtime.js";
import { superBoardRuntimePluginCatalog } from "../src/lib/superboard-plugin-catalog.js";

test("every SuperBoard plugin has an executable sandbox contract, settings and Block Kit Admin page", async () => {
	for (const { manifest } of superBoardRuntimePluginCatalog().plugins) {
		const plugin = createConfiguredSuperBoardPlugin(manifest.plugin_id);
		expect(plugin.id).toBe(manifest.plugin_id);
		expect(Object.keys(plugin.admin.settingsSchema ?? {}).toSorted()).toEqual(
			Object.keys(manifest.settings.schema.properties).toSorted(),
		);
		expect(plugin.admin.pages).toEqual([expect.objectContaining({ path: "/" })]);
		expect(Object.keys(plugin.routes)).toEqual(
			expect.arrayContaining([
				"admin",
				"contract",
				"health",
				"settings/effective",
				"commands/catalog",
				"commands/execute",
				"data-sources/catalog",
			]),
		);
		const admin = await plugin.routes.admin!.handler({} as never);
		expect(admin).toMatchObject({ blocks: expect.any(Array) });
		const health = await plugin.routes.health!.handler({
			kv: { get: vi.fn(async () => null) },
		} as never);
		expect(health).toMatchObject({
			plugin_id: manifest.plugin_id,
			status: "ready",
			commands: manifest.commands.length,
			data_sources: manifest.data_sources.length,
		});
	}
});
