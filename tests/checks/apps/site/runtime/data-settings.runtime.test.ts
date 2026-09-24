import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const pluginId = "supbrd-plug-data";
const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};

test.each(["diagnostic", "health"])(
	"Data %s rejects an editor without plugins:manage",
	async (action) => {
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${action}`,
			{
				method: action === "health" ? "POST" : "GET",
				headers: { ...headers, "X-Parity-Role": "editor" },
			},
		);
		expect(response.status).toBe(403);
	},
);

test.each(["diagnostic", "health"])(
	"disabled Data has no %s and retains its settings",
	async (action) => {
		const key = "plugin:supbrd-plug-content:settings:default_locale";
		await env.DB.prepare("INSERT OR REPLACE INTO options (name, value) VALUES (?, ?)")
			.bind(key, JSON.stringify("fr"))
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT ?, 'local', ?, artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-files' LIMIT 1",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, pluginId)
			.run();
		expect(
			await env.DB.prepare("SELECT state FROM superboard_plugin_lifecycle WHERE plugin_id = ?")
				.bind(pluginId)
				.first("state"),
		).toBe("disabled");
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${action}`,
			{
				method: action === "health" ? "POST" : "GET",
				headers,
			},
		);
		expect(response.status).toBe(404);
		expect(
			await env.DB.prepare("SELECT value FROM options WHERE name = ?").bind(key).first("value"),
		).toBe(JSON.stringify("fr"));
	},
);
