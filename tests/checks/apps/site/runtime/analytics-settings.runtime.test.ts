import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const pluginId = "supbrd-plug-analytics";
const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};

test.each(["diagnostic", "health"])(
	"Analytics %s rejects an editor without plugins:manage",
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
	"disabled Analytics has no %s and retains its settings",
	async (action) => {
		const key = "plugin:supbrd-plugmod-analytics:settings:enabled";
		await env.DB.prepare("INSERT OR REPLACE INTO options (name, value) VALUES (?, ?)")
			.bind(key, JSON.stringify(true))
			.run();
		await env.DB.prepare(
			"INSERT OR REPLACE INTO superboard_plugin_lifecycle (instance_id, target, plugin_id, artifact_checksum, state, state_changed_at) SELECT ?, 'local', ?, artifact_checksum, 'disabled', datetime('now') FROM superboard_plugin_manifest_artifacts WHERE plugin_id = 'supbrd-plugmod-analytics' LIMIT 1",
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
		).toBe(JSON.stringify(true));
	},
);

test.each([
	["GET", "settings"],
	["PUT", "settings"],
	["GET", "applications"],
	["PUT", "applications/test-app"],
	["GET", "hooks"],
	["POST", "hooks"],
	["GET", "annotations"],
	["POST", "annotations"],
])("Analytics %s %s rejects an editor", async (method, path) => {
	const response = await SELF.fetch(
		`https://site.example/api/v1/analytics/projects/project-test/${path}`,
		{
			method,
			headers: {
				...headers,
				"X-Parity-Role": "editor",
				"Content-Type": "application/json",
				"Idempotency-Key": crypto.randomUUID(),
			},
			...(method === "GET" ? {} : { body: "{}" }),
		},
	);
	expect(response.status).toBe(403);
});
