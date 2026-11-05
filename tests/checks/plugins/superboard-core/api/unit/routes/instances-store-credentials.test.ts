import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import { Hono } from "hono";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import {
	decryptCredential,
	encryptCredential,
} from "../../../../../../../packages/plugins/superboard-core/api/src/lib/secrets";
import instances from "../../../../../../../packages/plugins/superboard-core/api/src/routes/instances";
import type { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types";
import { sqliteD1 } from "../../helpers/sqlite-d1.js";

const BRIDGE_TOKEN = "store-credentials-bridge-token";
const API_KEYRING = {
	STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ "api-v1": "api-test-key-material" }),
	STORE_CREDENTIALS_ACTIVE_KEY_VERSION: "api-v1",
};
const BILLING_KEYRING = {
	STORE_CREDENTIALS_ENCRYPTION_KEYS: JSON.stringify({ "billing-v1": "billing-test-key-material" }),
	STORE_CREDENTIALS_ACTIVE_KEY_VERSION: "billing-v1",
	CREDENTIAL_KEY_SCOPE: "billing",
};

function fakePrivateKey(marker: string) {
	return [
		"-----BEGIN PRIVATE KEY-----",
		btoa(`fake-${marker}-key`),
		"-----END PRIVATE KEY-----",
	].join("\n");
}

function fakeServiceAccount(marker: string) {
	return JSON.stringify({
		type: "service_account",
		project_id: "fake-play-project",
		private_key_id: `fake-${marker}-id`,
		private_key: fakePrivateKey(marker),
		client_email: "billing@fake-play-project.iam.gserviceaccount.com",
	});
}

function database() {
	const sqlite = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
	onTestFinished(() => sqlite.close());
	const migrations = new URL(
		"../../../../../../../packages/plugins/superboard-core/api/migrations/",
		import.meta.url,
	);
	for (const file of readdirSync(migrations)
		.filter((name) => name.endsWith(".sql"))
		.sort((a, b) => a.localeCompare(b)))
		sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
	sqlite.exec("INSERT INTO instances(id, api_key, uri_scheme) VALUES (10, 'store-key', 'test')");
	return { sqlite, db: sqliteD1(sqlite) as unknown as D1Database };
}

function billingWorker(mode: "available" | "unavailable") {
	return {
		fetch: vi.fn(async (request: Request) => {
			if (mode === "unavailable")
				return Response.json(
					{ code: "billing_unavailable", message: "Billing is restarting" },
					{ status: 503 },
				);
			expect(new URL(request.url).pathname).toBe("/internal/v1/credentials/encrypt");
			const body: unknown = await request.json();
			const credential =
				body && typeof body === "object" && "credential" in body ? String(body.credential) : "";
			return Response.json({
				data: { ciphertext: await encryptCredential(BILLING_KEYRING, credential) },
			});
		}),
	};
}

function environment(db: D1Database, billing?: ReturnType<typeof billingWorker>) {
	return {
		DB: db,
		SUPERBOARD_TARGET: "test",
		SITE_OPERATOR_BRIDGE_TOKEN: BRIDGE_TOKEN,
		...API_KEYRING,
		...(billing ? { BILLING: billing } : {}),
	} as unknown as Env;
}

