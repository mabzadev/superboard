import { pluginPackageComponents } from "@superboard/contracts/plugin-packages";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("disables the last business plugin and activates another without User", async () => {
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
	};
	expect(
		(
			await SELF.fetch("https://site.example/_emdash/api/superboard/plugins/supbrd-core/enable", {
				method: "POST",
				headers,
			})
		).ok,
	).toBe(true);
	for (const [plugin, action] of [
		["supbrd-plug-identity", "enable"],
		["supbrd-plug-identity", "disable"],
		["supbrd-plug-data", "enable"],
	]) {
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${plugin}/${action}`,
			{ method: "POST", headers },
		);
		expect(response.status, await response.clone().text()).toBe(201);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = 'local' AND state = 'active' ORDER BY plugin_id",
		)
			.bind("reference-production")
			.all<{ plugin_id: string }>();
		expect(active.results.map(({ plugin_id }) => plugin_id)).toEqual(
			[
				...pluginPackageComponents("supbrd-core"),
				...(action === "enable" ? pluginPackageComponents(plugin!) : []),
			].toSorted(),
		);
	}
});
