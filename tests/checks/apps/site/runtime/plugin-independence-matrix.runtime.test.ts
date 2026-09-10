import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { resolveSiteFrontPage } from "../../../../../apps/site/src/lib/front-page.js";
import { loadLastVerifiedFrontRelease } from "../../../../../apps/site/src/lib/release-source.js";
import baseline from "../../../../../scripts/config/superboard-plugin-independence-baseline.json";

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
const businessPackages = pluginPackages
	.filter((owner) => owner.kind === "business")
	.map((owner) => ({
		...owner,
		contributions: baseline.plugins.filter((plugin) => owner.components.includes(plugin.plugin_id)),
	}));
const core = pluginPackages.find((owner) => owner.kind === "core")!;
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

test("each business package activates independently of the others and removes every component route when disabled", async () => {
	await toggle(core.id, "enable");
	for (const owner of businessPackages) {
		await toggle(owner.id, "enable");
		for (const plugin of owner.contributions) await assertContribution(plugin, true);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state='active'",
		).all<{ plugin_id: string }>();
		expect(active.results.map(({ plugin_id }) => plugin_id).toSorted()).toEqual(
			[...core.components, ...owner.components].toSorted(),
		);
		await toggle(owner.id, "disable");
		for (const plugin of owner.contributions) {
			await assertContribution(plugin, false);
			const api = plugin.api.find(
				(route) =>
					route.path_pattern.includes("/data-sources/") && route.auth_policy !== "application",
			);
			if (api) {
				const response = await SELF.fetch("https://site.example" + api.path_pattern, { headers });
				expect(response.status, plugin.plugin_id).toBe(404);
			}
		}
		const page = await resolveSiteFrontPage(env, "/superboard-system/home", user);
		expect(page.resolution.result).toBe("rendered");
	}
}, 120000);

test("all business packages coexist and removing one preserves the other packages and required core", async () => {
	await toggle(core.id, "enable");
	for (const owner of businessPackages) await toggle(owner.id, "enable");
	for (const selected of businessPackages) {
		await toggle(selected.id, "disable");
		for (const plugin of baseline.plugins)
			await assertContribution(plugin, !selected.components.includes(plugin.plugin_id));
		await toggle(selected.id, "enable");
		for (const plugin of selected.contributions) await assertContribution(plugin, true);
	}
}, 180000);
import { pluginPackages } from "@superboard/contracts/plugin-packages";
