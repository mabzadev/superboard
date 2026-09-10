import { env, SELF } from "cloudflare:test";
import { expect, test } from "vitest";

const target = env.SUPERBOARD_ENVIRONMENT;

test("old application versions can still write a strong-authentication receipt", async () => {
	await env.DB.prepare(
		"INSERT INTO superboard_operator_reauthentication_receipts(receipt_id,operator_id,instance_id,action,candidate_id,reauthenticated_at,expires_at,receipt_checksum,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
	)
		.bind(
			"old-writer",
			"operator-1",
			env.SUPERBOARD_INSTANCE_ID,
			"front_release.approve",
			"old-candidate",
			"2026-09-10T00:00:00.000Z",
			"2026-09-10T00:05:00.000Z",
			"sha256:" + "a".repeat(64),
			"2026-09-10T00:00:00.000Z",
		)
		.run();
	expect(
		await env.DB.prepare(
			"SELECT authorization_method,operation_id FROM superboard_operator_reauthentication_receipts WHERE receipt_id='old-writer'",
		).first(),
	).toEqual({ authorization_method: "strong_reauthentication", operation_id: null });
});
const headers = {
	Origin: "https://site.example",
	"X-EmDash-Request": "1",
	"X-Parity-Operator": "1",
};
const packages = [
	"supbrd-plug-identity",
	"supbrd-plug-data",
	"supbrd-plug-commerce",
	"supbrd-plug-communication",
	"supbrd-plug-journeys",
	"supbrd-plug-support",
	"supbrd-plug-analytics",
];

test("Communication can be activated and configured before entering provider credentials", async () => {
	const plugin = "supbrd-plug-communication";
	const response = await SELF.fetch(actionUrl(plugin, "enable"), { method: "POST", headers });
	expect(response.status, await response.clone().text()).toBe(201);
	expect(await enabled(plugin)).toBe(1);
	const page = await SELF.fetch(`https://site.example/_emdash/api/plugins/${plugin}/admin`, {
		method: "POST",
		headers: { ...headers, "Content-Type": "application/json" },
		body: "{}",
	});
	expect(page.status, await page.clone().text()).toBe(200);
	const disabled = await SELF.fetch(actionUrl(plugin, "disable"), { method: "POST", headers });
	expect(disabled.status, await disabled.clone().text()).toBe(201);
	expect(await enabled(plugin)).toBe(0);
});

test("Communication still requires its installed database schema", async () => {
	const emailDb = Reflect.get(env, "HEALTH_EMAIL_DB") as D1Database;
	const migration = await emailDb
		.prepare("SELECT id,name,applied_at FROM d1_migrations ORDER BY name DESC LIMIT 1")
		.first<{ id: number; name: string; applied_at: string }>();
	if (!migration) throw new Error("Email test migrations are missing");
	await emailDb.prepare("DELETE FROM d1_migrations WHERE id=?").bind(migration.id).run();
	try {
		const response = await SELF.fetch(actionUrl("supbrd-plug-communication", "enable"), {
			method: "POST",
			headers,
		});
		expect(response.status).toBe(500);
		expect(await enabled("supbrd-plug-communication")).not.toBe(1);
	} finally {
		await emailDb
			.prepare("INSERT INTO d1_migrations(id,name,applied_at) VALUES (?,?,?)")
			.bind(migration.id, migration.name, migration.applied_at)
			.run();
	}
});

test("an older sign-in does not prevent disabling an already active plugin", async () => {
	const plugin = "supbrd-plug-data";
	const setup = await SELF.fetch(actionUrl(plugin, "enable"), {
		method: "POST",
		headers: { ...headers, "X-Parity-Reauthenticated": "1" },
	});
	expect([200, 201], await setup.clone().text()).toContain(setup.status);
	expect(await enabled(plugin)).toBe(1);
	const response = await SELF.fetch(actionUrl(plugin, "disable"), {
		method: "POST",
		headers: { ...headers, "X-Parity-Reauthenticated": "expired" },
	});
	expect(response.status, await response.clone().text()).toBe(201);
	expect(await enabled(plugin)).toBe(0);
});

test("the mandatory core cannot be disabled", async () => {
	const response = await SELF.fetch(actionUrl("supbrd-core", "disable"), {
		method: "POST",
		headers,
	});
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({ error: { code: "CORE_COMPONENT_REQUIRED" } });
});

