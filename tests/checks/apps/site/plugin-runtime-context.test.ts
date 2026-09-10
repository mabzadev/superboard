import { describe, expect, it } from "vitest";

import { createConfiguredSuperBoardPlugin } from "../../../../apps/site/src/lib/configured-plugin.js";
import { PluginContextFactory } from "../../../../packages/core/src/plugins/context.js";
import { definePlugin } from "../../../../packages/core/src/plugins/define-plugin.js";
import { setupTestDatabase, teardownTestDatabase } from "../../packages/core/utils/test-db.js";

describe("standard SuperBoard plugin runtime", () => {
	it("reads its persisted settings from the plugin context, separately from route input", async () => {
		const db = await setupTestDatabase();
		try {
			const factory = new PluginContextFactory({ db });
			const context = factory.createContext(
				definePlugin({ id: "supbrd-plugmod-paywalls", version: "1.0.0" }),
			);
			await context.kv.set("settings:default_locale", "fr");
			const plugin = createConfiguredSuperBoardPlugin("supbrd-plugmod-paywalls");
			const route = {
				input: { default_locale: "untrusted" },
				request: { method: "GET", url: "http://localhost/health", headers: {} },
			};
			const health = await plugin.routes.health.handler(route, context);
			expect(health).toMatchObject({
				status: "ready",
				settings: { values: { default_locale: "fr" } },
			});
			expect(await plugin.routes["settings/effective"].handler(route, context)).toMatchObject({
				values: { default_locale: "fr" },
			});
		} finally {
			await teardownTestDatabase(db);
		}
	});
	it("keeps secret settings private in both native and sandboxed execution", async () => {
		const db = await setupTestDatabase();
		try {
			const context = new PluginContextFactory({ db }).createContext(
				definePlugin({ id: "supbrd-plugmod-email", version: "1.0.0" }),
			);
			await context.kv.set("settings:password", "test-only-private-password");
			const plugin = createConfiguredSuperBoardPlugin("supbrd-plugmod-email");
			const native = await plugin.routes.health.handler(context);
			const sandboxed = await plugin.routes.health.handler({ input: {} }, context);
			expect(native.settings).toEqual(sandboxed.settings);
			expect(sandboxed.settings.secrets_set.password).toBe(true);
			expect(JSON.stringify(sandboxed)).not.toContain("test-only-private-password");
		} finally {
			await teardownTestDatabase(db);
		}
	});
});
