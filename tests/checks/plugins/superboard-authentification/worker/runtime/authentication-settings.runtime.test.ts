import {
	PROJECT_CONTEXT_HEADERS,
	signProjectContext,
	type InternalProjectContext,
} from "@superboard/contracts/project-context";
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, test } from "vitest";

const path = "/internal/v1/melody-admin/api/v1/configuration";

const database = Reflect.get(env, "DB") as D1Database;
async function clearConfiguration() {
	await database.batch([
		database.prepare("DELETE FROM identity_configuration"),
		database.prepare("DELETE FROM identity_configuration_history"),
	]);
}
beforeEach(clearConfiguration);
afterEach(clearConfiguration);

async function request(
	method: string,
	body?: unknown,
	operator = true,
	role = "admin",
	pathname = path,
) {
	const context: InternalProjectContext = {
		module: "identity",
		method,
		pathname,
		projectId: 101,
		instanceId: 10,
		projectRef: "10-test",
		environment: "test",
		actorId: 0,
		role,
		requestId: crypto.randomUUID(),
		issuedAt: Math.floor(Date.now() / 1000),
		...(operator ? { operatorId: "settings-operator" } : {}),
	};
	const headers = new Headers({ "content-type": "application/json" });
	for (const [key, value] of Object.entries({
		token: "identity-runtime-internal-token",
		projectId: "101",
		projectRef: "10-test",
		instanceId: "10",
		environment: "test",
		actorId: "0",
		role,
		requestId: context.requestId,
		issuedAt: String(context.issuedAt),
		version: "1",
		signature: await signProjectContext(context, "identity-runtime-internal-token"),
		...(operator ? { operatorId: "settings-operator" } : {}),
	})) {
		const header = Reflect.get(PROJECT_CONTEXT_HEADERS, key);
		if (typeof header === "string") headers.set(header, value);
	}
	return SELF.fetch(`https://identity.test${pathname}`, {
		method,
		headers,
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

test("an operator saves settings and subsequent public authentication requests apply them", async () => {
	const initial = await request("GET");
	expect(initial.status).toBe(200);
	const before = await initial.json<{ revision: number; values: Record<string, unknown> }>();
	expect(before.values.ENABLE_SIGN_UP).toBe(true);
	expect(before.values).not.toHaveProperty("MELODY_AUTH_SECRETS");
	const saved = await request("PUT", {
		revision: before.revision,
		values: { EMAIL_SENDER_NAME: "Updated sender", ENABLE_SIGN_UP: false },
	});
	expect(saved.status).toBe(200);
	const fresh = await (
		await request("GET")
	).json<{ revision: number; values: Record<string, unknown> }>();
	expect(fresh.revision).toBe(before.revision + 1);
	expect(fresh.values).toMatchObject({
		EMAIL_SENDER_NAME: "Updated sender",
		ENABLE_SIGN_UP: false,
	});
	const publicInfo = await request(
		"GET",
		undefined,
		true,
		"admin",
		"/internal/v1/melody-admin/info",
	);
	expect(publicInfo.status).toBe(200);
	expect(await publicInfo.json()).toMatchObject({
		configs: { EMAIL_SENDER_NAME: "Updated sender", ENABLE_SIGN_UP: false },
	});
	const registration = await request("POST", {}, false, "sdk", "/auth/register");
	expect(registration.status).toBe(403);
	expect(await registration.json()).toMatchObject({ error: { code: "registration_closed" } });
	const stale = await request("PUT", {
		revision: before.revision,
		values: { EMAIL_SENDER_NAME: "Stale edit" },
	});
	expect(stale.status).toBe(409);
	expect(
		(await (await request("GET")).json<{ values: Record<string, unknown> }>()).values
			.EMAIL_SENDER_NAME,
	).toBe("Updated sender");
	const db = Reflect.get(env, "DB") as D1Database;
	expect(
		await db.prepare("SELECT COUNT(*) AS count FROM identity_configuration_history").first("count"),
	).toBe(1);
});

test("settings report which provider secrets the deployment holds without revealing them", async () => {
	const deployment = {
		providerSecrets: { github: true, apple: false },
	};
	const read = await (await request("GET")).text();
	expect(read).not.toContain("runtime-github-client-secret");
	expect(JSON.parse(read)).toMatchObject({ deployment });
	const saved = await request("PUT", { revision: 0, values: { ENABLE_SIGN_UP: true } });
	expect(await saved.json()).toMatchObject({ deployment });
});

test("a configuration saved before banners, Facebook, Discord, SMS and organizations were removed keeps working", async () => {
	await database
		.prepare(
			"INSERT INTO identity_configuration (realm,revision,values_json,operation_id,updated_at) VALUES (?,?,?,?,?)",
		)
		.bind(
			"test:local",
			3,
			JSON.stringify({
				EMAIL_SENDER_NAME: "Saved sender",
				ENABLE_APP_BANNER: true,
				FACEBOOK_AUTH_CLIENT_ID: "facebook-id",
				DISCORD_AUTH_CLIENT_ID: "discord-id",
				SMS_MFA_IS_REQUIRED: true,
				SMS_MFA_MESSAGE_THRESHOLD: 5,
				ENABLE_SMS_LOG: true,
				ENABLE_ORG: true,
				BLOCKED_POLICIES: ["change_org", "change_email"],
				ENFORCE_ONE_MFA_ENROLLMENT: ["sms", "otp"],
			}),
			crypto.randomUUID(),
			"2026-11-01T00:00:00.000Z",
		)
		.run();
	const read = await request("GET");
	expect(read.status).toBe(200);
	const settings = await read.json<{ revision: number; values: Record<string, unknown> }>();
	expect(settings.values).toMatchObject({
		EMAIL_SENDER_NAME: "Saved sender",
		ENFORCE_ONE_MFA_ENROLLMENT: ["otp"],
		BLOCKED_POLICIES: ["change_email"],
	});
	for (const retired of [
		"ENABLE_APP_BANNER",
		"FACEBOOK_AUTH_CLIENT_ID",
		"DISCORD_AUTH_CLIENT_ID",
		"SMS_MFA_IS_REQUIRED",
		"SMS_MFA_MESSAGE_THRESHOLD",
		"ENABLE_SMS_LOG",
		"ENABLE_ORG",
	])
		expect(settings.values).not.toHaveProperty(retired);
	const saved = await request("PUT", {
		revision: settings.revision,
		values: { EMAIL_SENDER_NAME: "Updated sender" },
	});
	expect(saved.status).toBe(200);
	const stored = await database
		.prepare("SELECT values_json FROM identity_configuration WHERE realm=?")
		.bind("test:local")
		.first<{ values_json: string }>();
	expect(JSON.parse(stored?.values_json ?? "{}")).not.toHaveProperty("FACEBOOK_AUTH_CLIENT_ID");
	expect((await request("PUT", { revision: 4, values: { ENABLE_APP_BANNER: true } })).status).toBe(
		422,
	);
});

test("settings reject unauthorized callers, secret fields and invalid values without writing", async () => {
	expect((await SELF.fetch(`https://identity.test${path}`)).status).toBe(401);
	expect(
		(await request("PUT", { revision: 0, values: { ENABLE_SIGN_UP: false } }, false)).status,
	).toBe(403);
	expect((await request("GET", undefined, true, "sdk")).status).toBe(403);
	for (const values of [
		{ MELODY_AUTH_SECRETS: "must-not-be-accepted" },
		{ AUTH_SERVER_URL: "https://attacker.test" },
		{ ENABLE_SIGN_UP: "false" },
		{ SPA_ACCESS_TOKEN_EXPIRES_IN: -1 },
		{ COMPANY_LOGO_URL: "data:text/html,invalid" },
		{ EMAIL_SENDER_NAME: "Sender\r\nInvalid header" },
		{ SUPPORTED_LOCALES: [] },
	])
		expect((await request("PUT", { revision: 0, values })).status).toBe(422);
	const current = await (await request("GET")).json<{ revision: number }>();
	expect(current.revision).toBe(0);
});

test("required verification cannot be bypassed by the direct password API", async () => {
	expect(
		(await request("PUT", { revision: 0, values: { OTP_MFA_IS_REQUIRED: true } })).status,
	).toBe(200);
	const response = await request("POST", {}, false, "sdk", "/auth/signin/password");
	expect(response.status).toBe(403);
	expect(await response.json()).toMatchObject({ error: { code: "interactive_sign_in_required" } });
});
