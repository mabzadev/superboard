import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtime = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = runtime("miniflare");

for (const releaseAfter of [150, null])
	test(
		releaseAfter === null
			? "a persistent local database lock fails within a bounded time"
			: "a concurrent local database lock does not turn a successful read into an HTTP failure",
		async () => {
			const directory = await mkdtemp(join(tmpdir(), "superboard-d1-lock-"));
			const mf = new Miniflare(
				convertV4MiniflareOptions({
					modules: true,
					compatibilityDate: "2026-08-08",
					d1Databases: { DB: "shared-local-database" },
					resourcePersistencePath: directory,
					script: `export default { async fetch(request, env) {
			const data = await env.DB.prepare("SELECT value FROM probe WHERE id = 1").first();
			return Response.json(data);
		} };`,
				}),
			);
			let competing;
			let unlock;
			try {
				const db = await mf.getD1Database("DB");
				await db.exec(
					"CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe VALUES (1, 'retained')",
				);
				const files = await readdir(directory, { recursive: true });
				const database = files.find((file) => file.endsWith(".sqlite"));
				assert.ok(database);
				competing = new DatabaseSync(join(directory, database));
				competing.exec("BEGIN IMMEDIATE");
				if (releaseAfter !== null)
					unlock = setTimeout(() => {
						competing.exec("ROLLBACK");
					}, releaseAfter);
				const worker = await mf.getWorker();
				if (releaseAfter === null) {
					await assert.rejects(worker.fetch("http://local.test/"), /D1_ERROR/u);
					competing.exec("ROLLBACK");
				}
				const response = await worker.fetch("http://local.test/");
				assert.equal(response.status, 200, await response.clone().text());
				assert.deepEqual(await response.json(), { value: "retained" });
			} finally {
				clearTimeout(unlock);
				if (competing) {
					if (competing.isTransaction) competing.exec("ROLLBACK");
					competing.close();
				}
				await mf.dispose();
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
