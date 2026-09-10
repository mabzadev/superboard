import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
	applyCanonicalNamespaceUpgrade,
	planCanonicalNamespaceUpgrade,
} from "../../../scripts/database/canonical-namespace-upgrade.mjs";

test("canonical migration names preserve applied history and billing data across retries", (t) => {
	const db = new DatabaseSync(":memory:");
	t.after(() => db.close());
	db.exec(`CREATE TABLE d1_migrations (name TEXT UNIQUE);
		INSERT INTO d1_migrations VALUES ('0010_previous_identity.sql'), ('0011_previous_billing_audit.sql');
		CREATE TABLE billing_mirror_comparisons (id INTEGER PRIMARY KEY, previous_active_entitlements INTEGER, revenuecat_active_entitlements INTEGER);
		INSERT INTO billing_mirror_comparisons VALUES (1, 7, 8);`);
	assert.equal(planCanonicalNamespaceUpgrade(db).length, 3);
	assert.equal(
		db.prepare("SELECT previous_active_entitlements AS count FROM billing_mirror_comparisons").get()
			.count,
		7,
	);
	applyCanonicalNamespaceUpgrade(db);
	assert.equal(
		db
			.prepare("SELECT superboard_active_entitlements AS count FROM billing_mirror_comparisons")
			.get().count,
		7,
	);
	assert.equal(
		db
			.prepare("SELECT revenuecat_active_entitlements AS count FROM billing_mirror_comparisons")
			.get().count,
		8,
	);
	assert.deepEqual(
		db
			.prepare("SELECT name FROM d1_migrations ORDER BY name")
			.all()
			.map(({ name }) => name),
		["0010_superboard_identity.sql", "0011_superboard_billing_audit.sql"],
	);
	assert.deepEqual(applyCanonicalNamespaceUpgrade(db), []);
});

test("ambiguous migration history leaves the database unchanged", (t) => {
	const db = new DatabaseSync(":memory:");
	t.after(() => db.close());
	db.exec(
		"CREATE TABLE d1_migrations (name TEXT UNIQUE); INSERT INTO d1_migrations VALUES ('0010_previous_identity.sql'), ('0011_previous_billing_audit.sql'), ('0011_another_billing_audit.sql');",
	);
	assert.throws(() => applyCanonicalNamespaceUpgrade(db), /Ambiguous migration history/u);
	assert.ok(
		db.prepare("SELECT name FROM d1_migrations WHERE name = '0010_previous_identity.sql'").get(),
	);
});

test("fresh databases require no migration-history rewrite", (t) => {
	const db = new DatabaseSync(":memory:");
	t.after(() => db.close());
	assert.deepEqual(applyCanonicalNamespaceUpgrade(db), []);
});
