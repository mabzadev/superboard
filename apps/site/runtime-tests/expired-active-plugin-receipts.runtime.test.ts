import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("managed lifecycle actions revalidate expired active plugin receipts", async () => {
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
	};
	const enableUser = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{ method: "POST", headers },
	);
	expect(enableUser.status, await enableUser.clone().text()).toBe(201);

	for (const action of ["enable", "disable"]) {
		await env.DB.prepare(
			`UPDATE superboard_plugin_runtime_health SET expires_at = '2000-01-01T00:00:00.000Z'
			 WHERE instance_id = ? AND target = 'local'`,
		)
			.bind("vocostar")
			.run();
		await env.DB.prepare(
			`UPDATE superboard_dependency_health SET expires_at = '2000-01-01T00:00:00.000Z'
			 WHERE instance_id = ?`,
		)
			.bind("vocostar")
			.run();
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings/${action}`,
			{ method: "POST", headers },
		);
		expect(response.status, await response.clone().text()).toBe(201);
		expect(await response.json()).toMatchObject({
			plugin_id: "supbrd-plug-settings",
			status: action === "enable" ? "active" : "disabled",
		});
	}
});
