import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import baseline from "../../../../../scripts/config/superboard-plugin-independence-baseline.json";
import { apiHeaders, prepareApiPlugin, proveApi } from "./retirement-api-helpers.js";

test.each(baseline.plugins.map((plugin) => plugin.plugin_id))(
	"%s exposes the enabled persisted artifact through its canonical health API",
	async (pluginId) => {
		await prepareApiPlugin(pluginId);
		const response = await SELF.fetch(
			`https://site.example/_emdash/api/plugins/${pluginId}/health`,
			{ headers: apiHeaders },
		);
		expect(response.status, await response.clone().text()).toBe(200);
		const body = await response.json<Record<string, unknown>>();
		const health = body.data ?? body;
		const installed = await env.DB.prepare(
			"SELECT artifact_checksum,state FROM superboard_plugin_lifecycle WHERE instance_id=? AND target='local' AND plugin_id=?",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, pluginId)
			.first<{ artifact_checksum: string; state: string }>();
		expect(installed?.state).toBe("active");
		expect(health).toMatchObject({
			plugin_id: pluginId,
			status: "ready",
			artifact_checksum: installed!.artifact_checksum,
		});
		proveApi(pluginId, "health", "read", "retirement-api-health.runtime.test.ts");
	},
);
