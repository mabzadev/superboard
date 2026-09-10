import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

import { resolveSiteFrontPage } from "../../../../../apps/site/src/lib/front-page.js";

const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
const routes = [
	"/login",
	"/register",
	"/register/with_email",
	"/new_password",
	"/reset_password",
	"/accept-invite",
];

test("core operator aliases remain usable after their plugin Worker receipt expires", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{ method: "POST", headers },
	);
	expect(enabled.ok).toBe(true);
	await env.DB.prepare("UPDATE superboard_dependency_health SET expires_at=? WHERE dependency_id=?")
		.bind("2000-01-01T00:00:00.000Z", "dependency.supbrd_plug_user")
		.run();
	const unavailableWorker = { ...env, API_SERVICE: undefined };
	for (const path of routes) {
		const page = await resolveSiteFrontPage(unavailableWorker, path);
		expect(page.resolution.result, path).toBe("rendered");
	}
	const user = {
		id: "operator-1",
		email: "operator@example.test",
		name: "Operator",
		role: 50 as const,
		disabled: false,
	};
	for (const path of ["/account", "/app/profile"])
		expect((await resolveSiteFrontPage(unavailableWorker, path, user)).resolution.result).toBe(
			"rendered",
		);
	expect(
		(await resolveSiteFrontPage(unavailableWorker, "/identity/en/users", user)).resolution.result,
	).toBe("unavailable");
	expect(
		await env.DB.prepare(
			"SELECT expires_at FROM superboard_dependency_health WHERE dependency_id=?",
		)
			.bind("dependency.supbrd_plug_user")
			.first(),
	).toEqual({ expires_at: "2000-01-01T00:00:00.000Z" });
	const disabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/disable",
		{ method: "POST", headers },
	);
	expect(disabled.ok).toBe(true);
	for (const path of routes)
		expect((await resolveSiteFrontPage(unavailableWorker, path)).resolution.result).toBe(
			"not_found",
		);
});
