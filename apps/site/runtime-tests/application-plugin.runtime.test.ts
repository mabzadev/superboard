import { env, SELF, createExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";

import { dispatchLifecycleApi } from "./lifecycle-health-services.js";

const operatorHeaders = {
	"X-Parity-Operator": "1",
	"X-EmDash-Request": "1",
	Origin: "https://site.example",
	"Content-Type": "application/json",
	"Idempotency-Key": "application-scope-initialize",
};
function applicationCall(
	kind: "commands" | "data-sources",
	id: string,
	sdk: Record<string, string>,
	body?: unknown,
	pluginId = "supbrd-plug-user",
) {
	const method = kind === "commands" ? "POST" : "GET";
	const envelope = {
		method,
		path: `/api/v1/application-identity/${kind}/${id}`,
		...(body === undefined ? {} : { body }),
	};
	return SELF.fetch(
		`https://site.example/_emdash/api/superboard/plugins/${pluginId}/${kind}/${id}${method === "GET" ? `?request=${encodeURIComponent(JSON.stringify(envelope))}` : ""}`,
		{
			method,
			headers: { ...sdk, "Content-Type": "application/json" },
			...(method === "POST" ? { body: JSON.stringify(envelope) } : {}),
		},
	);
}
test("application User contracts authenticate SDK users without an EmDash session and reject mixed project credentials", async () => {
	const enabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/enable",
		{ method: "POST", headers: operatorHeaders },
	);
	expect(enabled.status, await enabled.clone().text()).toBe(201);
	const scoped = await SELF.fetch("https://site.example/_emdash/api/superboard/operator-context", {
		method: "POST",
		headers: operatorHeaders,
	});
	expect(scoped.status).toBe(200);
	const databases = env as unknown as { HEALTH_API_DB: D1Database; HEALTH_IDENTITY_DB: D1Database };
	const instance = await databases.HEALTH_API_DB.prepare(
		"SELECT id,api_key FROM instances WHERE uri_scheme='vocostar'",
	).first<{ id: number; api_key: string }>();
	const application = await databases.HEALTH_API_DB.prepare(
		"INSERT INTO applications(instance_id,platform,enabled) VALUES (?,'web',1) RETURNING id",
	)
		.bind(instance!.id)
		.first<{ id: number }>();
	await databases.HEALTH_API_DB.prepare(
		"INSERT INTO web_configurations(application_id,site_url) VALUES (?,'https://autonomy.example')",
	)
		.bind(application!.id)
		.run();
	const sdk = {
		"PROJECT-KEY": `test_${instance!.api_key}`,
		PLATFORM: "web",
		IDENTIFIER: "autonomy.example",
	};
	const registered = await dispatchLifecycleApi(
		new Request("https://api.site.test/auth/register", {
			method: "POST",
			headers: { ...sdk, "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "application-only@example.test",
				password: "autonomy-password-123",
				name: "Application identity",
			}),
		}),
		env as unknown as Record<string, unknown>,
		createExecutionContext(),
	);
	expect(registered.status).toBe(201);
	const registration = (await registered.json()) as { user: { id: string }; session_id: string };
	const userId = registration.user.id;

	expect(
		(
			await applicationCall(
				"commands",
				"application_sign_in",
				{},
				{ email: "application-only@example.test", password: "autonomy-password-123" },
			)
		).status,
	).toBe(401);
	const signed = await applicationCall("commands", "application_sign_in", sdk, {
		email: "application-only@example.test",
		password: "autonomy-password-123",
	});
	expect(signed.status, signed.status === 200 ? undefined : await signed.clone().text()).toBe(200);
	const session = (await signed.json()) as {
		access_token: string;
		session_id: string;
		expires_at: string;
		user_id: string;
	};
	expect(session.user_id).toBe(userId);
	expect(session.session_id).toBeTruthy();
	const authenticated = { ...sdk, Authorization: `Bearer ${session.access_token}` };
	const groupedSessions = await applicationCall(
		"data-sources",
		"active_sessions",
		authenticated,
		undefined,
		"supbrd-plug-identity",
	);
	expect(groupedSessions.status, await groupedSessions.clone().text()).toBe(200);
	expect(await groupedSessions.json()).toMatchObject({
		session_ids: expect.arrayContaining([session.session_id]),
	});
	expect(
		(
			await applicationCall(
				"data-sources",
				"active_sessions",
				{ ...authenticated, "PROJECT-KEY": instance!.api_key },
				undefined,
				"supbrd-plug-identity",
			)
		).status,
	).toBe(403);
	expect(
		await (await applicationCall("data-sources", "active_sessions", authenticated)).json(),
	).toMatchObject({
		session_ids: expect.arrayContaining([registration.session_id, session.session_id]),
	});
	expect(
		await (await applicationCall("data-sources", "linked_providers", authenticated)).json(),
	).toEqual({ providers: [] });
	expect(
		(
			await applicationCall("data-sources", "active_sessions", {
				...authenticated,
				"PROJECT-KEY": instance!.api_key,
			})
		).status,
	).toBe(403);
	expect(
		(
			await applicationCall("commands", "link_provider", authenticated, {
				user_id: "different-identity",
				provider: "google",
				token: "invalid-provider-proof",
			})
		).status,
	).toBe(403);
	expect(
		(
			await applicationCall("commands", "revoke_application_session", authenticated, {
				session_id: "another-users-session",
			})
		).status,
	).toBe(404);
	const revoked = await applicationCall("commands", "revoke_application_session", authenticated, {
		session_id: session.session_id,
	});
	expect(revoked.status).toBe(200);
	expect((await applicationCall("data-sources", "active_sessions", authenticated)).status).toBe(
		401,
	);
	expect(
		await databases.HEALTH_API_DB.prepare("SELECT COUNT(*) AS count FROM users").first(),
	).toEqual({ count: 0 });
	const disabled = await SELF.fetch(
		"https://site.example/_emdash/api/superboard/plugins/supbrd-plug-user/disable",
		{
			method: "POST",
			headers: { ...operatorHeaders, "Idempotency-Key": "application-user-disable" },
		},
	);
	expect(disabled.status).toBe(201);
	expect(
		(
			await applicationCall("commands", "application_sign_in", sdk, {
				email: "application-only@example.test",
				password: "autonomy-password-123",
			})
		).status,
	).toBe(404);
	const direct = await dispatchLifecycleApi(
		new Request("https://api.site.test/auth/signin/password", {
			method: "POST",
			headers: { ...sdk, "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "application-only@example.test",
				password: "autonomy-password-123",
			}),
		}),
		env as unknown as Record<string, unknown>,
		createExecutionContext(),
	);
	expect(direct.status).toBe(404);
});
