import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("disables the last business plugin and activates another without User", async () => {
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
	};
	for (const [plugin, action] of [
		["supbrd-plug-user", "enable"],
		["supbrd-plug-user", "disable"],
		["supbrd-plug-settings", "enable"],
	]) {
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${plugin}/${action}`,
			{ method: "POST", headers },
		);
		expect(response.status, await response.clone().text()).toBe(201);
		const active = await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE instance_id = ? AND target = 'local' AND state = 'active' ORDER BY plugin_id",
		)
			.bind("vocostar")
			.all<{ plugin_id: string }>();
		expect(active.results.map(({ plugin_id }) => plugin_id)).toEqual(
			action === "enable" ? [plugin] : [],
		);
	}
});
