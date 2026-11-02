import { Kysely, PostgresDialect } from "kysely";
import { describe, expect, it } from "vitest";

import { detectDialect } from "../../../../../../packages/core/src/database/dialect-helpers.js";
import { FailFastPostgresDialect } from "../../../../../../packages/core/src/database/pg-migration-lock.js";

describe("FailFastPostgresDialect", () => {
	it("preserves the stock adapter's capability flags", () => {
		const stock = new PostgresDialect({ pool: {} as never }).createAdapter();
		const adapter = new FailFastPostgresDialect({ pool: {} as never }).createAdapter();

		expect(adapter.supportsTransactionalDdl).toBe(true);
		expect(adapter.supportsTransactionalDdl).toBe(stock.supportsTransactionalDdl);
		expect(adapter.supportsReturning).toBe(stock.supportsReturning);
		expect(adapter.supportsCreateIfNotExists).toBe(stock.supportsCreateIfNotExists ?? false);
		expect(adapter.supportsMultipleConnections).toBe(stock.supportsMultipleConnections ?? true);
	});

	it("detects Postgres when a bundler renames the adapter class", () => {
		const db = new Kysely({
			dialect: new FailFastPostgresDialect({ pool: {} as never }),
		});
		const constructor = db.getExecutor().adapter.constructor;
		const originalName = Object.getOwnPropertyDescriptor(constructor, "name");

		try {
			Object.defineProperty(constructor, "name", { value: "a", configurable: true });
			expect(detectDialect(db)).toBe("postgres");
		} finally {
			if (originalName) Object.defineProperty(constructor, "name", originalName);
		}
	});

	it("remains a PostgresDialect for the public dialect type", () => {
		expect(new FailFastPostgresDialect({ pool: {} as never })).toBeInstanceOf(PostgresDialect);
	});
});
