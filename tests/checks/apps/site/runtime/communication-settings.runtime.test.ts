import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const pluginId = "supbrd-plug-communication";
const origin = "https://site.example";
const headers = { Origin: origin, "X-EmDash-Request": "1", "X-Parity-Operator": "1" };
const endpoints = [
	["/_emdash/api/superboard/plugins/" + pluginId + "/diagnostic", "GET"],
	["/_emdash/api/superboard/plugins/" + pluginId + "/health", "POST"],
	...["marketing", "email"].flatMap((service) => [
		["/api/v1/" + service + "/projects/1-prod/settings/smtp", "GET"],
		["/api/v1/" + service + "/projects/1-prod/settings/smtp", "PUT"],
		["/api/v1/" + service + "/projects/1-prod/settings/provider-webhooks", "GET"],
		["/api/v1/" + service + "/projects/1-prod/settings/provider-webhooks", "POST"],
	]),
	["/api/v1/marketing/projects/1-prod/studio/settings", "GET"],
	["/api/v1/marketing/projects/1-prod/studio/settings", "PUT"],
	["/api/v1/marketing/projects/1-prod/channel-connectors", "GET"],
	["/api/v1/marketing/projects/1-prod/channel-connectors", "POST"],
];

test.each(endpoints)("Communication refuses an editor: %s %s", async (path, method) => {
	const response = await SELF.fetch(origin + path, {
		method,
		headers: { ...headers, "X-Parity-Role": "editor" },
	});
	expect(response.status).toBe(403);
});

test.each(["diagnostic", "health"])(
	"disabled Communication refuses %s without removing settings",
	async (action) => {
		const key = "plugin:supbrd-plugmod-marketing:settings:sender_name";
		await env.DB.prepare("INSERT OR REPLACE INTO options (name, value) VALUES (?, ?)")
			.bind(key, JSON.stringify("Preserved sender"))
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT ?, 'local', ?, artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-marketing' LIMIT 1",
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

test.each(["supbrd-plugmod-marketing", "supbrd-plugmod-email"])(
	"disabled %s refuses its settings APIs",
	async (component) => {
		await env.DB.prepare(
			"UPDATE superboard_plugin_lifecycle SET state = 'disabled' WHERE instance_id = ? AND target = 'local' AND plugin_id = ?",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, component)
			.run();
		const service = component === "supbrd-plugmod-email" ? "email" : "marketing";
		for (const [path, method] of endpoints.filter(([candidate]) =>
			candidate?.startsWith("/api/v1/" + service + "/"),
		)) {
			const response = await SELF.fetch(origin + path, { method, headers });
			expect(response.status).toBe(404);
		}
	},
);