async function put(env: Env, path: string, body: FormData | Record<string, unknown>) {
	const url = `https://api.internal/api/v1/instances/10/configurations/${path}`;
	const unsigned =
		body instanceof FormData
			? new Request(url, { method: "PUT", body })
			: new Request(url, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
	const headers = await signSiteOperatorRequest(
		unsigned,
		{ operator_id: "operator-1", instance_id: "test", role: 50 },
		BRIDGE_TOKEN,
	);
	const signed = new Request(unsigned, { headers: new Headers(unsigned.headers) });
	headers.forEach((value, name) => signed.headers.set(name, value));
	const app = new Hono<{ Bindings: Env }>().route("/api/v1/instances", instances);
	return app.request(signed, undefined, env);
}

function appleKeyForm(marker: string) {
	const form = new FormData();
	form.set("file", new File([fakePrivateKey(marker)], "AuthKey_FAKE.p8"));
	form.set("key_id", "FAKEKEY123");
	form.set("issuer_id", "00000000-0000-0000-0000-000000000000");
	form.set("app_apple_id", "1234567890");
	form.set("bundle_id", "com.example.fake");
	form.set("team_id", "FAKETEAM12");
	return form;
}

function googleKeyForm(marker: string) {
	const form = new FormData();
	form.set("file", new File([fakeServiceAccount(marker)], "service-account.json"));
	return form;
}

function storedKey(sqlite: DatabaseSync, table: "ios_server_api_keys" | "android_server_api_keys") {
	return sqlite
		.prepare(`SELECT encrypted_key, billing_encrypted_key FROM ${table} WHERE instance_id = ?`)
		.get(10) as { encrypted_key: string; billing_encrypted_key: string | null } | undefined;
}

function consoleOutput() {
	const spies = (["log", "info", "warn", "error"] as const).map((method) =>
		vi.spyOn(console, method).mockImplementation(() => undefined),
	);
	return () => spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join("\n");
}

afterEach(() => vi.restoreAllMocks());

describe("store server credentials", () => {
	it("keeps the Billing copy of a saved App Store key readable by the Billing worker", async () => {
		const { sqlite, db } = database();
		const env = environment(db, billingWorker("available"));

		const response = await put(env, "ios/api_access_key", appleKeyForm("apple"));

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toContain("PRIVATE KEY");
		expect(text).not.toContain(btoa("fake-apple-key"));
		const row = storedKey(sqlite, "ios_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakePrivateKey("apple"),
		);
		await expect(decryptCredential(BILLING_KEYRING, row!.billing_encrypted_key!)).resolves.toBe(
			fakePrivateKey("apple"),
		);
	});

	it("keeps the Billing copy of a saved Google Play service account readable by the Billing worker", async () => {
		const { sqlite, db } = database();
		const env = environment(db, billingWorker("available"));
		await put(env, "android", { package_name: "com.example.fake", sha256s: ["AA:BB"] });

		const response = await put(env, "android/api_access_key", googleKeyForm("google"));

		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("PRIVATE KEY");
		const row = storedKey(sqlite, "android_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakeServiceAccount("google"),
		);
		await expect(decryptCredential(BILLING_KEYRING, row!.billing_encrypted_key!)).resolves.toBe(
			fakeServiceAccount("google"),
		);
	});

	it("keeps the current App Store key when the Billing copy of its replacement cannot be made", async () => {
		const { sqlite, db } = database();
		await put(
			environment(db, billingWorker("available")),
			"ios/api_access_key",
			appleKeyForm("old"),
		);
		const output = consoleOutput();

		const response = await put(
			environment(db, billingWorker("unavailable")),
			"ios/api_access_key",
			appleKeyForm("new"),
		);

		expect(response.status).toBe(503);
		const body = await response.text();
		expect(JSON.parse(body)).toMatchObject({ code: "billing_credential_copy_failed" });
		expect(body).not.toContain(btoa("fake-new-key"));
		expect(output()).not.toContain(btoa("fake-new-key"));
		const row = storedKey(sqlite, "ios_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakePrivateKey("old"),
		);
		await expect(decryptCredential(BILLING_KEYRING, row!.billing_encrypted_key!)).resolves.toBe(
			fakePrivateKey("old"),
		);
	});

	it("keeps the current Google Play service account when the Billing copy of its replacement cannot be made", async () => {
		const { sqlite, db } = database();
		const available = environment(db, billingWorker("available"));
		await put(available, "android", { package_name: "com.example.fake", sha256s: ["AA:BB"] });
		await put(available, "android/api_access_key", googleKeyForm("old"));
		const output = consoleOutput();

		const response = await put(
			environment(db, billingWorker("unavailable")),
			"android/api_access_key",
			googleKeyForm("new"),
		);

		expect(response.status).toBe(503);
		expect(output()).not.toContain(btoa("fake-new-key"));
		const row = storedKey(sqlite, "android_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakeServiceAccount("old"),
		);
	});

	it("keeps the current App Store key when its replacement cannot be stored", async () => {
		const { sqlite, db } = database();
		const env = environment(db, billingWorker("available"));
		await put(env, "ios/api_access_key", appleKeyForm("old"));
		sqlite.exec(
			"CREATE TRIGGER reject_apple_key BEFORE INSERT ON ios_server_api_keys BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END",
		);
		consoleOutput();

		const response = await put(env, "ios/api_access_key", appleKeyForm("new"));

		expect(response.ok).toBe(false);
		const row = storedKey(sqlite, "ios_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakePrivateKey("old"),
		);
	});

	it("keeps the current Google Play service account when its replacement cannot be stored", async () => {
		const { sqlite, db } = database();
		const env = environment(db, billingWorker("available"));
		await put(env, "android", { package_name: "com.example.fake", sha256s: ["AA:BB"] });
		await put(env, "android/api_access_key", googleKeyForm("old"));
		sqlite.exec(
			"CREATE TRIGGER reject_google_key BEFORE INSERT ON android_server_api_keys BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END",
		);
		consoleOutput();

		const response = await put(env, "android/api_access_key", googleKeyForm("new"));

		expect(response.ok).toBe(false);
		const row = storedKey(sqlite, "android_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakeServiceAccount("old"),
		);
	});

	it("stores only the API copy when no Billing worker is deployed", async () => {
		const { sqlite, db } = database();

		const response = await put(environment(db), "ios/api_access_key", appleKeyForm("apple"));

		expect(response.status).toBe(200);
		const row = storedKey(sqlite, "ios_server_api_keys");
		await expect(decryptCredential(API_KEYRING, row!.encrypted_key)).resolves.toBe(
			fakePrivateKey("apple"),
		);
		expect(row?.billing_encrypted_key).toBeNull();
	});
});
