import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { recoverStoppedLocalPluginTasks } from "../../../scripts/local/plugin-task-recovery.mjs";

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), "plugin-task-recovery-"));
	const db = new DatabaseSync(join(directory, "site.sqlite"));
	db.exec(
		"CREATE TABLE superboard_plugin_task_leases (instance_id TEXT, target TEXT, state TEXT, finished_at TEXT)",
	);
	db.exec(
		"INSERT INTO superboard_plugin_task_leases VALUES ('local-instance','local','running',NULL),('other-instance','local','running',NULL),('local-instance','production','running',NULL)",
	);
	t.after(async () => {
		db.close();
		await rm(directory, { recursive: true, force: true });
	});
	return { directory, db };
}

test("a stopped local fleet releases orphaned tasks without changing other instances or production", async (t) => {
	const { directory, db } = await fixture(t);
	await recoverStoppedLocalPluginTasks({ directory, instanceId: "local-instance", ports: [0] });
	assert.deepEqual(
		db
			.prepare("SELECT instance_id,target,state FROM superboard_plugin_task_leases ORDER BY rowid")
			.all()
			.map((row) => ({ ...row })),
		[
			{ instance_id: "local-instance", target: "local", state: "finished" },
			{ instance_id: "other-instance", target: "local", state: "running" },
			{ instance_id: "local-instance", target: "production", state: "running" },
		],
	);
});

test("a listening local service prevents recovery even when tasks are old", async (t) => {
	const { directory, db } = await fixture(t);
	const server = createServer();
	await new Promise((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	t.after(() => server.close());
	await assert.rejects(
		recoverStoppedLocalPluginTasks({
			directory,
			instanceId: "local-instance",
			ports: [0, server.address().port],
		}),
		/LOCAL_RUNTIME_STILL_RUNNING/u,
	);
	assert.equal(
		db
			.prepare(
				"SELECT COUNT(*) AS count FROM superboard_plugin_task_leases WHERE state = 'running'",
			)
			.get().count,
		3,
	);
});
