import { createProjectContextHeaders } from "@superboard/contracts/project-context";
import {
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { env, SELF, createExecutionContext } from "cloudflare:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { expect, test, vi } from "vitest";

import identityWorker from "../../../../../../packages/plugins/superboard-authentification/worker/src/index.js";

async function request(
	path: string,
	method = "GET",
	body?: unknown,
	projectId = 81,
	idempotencyKey = crypto.randomUUID(),
) {
	const context: InternalProjectContext = {
		projectId,
		projectRef: `${projectId}-test`,
		instanceId: projectId,
		environment: "test",
		actorId: 0,
		operatorId: "emdash-operator",
		role: "owner",
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
		module: "identity",
		method,
		pathname: new URL(path, "https://identity.test").pathname,
	};
	const headers = new Headers({
		"Content-Type": "application/json",
		"Idempotency-Key": idempotencyKey,
	});
	const values = {
		token: "identity-runtime-internal-token",
		projectId: String(projectId),
		projectRef: context.projectRef,
		instanceId: String(projectId),
		environment: "test",
		actorId: "0",
		operatorId: "emdash-operator",
		role: "owner",
		requestId: context.requestId,
		issuedAt: String(context.issuedAt),
		version: "1",
		signature: await signProjectContext(context, "identity-runtime-internal-token"),
	};
	for (const [key, value] of Object.entries(values))
		headers.set(PROJECT_CONTEXT_HEADERS[key as keyof typeof PROJECT_CONTEXT_HEADERS], value);
	return SELF.fetch(`https://identity.test${path}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

test("operator User commands mutate the selected application user and suspend all of its sessions", async () => {
	const created = await request("/auth/anonymous", "POST", {
		installation_id: "operator-user-independence",
	});
	expect(created.status).toBe(200);
	const identity = (await created.json()) as {
		user: { id: string };
		access_token: string;
		refresh_token: string;
		session_id: string;
		expires_at: string;
	};
	const profilePath = `/internal/v1/admin/profiles/${identity.user.id}`;
	const edited = await request(profilePath, "PUT", {
		user_id: identity.user.id,
		display_name: "Application user renamed",
	});
	expect(edited.status, await edited.clone().text()).toBe(200);
	expect(await edited.json()).toEqual({
		data: { user_id: identity.user.id, email: null, display_name: "Application user renamed" },
	});
	expect((await request(profilePath, "GET", undefined, 82)).status).toBe(404);
	expect(await (await request("/internal/v1/admin/members?page=1&page_size=10")).json()).toEqual({
		data: { items: [identity.user.id], next_page: null },
	});
	const sessions = await SELF.fetch("https://identity.test/auth/me/sessions", {
		headers: { Authorization: `Bearer ${identity.access_token}` },
	});
	expect(sessions.status).toBe(200);
	expect(await sessions.json()).toEqual({ session_ids: [identity.session_id] });
	const suspended = await request(`${profilePath}/suspend`, "POST", {
		user_id: identity.user.id,
		reason: "Operator requested suspension",
	});
	expect(suspended.status, await suspended.clone().text()).toBe(200);
	expect(await suspended.json()).toEqual({
		data: { user_id: identity.user.id, status: "suspended" },
	});
	expect(
		(
			await SELF.fetch("https://identity.test/auth/me", {
				headers: { Authorization: `Bearer ${identity.access_token}` },
			})
		).status,
	).toBe(401);
	expect(
		(
			await SELF.fetch("https://identity.test/auth/refresh", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ refresh_token: identity.refresh_token }),
			})
		).status,
	).toBe(401);
	expect(
		(await request("/auth/anonymous", "POST", { installation_id: "operator-user-independence" }))
			.status,
	).toBe(403);
	expect(
		await env.DB.prepare(
			"SELECT reason,operator_id FROM application_user_suspensions WHERE user_id=?",
		)
			.bind(identity.user.id)
			.first(),
	).toEqual({ reason: "Operator requested suspension", operator_id: "emdash-operator" });
	expect(
		await env.DB.prepare(
			"SELECT COUNT(*) AS count FROM application_user_operations WHERE user_id=?",
		)
			.bind(identity.user.id)
			.first(),
	).toEqual({ count: 2 });
});

test("application provider linking verifies the external proof and never links the same provider identity to another user", async () => {
	const created = await request("/auth/anonymous", "POST", {
		installation_id: "google-proof-owner",
	});
	const owner = (await created.json()) as { user: { id: string }; access_token: string };
	const other = (await (
		await request("/auth/anonymous", "POST", { installation_id: "google-proof-other" })
	).json()) as { user: { id: string }; access_token: string };
	const keys = await generateKeyPair("RS256", { extractable: true });
	const jwk = await exportJWK(keys.publicKey);
	jwk.kid = "google-runtime-proof";
	const proof = await new SignJWT({ email: "provider-owner@example.test", email_verified: true })
		.setProtectedHeader({ alg: "RS256", kid: jwk.kid })
		.setSubject("external-google-subject")
		.setIssuer("https://accounts.google.com")
		.setAudience("runtime.google")
		.setIssuedAt()
		.setExpirationTime("5m")
		.sign(keys.privateKey);
	const external = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
		const url = input instanceof Request ? input.url : String(input);
		expect(url).toBe("https://www.googleapis.com/oauth2/v3/certs");
		return Response.json({ keys: [jwk] });
	});
	async function link(user: typeof owner, projectId = 81) {
		const path = "/internal/v1/application-plugin/commands/link_provider";
		const headers = await createProjectContextHeaders(
			{
				module: "identity",
				method: "POST",
				pathname: path,
				projectId,
				projectRef: `${projectId}-test`,
				instanceId: projectId,
				environment: "test",
				actorId: 0,
				role: "sdk",
				requestId: crypto.randomUUID(),
				issuedAt: Math.floor(Date.now() / 1000),
			},
			"identity-runtime-internal-token",
		);
		headers.set("Authorization", `Bearer ${user.access_token}`);
		headers.set("Content-Type", "application/json");
		return identityWorker.fetch!(
			new Request(`https://identity.test${path}`, {
				method: "POST",
				headers,
				body: JSON.stringify({ user_id: user.user.id, provider: "google", id_token: proof }),
			}),
			{ ...env, GOOGLE_AUDIENCES_JSON: '["runtime.google"]' },
			createExecutionContext(),
		);
	}
	try {
		const linked = await link(owner);
		expect(linked.status, linked.status === 200 ? undefined : await linked.clone().text()).toBe(
			200,
		);
		expect(await linked.json()).toMatchObject({ provider: "google", linked: true });
		expect(await (await link(owner)).json()).toMatchObject({ linked: true, idempotent: true });
		expect((await link(owner, 82)).status).toBe(403);
		expect((await link(other)).status).toBe(409);
		expect(
			await env.DB.prepare(
				"SELECT user_id,provider FROM application_identities WHERE provider='google'",
			).all(),
		).toMatchObject({ results: [{ user_id: owner.user.id, provider: "google" }] });
		expect(external).toHaveBeenCalledTimes(1);
	} finally {
		external.mockRestore();
	}
});

