import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

test("an EmDash operator reads and saves Support preferences without creating an application membership", async () => {
	const headers = {
		Origin: "https://site.example",
		"X-EmDash-Request": "1",
		"X-Parity-Operator": "1",
		"Content-Type": "application/json",
	};
	expect(
		(
			await SELF.fetch(
				"https://site.example/_emdash/api/superboard/plugins/supbrd-plugmod-support/enable",
				{ method: "POST", headers },
			)
		).status,
	).toBe(201);
	const scopeResponse = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/operator-context",
		{ method: "POST", headers: { ...headers, "Idempotency-Key": "support-scope" } },
	);
	const scope = (await scopeResponse.json()) as { production_project_ref: string };
	const url = `https://site.example/api/v1/support/projects/${scope.production_project_ref}/notifications/preferences`;
	const initial = await SELF.fetch(url, { headers });
	expect(initial.status, await initial.clone().text()).toBe(200);
	expect(await initial.json()).toMatchObject({
		data: { email_enabled: true, operator_id: "operator-1" },
	});
	const saved = await SELF.fetch(url, {
		method: "PUT",
		headers: { ...headers, "Idempotency-Key": "support-preferences" },
		body: JSON.stringify({ email_enabled: false, audio_enabled: false, muted_event_types: [] }),
	});
	expect(saved.status, await saved.clone().text()).toBe(200);
	expect(await (await SELF.fetch(url, { headers })).json()).toMatchObject({
		data: { email_enabled: false, audio_enabled: false, operator_id: "operator-1" },
	});
	const db = (env as unknown as { HEALTH_SUPPORT_DB: D1Database }).HEALTH_SUPPORT_DB;
	expect(await db.prepare("SELECT COUNT(*) AS count FROM support_memberships").first()).toEqual({
		count: 0,
	});
	expect(
		await db
			.prepare("SELECT operator_id,email_enabled FROM support_operator_notification_preferences")
			.first(),
	).toEqual({ operator_id: "operator-1", email_enabled: 0 });
});
