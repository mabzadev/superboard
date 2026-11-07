import { sql, type Kysely } from "kysely";
import { afterEach, beforeEach, expect, it } from "vitest";

import { createDatabase } from "../../../../../../packages/core/src/database/connection.js";
import { up as createPluginSettingVersions } from "../../../../../../packages/core/src/database/migrations/074_plugin_setting_versions.js";
import {
	createMigrator,
	getMigrationStatus,
	runMigrations,
} from "../../../../../../packages/core/src/database/migrations/runner.js";
import type { Database } from "../../../../../../packages/core/src/database/types.js";

let db: Kysely<Database>;

beforeEach(() => {
	db = createDatabase({ url: ":memory:" });
});

afterEach(async () => {
	await db.destroy();
});

it("upgrades a database that recorded SuperBoard's 074 migration before EmDash's later 074 to 091", async () => {
	const { error } = await createMigrator(db).migrateTo("073_media_focal_point");
	expect(error).toBeUndefined();
	await createPluginSettingVersions(db);
	await sql`INSERT INTO _emdash_migrations (name, timestamp) VALUES (${"074_plugin_setting_versions"}, ${new Date().toISOString()})`.execute(
		db,
	);

	await runMigrations(db);

	const status = await getMigrationStatus(db);
	expect(status.pending).toEqual([]);
	expect(status.applied).toContain("074_content_deleted_scheduled_index");
	expect(status.applied).toContain("091_redirect_artifacts");
});
