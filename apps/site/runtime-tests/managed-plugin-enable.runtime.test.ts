import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

test("the host lifecycle actions enable and disable only the selected managed plugin", async () => {
	const installed = await SELF.fetch("https://site.example/_emdash/api/superboard/plugins/sync", {
		method: "POST",
		headers: {
			Origin: "https://site.example",
			"Content-Type": "application/json",
			"X-EmDash-Request": "1",
			"X-Parity-Operator": "1",
		},
		body: JSON.stringify({
			plan_id: "managed-plugin-prerequisite",
			expires_in_hours: 1,
			plugin_ids: ["supbrd-plug-settings"],
		}),
	});
	expect(installed.status, await installed.clone().text()).toBe(201);

	const response = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{
			method: "POST",
			headers: {
				Origin: "https://site.example",
				"X-EmDash-Request": "1",
				"X-Parity-Operator": "1",
			},
		},
	);

	expect(response.status, await response.clone().text()).toBe(201);
	expect(await response.json()).toMatchObject({
		plugin_id: "supbrd-plug-user",
		status: "active",
		release_id: expect.any(String),
	});
	const lifecycle = await env.DB.prepare(
		`SELECT state, activated_release_id
		 FROM superboard_plugin_lifecycle
		 WHERE instance_id = ? AND target = 'local' AND plugin_id = ?`,
	)
		.bind("vocostar", "supbrd-plug-user")
		.first<{ state: string; activated_release_id: string | null }>();
	expect(lifecycle).toMatchObject({ state: "active", activated_release_id: expect.any(String) });
	const unrelatedLifecycle = await env.DB.prepare(
		`SELECT state, activated_release_id
		 FROM superboard_plugin_lifecycle
		 WHERE instance_id = ? AND target = 'local' AND plugin_id = ?`,
	)
		.bind("vocostar", "supbrd-plug-settings")
		.first<{ state: string; activated_release_id: string | null }>();
	expect(unrelatedLifecycle).toEqual({ state: "installed", activated_release_id: null });

	const enabledSettings = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings/enable",
		{
			method: "POST",
			headers: {
				Origin: "https://site.example",
				"X-EmDash-Request": "1",
				"X-Parity-Operator": "1",
			},
		},
	);
	expect(enabledSettings.status, await enabledSettings.clone().text()).toBe(201);

	const disabledSettings = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-settings/disable",
		{
			method: "POST",
			headers: {
				Origin: "https://site.example",
				"X-EmDash-Request": "1",
				"X-Parity-Operator": "1",
			},
		},
	);
	expect(disabledSettings.status, await disabledSettings.clone().text()).toBe(201);
	expect(await disabledSettings.json()).toMatchObject({
		plugin_id: "supbrd-plug-settings",
		status: "disabled",
		release_id: expect.any(String),
	});

	const lifecycleAfterDisable = await env.DB.prepare(
		`SELECT plugin_id, state
		 FROM superboard_plugin_lifecycle
		 WHERE instance_id = ? AND target = 'local'
		   AND plugin_id IN (?, ?)
		 ORDER BY plugin_id`,
	)
		.bind("vocostar", "supbrd-plug-settings", "supbrd-plug-user")
		.all<{ plugin_id: string; state: string }>();
	expect(lifecycleAfterDisable.results).toEqual([
		{ plugin_id: "supbrd-plug-settings", state: "disabled" },
		{ plugin_id: "supbrd-plug-user", state: "active" },
	]);
});
