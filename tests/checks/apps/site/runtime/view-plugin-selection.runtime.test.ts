import { parseCompiledFrontReleaseJson } from "@superboard/supbrd-core";
import type { APIContext } from "astro";
import { applySeed } from "emdash";
import { expect, test } from "vitest";

import { withViewConnections } from "../../../../../apps/site/src/lib/view-connections.js";
import { saveViewPluginSelection } from "../../../../../apps/site/src/lib/view-plugin-selection.js";
import releaseJson from "../../../../../scripts/config/superboard-parity-release.json";
import { createCmsApi } from "./retirement-api-cms.js";

test("selecting a plugin preserves View ownership in storage and rejects incompatible routes", async () => {
	const cms = await createCmsApi();
	try {
		const release = parseCompiledFrontReleaseJson(JSON.stringify(releaseJson.release)).payload;
		const route = release.front_route_manifest.routes.find((entry) =>
			entry.renderer_ids.includes("supbrd-plugmod-flows.renderer.admin_surface"),
		)!;
		await applySeed(
			cms.runtime.db,
			{
				version: "1",
				defaultLocale: "en",
				collections: [
					{
						slug: "views",
						label: "Views",
						supports: [],
						fields: [
							{ slug: "name", label: "Name", type: "string" },
							{ slug: "plugin_id", label: "Plugin", type: "string" },
							{ slug: "route_id", label: "Route", type: "string" },
							{ slug: "path", label: "Path", type: "string" },
						],
					},
				],
				content: {
					views: [
						{
							id: "plugin-choice-test",
							slug: "plugin-choice-test",
							status: "published",
							data: {
								name: "Before",
								plugin_id: "supbrd-plugmod-flows",
								route_id: route.route_id,
								path: route.path_pattern,
							},
						},
					],
				},
			},
			{ includeContent: true },
		);
		const save = (pluginId: string, name: string) => {
			const url = new URL(
				"https://site.example/_emdash/api/content/views/plugin-choice-test?locale=en",
			);
			const request = new Request(url, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ data: { plugin_id: pluginId, name } }),
			});
			const context = {
				request,
				url,
				params: { collection: "views", id: "plugin-choice-test" },
				locals: { emdash: cms.runtime, user: { id: "operator-1", role: 50 } },
			} as unknown as APIContext;
			return saveViewPluginSelection(context, release);
		};
		const response = await save("superboard-acquisition", "After");
		expect(response?.status).toBe(200);
		const body = await (await withViewConnections(response!, release)).json();
		expect(body.data.item.data).toMatchObject({
			name: "After",
			plugin_id: "superboard-acquisition",
		});
		const stored = await cms.runtime.db
			.selectFrom(cms.runtime.db.dynamic.ref("ec_views"))
			.select(["plugin_id", "name"])
			.where("slug", "=", "plugin-choice-test")
			.where("locale", "=", "en")
			.executeTakeFirstOrThrow();
		expect(stored).toEqual({ plugin_id: "supbrd-plugmod-flows", name: "After" });
		expect((await save("superboard-support", "Wrong plugin"))?.status).toBe(422);
		const unchanged = await cms.runtime.db
			.selectFrom(cms.runtime.db.dynamic.ref("ec_views"))
			.select("name")
			.where("slug", "=", "plugin-choice-test")
			.where("locale", "=", "en")
			.executeTakeFirstOrThrow();
		expect(unchanged.name).toBe("After");
	} finally {
		await cms.close();
	}
});