test("operator MFA enrollment and reset resolve the project-bound application subject", async () => {
	const user = await env.DB.prepare('INSERT INTO "user"("authId",email) VALUES(?,?) RETURNING id')
		.bind("native-mfa-user", "mfa-subject@example.test")
		.first<{ id: number }>();
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO application_users(id,project_id,email,is_anonymous) VALUES('application-mfa-user',81,'mfa-subject@example.test',0)",
		),
		env.DB.prepare(
			"INSERT INTO identity_subject_bridge(id,realm,melody_user_id,project_id,application_user_id) VALUES('mfa-bridge',?,?,81,'application-mfa-user')",
		).bind((env as unknown as { IDENTITY_REALM: string }).IDENTITY_REALM, user!.id),
	]);
	expect(
		await (await request("/internal/v1/admin/profiles/application-mfa-user/security")).json(),
	).toMatchObject({ data: { directory_subject: "application-mfa-user" } });
	const path = "/internal/v1/melody-admin/api/v1/users/application-mfa-user/sms-mfa";
	expect((await request(path, "POST", {}, 82)).status).toBe(404);
	const enrolled = await request(path, "POST", {});
	expect(enrolled.status, await enrolled.clone().text()).toBe(204);
	expect(
		await env.DB.prepare('SELECT "mfaTypes" FROM "user" WHERE id=?').bind(user!.id).first(),
	).toEqual({ mfaTypes: "sms" });
	expect((await request(path, "DELETE")).status).toBe(204);
	expect(
		await env.DB.prepare('SELECT "mfaTypes" FROM "user" WHERE id=?').bind(user!.id).first(),
	).toEqual({ mfaTypes: "" });
});

