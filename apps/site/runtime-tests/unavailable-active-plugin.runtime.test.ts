import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("receipt renewal does not clear an unavailable active plugin", async () => {
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
	};
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{ method: "POST", headers },
	);
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	await env.DB.prepare(
		`UPDATE superboard_plugin_runtime_health
		 SET status = 'unavailable', expires_at = '2000-01-01T00:00:00.000Z'
		 WHERE instance_id = ? AND target = 'local' AND plugin_id = ?`,
	)
		.bind("reference-production", "supbrd-plug-user")
		.run();

	const identityDb = (env as unknown as { HEALTH_IDENTITY_DB: D1Database }).HEALTH_IDENTITY_DB;
	await identityDb
		.prepare("DELETE FROM d1_migrations WHERE name='0150_application_user_administration.sql'")
		.run();

	const rejected = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings/enable",
		{ method: "POST", headers },
	);
	expect(rejected.status).toBe(500);
	expect(await rejected.json()).toMatchObject({ error: { code: "PLUGIN_CATALOG_SYNC_FAILED" } });
	const health = await env.DB.prepare(
		`SELECT status FROM superboard_plugin_runtime_health
		 WHERE instance_id = ? AND target = 'local' AND plugin_id = ?`,
	)
		.bind("reference-production", "supbrd-plug-user")
		.first();
	expect(health).toMatchObject({ status: "unavailable" });
});
