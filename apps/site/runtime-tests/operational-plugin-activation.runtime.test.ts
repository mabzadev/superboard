import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

test.runIf(env.SUPERBOARD_ENVIRONMENT === "development")(
	"a deployed console activates a plugin after verification and preserves access controls",
	async () => {
		const url = "https://site.example/_emdash/api/superboard/plugins/supbrd-plug-data/enable";
		const headers = {
			Origin: "https://site.example",
			"X-EmDash-Request": "1",
			"X-Parity-Operator": "1",
		};
		expect((await SELF.fetch(url, { method: "POST" })).status).toBe(401);
		expect(
			(
				await SELF.fetch(url, {
					method: "POST",
					headers: { ...headers, Origin: "https://foreign.example" },
				})
			).status,
		).toBe(403);
		const unverified = await SELF.fetch(url, { method: "POST", headers });
		expect(unverified.status).toBe(403);
		expect(await unverified.json()).toMatchObject({ error: { code: "STRONG_REAUTH_REQUIRED" } });
		const verified = {
			...headers,
			"X-Parity-Reauthenticated": "1",
			"Idempotency-Key": "operational-plugin-activation",
		};
		const activated = await SELF.fetch(url, { method: "POST", headers: verified });
		expect(activated.status, await activated.clone().text()).toBe(201);
		const result = await activated.json();
		expect(result).toMatchObject({ status: "active", package_id: "supbrd-plug-data" });
		const replay = await SELF.fetch(url, { method: "POST", headers: verified });
		expect(await replay.json()).toEqual(result);
		const state = await env.DB.prepare(
			"SELECT enabled FROM superboard_plugin_packages WHERE instance_id=? AND target=? AND package_id=?",
		)
			.bind(env.SUPERBOARD_INSTANCE_ID, "development", "supbrd-plug-data")
			.first<{ enabled: number }>();
		expect(state?.enabled).toBe(1);
	},
);