function actionUrl(plugin: string, action: "enable" | "disable") {
	return `https://site.example/_emdash/api/superboard/plugins/${plugin}/${action}`;
}

async function enabled(plugin: string) {
	const row = await env.DB.prepare(
		"SELECT enabled FROM superboard_plugin_packages WHERE instance_id=? AND target=? AND package_id=?",
	)
		.bind(env.SUPERBOARD_INSTANCE_ID, target, plugin)
		.first<{ enabled: number }>();
	return row?.enabled;
}

async function otherPackages(plugin: string) {
	const rows = await env.DB.prepare(
		"SELECT package_id,enabled FROM superboard_plugin_packages WHERE instance_id=? AND target=? AND package_id<>? ORDER BY package_id",
	)
		.bind(env.SUPERBOARD_INSTANCE_ID, target, plugin)
		.all();
	return rows.results;
}

test.each(packages)(
	"signed-in admin enables, disables and reenables %s without another login",
	async (plugin) => {
		const setup = await SELF.fetch(actionUrl(plugin, "disable"), {
			method: "POST",
			headers: { ...headers, "X-Parity-Reauthenticated": "1" },
		});
		expect([200, 201], await setup.clone().text()).toContain(setup.status);
		expect(await enabled(plugin)).toBe(0);
		const url = actionUrl(plugin, "enable");
		const requestHeaders = { ...headers, "Idempotency-Key": `activation-${target}-${plugin}` };
		const activated = await SELF.fetch(url, { method: "POST", headers: requestHeaders });
		expect(activated.status, await activated.clone().text()).toBe(201);
		const result = await activated.json();
		expect(result).toMatchObject({ status: "active", package_id: plugin });
		const authorization = await env.DB.prepare(
			"SELECT authorization_method,operation_id FROM superboard_operator_reauthentication_receipts WHERE authorization_method='operator_session' ORDER BY created_at DESC LIMIT 1",
		).first();
		expect(authorization).toMatchObject({
			authorization_method: "operator_session",
			operation_id: expect.any(String),
		});
		expect(await enabled(plugin)).toBe(1);
		const replay = await SELF.fetch(url, { method: "POST", headers: requestHeaders });
		expect(replay.status).toBe(201);
		expect(await replay.json()).toEqual(result);

		const before = await otherPackages(plugin);
		const setting = `plugin:${plugin}:settings:regression-retained-value`;
		await env.DB.prepare("INSERT OR REPLACE INTO options(name,value) VALUES (?,?)")
			.bind(setting, JSON.stringify({ retained: true }))
			.run();
		const disabled = await SELF.fetch(actionUrl(plugin, "disable"), { method: "POST", headers });
		expect(disabled.status, await disabled.clone().text()).toBe(201);
		expect(await disabled.json()).toMatchObject({ status: "disabled" });
		expect(await enabled(plugin)).toBe(0);
		expect(await otherPackages(plugin)).toEqual(before);
		expect(
			await env.DB.prepare("SELECT value FROM options WHERE name=?").bind(setting).first("value"),
		).toBe(JSON.stringify({ retained: true }));
		const reenabled = await SELF.fetch(url, { method: "POST", headers });
		expect(reenabled.status, await reenabled.clone().text()).toBe(201);
		expect(await reenabled.json()).toMatchObject({ status: "active" });
		expect(await enabled(plugin)).toBe(1);
		expect(await otherPackages(plugin)).toEqual(before);
		expect(
			await env.DB.prepare("SELECT value FROM options WHERE name=?").bind(setting).first("value"),
		).toBe(JSON.stringify({ retained: true }));
	},
);

test.each(["enable", "disable"] as const)(
	"%s keeps authentication, permissions and CSRF controls",
	async (action) => {
		const url = actionUrl("supbrd-plug-data", action);
		for (const [requestHeaders, status] of [
			[{}, 401],
			[{ ...headers, "X-Parity-Role": "editor" }, 403],
			[{ ...headers, Origin: "https://foreign.example" }, 403],
			[{ Origin: headers.Origin, "X-Parity-Operator": "1" }, 403],
		] as const) {
			const before = await enabled("supbrd-plug-data");
			const response = await SELF.fetch(url, { method: "POST", headers: requestHeaders });
			expect(response.status, await response.clone().text()).toBe(status);
			expect(await enabled("supbrd-plug-data")).toBe(before);
		}
	},
);
