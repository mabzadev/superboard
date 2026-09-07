import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import baseline from "../../../config/superboard-plugin-independence-baseline.json";
import { resolveSiteFrontPage } from "../src/lib/front-page.js";
import { loadLastVerifiedFrontRelease } from "../src/lib/release-source.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
const user = {
	id: "operator-1",
	email: "operator@example.com",
	name: "Operator",
	role: 50 as const,
	disabled: false,
};
async function toggle(pluginId: string, action: string) {
	const result = await SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${action}`,
		{ method: "POST", headers },
	);
	expect(result.ok, `${pluginId} ${action}: ${await result.clone().text()}`).toBe(true);
}
async function assertContribution(plugin: (typeof baseline.plugins)[number], present: boolean) {
	const release = await loadLastVerifiedFrontRelease(env, env.SUPERBOARD_INSTANCE_ID);
	expect(release).not.toBeNull();
	const routes = release!.runtime_release.front_route_manifest.routes;
	for (const route of plugin.routes) {
		// The historical login transition now belongs to the always-available operator core.
		if (route.path === "/login") continue;
		expect(
			routes.some((candidate) => candidate.route_id === route.route_id),
			`${plugin.plugin_id}: ${route.path}`,
		).toBe(present);
	}
}

test("every catalog plugin activates alone, removes its routes and rejects direct API calls when disabled", async () => {
	for (const plugin of baseline.plugins) {
		await toggle(plugin.plugin_id, "enable");
		await assertContribution(plugin, true);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state='active'",
		).all();
		expect(active.results).toEqual([{ plugin_id: plugin.plugin_id }]);
		await toggle(plugin.plugin_id, "disable");
		await assertContribution(plugin, false);
		const api = plugin.api.find(
			(route) =>
				route.path_pattern.includes("/data-sources/") && route.auth_policy !== "application",
		);
		if (api) {
			const response = await SELF.fetch("https://site.example" + api.path_pattern, { headers });
			expect(response.status, plugin.plugin_id).toBe(404);
		}
		const core = await resolveSiteFrontPage(env, "/superboard-system/home", user);
		expect(core.resolution.result).toBe("rendered");
	}
}, 120000);

test("all plugins coexist and removing each one preserves the other catalog routes", async () => {
	for (const plugin of baseline.plugins) await toggle(plugin.plugin_id, "enable");
	for (const selected of baseline.plugins) {
		await toggle(selected.plugin_id, "disable");
		for (const plugin of baseline.plugins)
			await assertContribution(plugin, plugin.plugin_id !== selected.plugin_id);
		await toggle(selected.plugin_id, "enable");
		await assertContribution(selected, true);
	}
}, 180000);
