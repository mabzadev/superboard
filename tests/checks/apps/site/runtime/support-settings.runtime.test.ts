import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const pluginId = "supbrd-plug-support";
const origin = "https://site.example";
const headers = { Origin: origin, "X-EmDash-Request": "1", "X-Parity-Operator": "1" };
const endpoints = [
	["/_emdash/api/superboard/plugins/" + pluginId + "/diagnostic", "GET"],
	["/_emdash/api/superboard/plugins/" + pluginId + "/health", "POST"],
	["/api/v1/support/projects/1-prod/settings", "GET"],
	["/api/v1/support/projects/1-prod/settings", "PATCH"],
	["/api/v1/support/projects/1-prod/settings/entities", "POST"],
	["/api/v1/support/projects/1-prod/notifications/preferences", "GET"],
	["/api/v1/support/projects/1-prod/notifications/preferences", "PUT"],
];

test.each(endpoints)("Support refuses an editor: %s %s", async (path, method) => {
	const response = await SELF.fetch(origin + path, {
		method,
		headers: { ...headers, "X-Parity-Role": "editor" },
	});
	expect(response.status).toBe(403);
});

test.each(["diagnostic", "health"])(
	"disabled Support refuses %s without removing settings",
	async (action) => {
		const key = "plugin:supbrd-plugmod-support:settings:business_name";
		await env.DB.prepare("INSERT OR REPLACE INTO options (name, value) VALUES (?, ?)")
			.bind(key, JSON.stringify("Preserved sender"))
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT ?, 'local', ?, artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-support' LIMIT 1",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, pluginId)
			.run();
		expect(
			await env.DB.prepare("SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = ?")
				.bind(pluginId)
				.first("state"),
		).toBe("disabled");
		const response = await SELF.fetch(
			origin + "/_emdash/api/superboard/plugins/" + pluginId + "/" + action,
			{ method: action === "health" ? "POST" : "GET", headers },
		);
		expect(response.status).toBe(404);
		expect(
			await env.DB.prepare("SELECT value FROM options WHERE name = ?").bind(key).first("value"),
		).toBe(JSON.stringify("Preserved sender"));
	},
);

test("disabled Support refuses settings reads and writes", async () => {
	await env.DB.prepare(
		"UPDATE superboard_plugin_lifecycle SET state = 'disabled' WHERE instance_id = ? AND target = 'local' AND plugin_id = ?",
	)
		.bind(env.SUPERBOARD_INSTANCE_ID, "supbrd-plugmod-support")
		.run();
	for (const [path, method] of endpoints.filter(([candidate]) => candidate?.startsWith("/api/"))) {
		const response = await SELF.fetch(origin + path, { method, headers });
		expect(response.status).toBe(404);
	}
});
