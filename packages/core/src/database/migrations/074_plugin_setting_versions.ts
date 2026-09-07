import type { Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable("_emdash_plugin_setting_versions")
		.ifNotExists()
		.addColumn("id", "text", (column) => column.primaryKey())
		.addColumn("plugin_id", "text", (column) => column.notNull())
		.addColumn("values_json", "text", (column) => column.notNull())
		.addColumn("secrets_set_json", "text", (column) => column.notNull())
		.addColumn("changed_keys_json", "text", (column) => column.notNull())
		.addColumn("created_at", "text", (column) => column.notNull())
		.execute();
	await db.schema
		.createIndex("idx_plugin_setting_versions_plugin_id")
		.ifNotExists()
		.on("_emdash_plugin_setting_versions")
		.columns(["plugin_id", "id"])
		.execute();
}

export async function down(_db: Kysely<unknown>): Promise<void> {}
