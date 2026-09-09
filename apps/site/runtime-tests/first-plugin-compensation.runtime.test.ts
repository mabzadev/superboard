import { pluginPackageComponents } from "@superboard/contracts/plugin-packages";
import { SELF, env } from "cloudflare:test";
import { expect, test } from "vitest";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};

test("compensates the first activation and permits a fresh independent installation", async () => {
	await env.DB.exec(
		"CREATE TRIGGER fail_first_activation BEFORE INSERT ON _plugin_state WHEN NEW.plugin_id = 'supbrd-plug-identity' AND NEW.status = 'active' BEGIN SELECT RAISE(ABORT, 'injected first activation failure'); END;",
	);
	const failed = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{ method: "POST", headers },
	);
	expect(failed.status, await failed.clone().text()).toBe(500);
	expect(await failed.json()).toMatchObject({ error: { code: "PLUGIN_ACTIVATION_COMPENSATED" } });
	expect(
		await env.DB.prepare("SELECT active_release_id FROM superboard_front_active_releases").first(),
	).toBeNull();
	expect(
		await env.DB.prepare(
			"SELECT target_release_id, status FROM superboard_plugin_compensations",
		).first(),
	).toEqual({ target_release_id: null, status: "completed" });
	expect(
		await env.DB.prepare(
			"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active'",
		).first(),
	).toBeNull();
	await env.DB.exec("DROP TRIGGER fail_first_activation;");
	const installed = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-core/enable",
		{ method: "POST", headers },
	);
	expect(installed.status, await installed.clone().text()).toBe(201);
	const active = await env.DB.prepare(
		"SELECT plugin_id FROM superboard_plugin_lifecycle WHERE state = 'active'",
	).all<{ plugin_id: string }>();
	expect(active.results.map(({ plugin_id }) => plugin_id).toSorted()).toEqual(
		[...pluginPackageComponents("supbrd-core")].toSorted(),
	);
});
