import { randomUUID } from "node:crypto";

import { SqliteDialect } from "kysely";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeSqliteCompatDatabase as Database } from "../../../../../../packages/core/src/db/node-sqlite-compat.js";

vi.mock("virtual:emdash/seed", () => ({ seed: { version: "unsupported" }, userSeed: null }), {
	virtual: true,
});

import { OptionsRepository } from "../../../../../../packages/core/src/database/repositories/options.js";
import {
	EmDashRuntime,
	type RuntimeDependencies,
} from "../../../../../../packages/core/src/emdash-runtime.js";

describe("invalid runtime auto-seed", () => {
	let runtime: EmDashRuntime | undefined;

	afterEach(async () => {
		await runtime?.stopCron();
		runtime = undefined;
	});

	it("does not mark an invalid seed complete", async () => {
		runtime = await EmDashRuntime.create(createDeps());

		expect(await new OptionsRepository(runtime.db).get("emdash:seed_complete")).toBeNull();
		expect(await runtime.db.selectFrom("_emdash_collections").select("id").execute()).toEqual([]);
	});
});

function createDeps(): RuntimeDependencies {
	return {
		config: {
			database: {
				entrypoint: `invalid-auto-seed-${randomUUID()}`,
				config: {},
				type: "sqlite",
			},
		},
		plugins: [],
		createDialect: () => new SqliteDialect({ database: new Database(":memory:") }),
		createStorage: null,
		sandboxEnabled: false,
		sandboxedPluginEntries: [],
		createSandboxRunner: null,
	};
}