test("operators can inspect and revoke one application session without affecting another account", async () => {
	const first = (await (
		await request("/auth/anonymous", "POST", { installation_id: "session-owner" })
	).json()) as { user: { id: string }; session_id: string; access_token: string };
	const second = (await (
		await request("/auth/anonymous", "POST", { installation_id: "session-other" })
	).json()) as typeof first;
	const base = `/internal/v1/admin/profiles/${first.user.id}`;
	const listed = await request(`${base}/security`);
	expect(listed.status).toBe(200);
	expect(await listed.json()).toMatchObject({
		data: { suspended: false, items: [{ id: first.session_id, status: "active" }] },
	});
	expect((await request(`${base}/security`, "GET", undefined, 82)).status).toBe(404);
	expect(
		(
			await request(`${base}/sessions/${second.session_id}/revoke`, "POST", {
				user_id: first.user.id,
			})
		).status,
	).toBe(404);
	expect(
		(
			await request(`${base}/sessions/${first.session_id}/revoke`, "POST", {
				user_id: first.user.id,
			})
		).status,
	).toBe(200);
	expect(
		(
			await SELF.fetch("https://identity.test/auth/me", {
				headers: { Authorization: `Bearer ${first.access_token}` },
			})
		).status,
	).toBe(401);
	expect(
		(
			await SELF.fetch("https://identity.test/auth/me", {
				headers: { Authorization: `Bearer ${second.access_token}` },
			})
		).status,
	).toBe(200);
	expect(await (await request(`${base}/security`)).json()).toMatchObject({
		data: { items: [{ status: "revoked" }] },
	});
});

test("reactivation permits a new sign-in but never restores revoked sessions", async () => {
	const installation_id = "resume-owner";
	const identity = (await (
		await request("/auth/anonymous", "POST", { installation_id })
	).json()) as { user: { id: string }; access_token: string };
	const base = `/internal/v1/admin/profiles/${identity.user.id}`;
	await request(`${base}/suspend`, "POST", { user_id: identity.user.id, reason: "Review" });
	expect(await (await request(`${base}/security`)).json()).toMatchObject({
		data: { suspended: true },
	});
	expect((await request(`${base}/resume`, "POST", { user_id: identity.user.id }, 82)).status).toBe(
		404,
	);
	expect((await request(`${base}/resume`, "POST", { user_id: identity.user.id })).status).toBe(200);
	expect((await request("/auth/anonymous", "POST", { installation_id })).status).toBe(200);
	expect(
		(
			await SELF.fetch("https://identity.test/auth/me", {
				headers: { Authorization: `Bearer ${identity.access_token}` },
			})
		).status,
	).toBe(401);
	expect(
		await env.DB.prepare(
			"SELECT action FROM application_user_operations WHERE user_id=? AND action='resume_member'",
		)
			.bind(identity.user.id)
			.first(),
	).toEqual({ action: "resume_member" });
});

test("security pagination omits credentials and replayed actions do not change the selected subject", async () => {
	const created = (await (
		await request("/auth/anonymous", "POST", { installation_id: "pagination-owner" })
	).json()) as { user: { id: string } };
	const userId = created.user.id;
	await env.DB.batch(
		Array.from({ length: 55 }, (_, index) =>
			env.DB.prepare(
				"INSERT INTO application_sessions(id,project_id,user_id,refresh_token_hash,expires_at) VALUES(?,81,?,?,'2099-01-01')",
			).bind(`session-${String(index).padStart(3, "0")}`, userId, `private-hash-${index}`),
		),
	);
	const base = `/internal/v1/admin/profiles/${userId}`;
	const first = (await (await request(`${base}/security`)).json()) as {
		data: { items: { id: string }[]; nextCursor: string };
	};
	expect(first.data.items).toHaveLength(50);
	expect(JSON.stringify(first)).not.toContain("private-hash");
	expect(JSON.stringify(first)).not.toContain("refresh_token");
	const second = (await (
		await request(`${base}/security?cursor=${first.data.nextCursor}`)
	).json()) as typeof first;
	expect(second.data.items).toHaveLength(6);
	expect(new Set([...first.data.items, ...second.data.items].map((item) => item.id)).size).toBe(56);
	const key = crypto.randomUUID();
	const path = `${base}/sessions/session-000/revoke`;
	const results = await Promise.all([
		request(path, "POST", { user_id: userId }, 81, key),
		request(path, "POST", { user_id: userId }, 81, key),
	]);
	expect(results.map((response) => response.status)).toEqual([200, 200]);
	expect(
		await env.DB.prepare(
			"SELECT COUNT(*) count FROM application_user_operations WHERE project_id=81 AND operation_id=?",
		)
			.bind(key)
			.first(),
	).toEqual({ count: 1 });
	expect(
		(await request(`${base}/sessions/session-001/revoke`, "POST", { user_id: userId }, 81, key))
			.status,
	).toBe(409);
	expect(
		await env.DB.prepare(
			"SELECT revoked_at FROM application_sessions WHERE id='session-001'",
		).first(),
	).toEqual({ revoked_at: null });
});
