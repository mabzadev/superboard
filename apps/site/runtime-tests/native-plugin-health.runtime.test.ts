import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { inspectSitePluginWorkerHealth } from "../../../workers/api/src/lib/site-plugin-health.js";

test.each(["supbrd-plug-user", "supbrd-plug-products", "supbrd-plug-settings"])(
	"%s cannot activate when its required Worker binding is missing",
	async (pluginId) => {
		const values = env as unknown as { HEALTH_API_DB: D1Database; HEALTH_MIGRATIONS_JSON: string };
		const migrations = JSON.parse(values.HEALTH_MIGRATIONS_JSON) as Record<
			string,
			Array<{ name: string }>
		>;
		const response = await inspectSitePluginWorkerHealth(
			{
				DB: values.HEALTH_API_DB,
				KV: env.RELEASE_CACHE,
				D1_EXPECTED_MIGRATION: migrations.api!.at(-1)!.name,
			} as never,
			pluginId,
		);
		expect(response.status).toBe(503);
	},
);


test("an expired activation receipt rechecks the Worker before rendering the active plugin", async () => {
 const enabled = await SELF.fetch("https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-paywalls/enable", {method:"POST",headers:{Origin:"https://site.example","X-EmDash-Request":"1","X-Parity-Operator":"1"}});
 expect(enabled.status).toBe(201);
 await env.DB.prepare("UPDATE superboard_dependency_health SET expires_at = ? WHERE dependency_id = ?").bind("2000-01-01T00:00:00.000Z","dependency.supbrd_plugmod_paywalls").run();
 const {resolveSiteFrontPage} = await import("../src/lib/front-page.js");
 const user = {id:"operator-1", email:"operator@example.com", name:"Operator", role:50 as const, disabled:false};
 const page = await resolveSiteFrontPage(env,"/paywalls",user);
 expect(page.resolution.result).toBe("rendered");
 const unavailable = await resolveSiteFrontPage({...env,API_SERVICE:undefined} as never,"/paywalls",user);
 expect(unavailable.resolution.result).toBe("unavailable");
});
