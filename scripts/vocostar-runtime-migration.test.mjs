import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const legacy = source(
	"../workers/custom/vocostar/runtime-tests/migrations/0000_legacy_fixture.sql",
);
const jobs = source("../workers/custom/vocostar/migrations/0001_opengrow_custom_jobs.sql");
const migration = source("../workers/custom/vocostar/migrations/0005_runtime_identity_bridge.sql");

function database(userCount = 2, jobsPerUser = 2) {
	const db = new DatabaseSync(":memory:");
	db.exec(legacy);
	db.exec(jobs);
	const user = db.prepare("INSERT INTO users(id, credits) VALUES(?, 50)");
	const job = db.prepare(
		"INSERT INTO opengrow_custom_jobs(id, idempotency_key, request_hash, project_ref, capability, user_id, entity_id, requested_at) VALUES(?, ?, 'hash', ?, 'vocostar.media.convert', ?, ?, '2026-09-08')",
	);
	db.exec("BEGIN");
	for (let index = 0; index < userCount; index++) {
		user.run(`user-${index}`);
		for (let offset = 0; offset < jobsPerUser; offset++) {
			const id = `job-${index}-${offset}`;
			job.run(id, id, "1-prod", `user-${index}`, id);
		}
	}
	job.run("ambiguous", "ambiguous", "2-prod", "user-0", "ambiguous");
	db.exec("COMMIT");
	return db;
}

function verify(db, userCount, jobsPerUser) {
	assert.equal(
		db.prepare("SELECT COUNT(*) count FROM vocostar_runtime_identities").get().count,
		userCount - 1,
	);
	assert.equal(
		db.prepare("SELECT COUNT(*) count FROM opengrow_custom_jobs").get().count,
		userCount * jobsPerUser + 1,
	);
	assert.equal(db.prepare("SELECT SUM(credits) credits FROM users").get().credits, userCount * 50);
	assert.equal(
		db
			.prepare(
				"SELECT legacy_user_id FROM vocostar_runtime_identities WHERE legacy_user_id = 'user-0'",
			)
			.get(),
		undefined,
	);
	assert.throws(
		() => db.exec("UPDATE opengrow_custom_jobs SET project_ref='2-prod' WHERE user_id='user-1'"),
		/runtime_identity_project_conflict/u,
	);
}

test("runtime identity upgrade preserves 20,001 existing jobs and skips ambiguous owners", () => {
	const db = database(1000, 20);
	try {
		db.exec(migration);
		verify(db, 1000, 20);
	} finally {
		db.close();
	}
});

test("runtime identity migration can restart after each completed DDL statement", () => {
	const statements = migration.trim().split(/\n\s*\n/u);
	for (let completed = 0; completed <= statements.length; completed++) {
		const db = database();
		try {
			for (const statement of statements.slice(0, completed)) db.exec(statement);
			db.exec(migration);
			db.exec(migration);
			verify(db, 2, 2);
		} finally {
			db.close();
		}
	}
});
