import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Kysely, SqliteDialect } from "kysely";
import { afterEach, beforeEach, expect, test } from "vitest";

import { runMigrations } from "../../../../packages/core/src/database/migrations/runner.js";
import type { Database } from "../../../../packages/core/src/database/types.js";
import { openNodeSqliteDatabase } from "../../../../packages/core/src/db/node-sqlite-compat.js";

const migrations = new URL("../../../../apps/site/migrations/", import.meta.url);
const cleanup = "0060_remove_unused_plugin_settings.sql";
const unusedSettings: Array<[components: string[], fields: string[]]> = [
	[
		["superboard-content", "supbrd-plug-content"],
		["default_locale", "required_locales", "publishing_mode"],
	],
	[
		["superboard-files", "supbrd-plugmod-files"],
		["max_upload_bytes", "allowed_content_types", "signed_url_ttl_seconds"],
	],
	[
		["superboard-products", "supbrd-plug-products"],
		["default_currency", "store_environment", "catalog_sync_enabled"],
	],
	[
		["superboard-billing", "supbrd-plugmod-billing"],
		[
			"apple_issuer_id",
			"apple_key_id",
			"apple_private_key",
			"google_service_account_json",
			"stripe_secret_key",
			"webhook_signing_secret",
		],
	],
];
const removedOptions = unusedSettings.flatMap(([components, fields]) =>
	components.flatMap((component) => fields.map((field) => `plugin:${component}:settings:${field}`)),
);
const keptOptions = [
	"emdash:setup_complete",
	"plugin:superboard-billing:last_reconciliation",
	"plugin:superboard-files:settings:retention_days",
	"plugin:superboard-flows:settings:default_locale",
	"plugin:superboard-support:settings:allowed_content_types",
	"plugin:superboard-support:settings:business_name",
	"site_title",
];
const removedHistory = [
	"supbrd-plug-data",
	"supbrd-plug-commerce",
	"superboard-content",
	"superboard-files",
	"superboard-products",
	"superboard-billing",
	"supbrd-plug-content",
	"supbrd-plugmod-files",
	"supbrd-plug-products",
	"supbrd-plugmod-billing",
];
const keptHistory = ["supbrd-core", "supbrd-plug-journeys", "supbrd-plug-support"];

let directory: string;
let database: DatabaseSync;
let emdash: Kysely<Database>;

function applySiteMigration(name: string) {
	database.exec("BEGIN");
	database.exec(readFileSync(new URL(name, migrations), "utf8"));
	database.exec("COMMIT");
}

function storedOptions() {
	return database
		.prepare("SELECT name FROM options ORDER BY name")
		.all()
		.map(({ name }) => (typeof name === "string" ? name : ""));
}

function storedHistory() {
	return database
		.prepare("SELECT plugin_id FROM _emdash_plugin_setting_versions ORDER BY plugin_id")
		.all()
		.map(({ plugin_id: pluginId }) => pluginId);
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "superboard-site-settings-"));
	const path = join(directory, "site.sqlite");
	database = new DatabaseSync(path);
	database.exec("PRAGMA synchronous = OFF");
	const connection = openNodeSqliteDatabase(path);
	connection.prepare("PRAGMA synchronous = OFF").run([]);
	emdash = new Kysely<Database>({ dialect: new SqliteDialect({ database: connection }) });
});

afterEach(async () => {
	await emdash.destroy();
	database.close();
	rmSync(directory, { recursive: true, force: true });
});

test("removes the stored values and history of the unused Data and Monetization settings only, on every run", async () => {
	await runMigrations(emdash);
	const kept = [...storedOptions(), ...keptOptions].toSorted();
	const option = database.prepare("INSERT INTO options (name, value) VALUES (?, ?)");
	for (const name of [...removedOptions, ...keptOptions]) option.run(name, '"stored"');
	const version = database.prepare(
		"INSERT INTO _emdash_plugin_setting_versions (id, plugin_id, values_json, secrets_set_json, changed_keys_json, created_at) VALUES (?, ?, '{}', '{}', '[]', '2026-11-01T00:00:00.000Z')",
	);
	for (const pluginId of [...removedHistory, ...keptHistory])
		version.run(`${pluginId}-1`, pluginId);

	applySiteMigration(cleanup);
	expect(storedOptions()).toEqual(kept);
	expect(storedHistory()).toEqual(keptHistory);

	applySiteMigration(cleanup);
	expect(storedOptions()).toEqual(kept);
	expect(storedHistory()).toEqual(keptHistory);
});

test("runs on a new instance before EmDash creates its tables, which EmDash then reuses", async () => {
	for (const name of readdirSync(migrations)
		.filter((file) => file.endsWith(".sql") && file <= cleanup)
		.toSorted())
		applySiteMigration(name);
	expect(storedOptions()).toEqual([]);

	await runMigrations(emdash);
	await emdash.insertInto("options").values({ name: "site_title", value: '"Site"' }).execute();
	await emdash
		.insertInto("_emdash_plugin_setting_versions")
		.values({
			id: "version-1",
			plugin_id: "supbrd-plug-support",
			values_json: "{}",
			secrets_set_json: "{}",
			changed_keys_json: "[]",
			created_at: "2026-11-01T00:00:00.000Z",
		})
		.execute();
	expect(
		await emdash
			.selectFrom("options")
			.select("value")
			.where("name", "=", "site_title")
			.executeTakeFirst(),
	).toEqual({ value: '"Site"' });
	expect(storedHistory()).toEqual(["supbrd-plug-support"]);
	expect(
		database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?")
			.get("idx_plugin_setting_versions_plugin_id"),
	).toBeDefined();
});
