import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { afterEach, beforeEach, expect, it } from "vitest";

import projects from "../../../../../../../packages/plugins/superboard-core/api/src/routes/projects.js";
import type { Env } from "../../../../../../../packages/plugins/superboard-core/api/src/types.js";

let sqlite: DatabaseSync;
let environment: Env;

beforeEach(() => {
	sqlite = new DatabaseSync(":memory:");
	sqlite.exec(`
		CREATE TABLE projects (id INTEGER PRIMARY KEY,instance_id INTEGER,is_test INTEGER,name TEXT,identifier TEXT);
		INSERT INTO projects VALUES (1,10,1,'Test','test_10'),(2,11,1,'Other','test_11');
		CREATE TABLE notifications (id INTEGER PRIMARY KEY,project_id INTEGER,title TEXT,subtitle TEXT,html TEXT,send_push INTEGER,auto_display INTEGER,archived INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT DEFAULT (datetime('now')));
		CREATE TABLE notification_targets (id INTEGER PRIMARY KEY,notification_id INTEGER,existing_users INTEGER,new_users INTEGER,platforms TEXT);
		CREATE TABLE notification_messages (id INTEGER PRIMARY KEY,notification_id INTEGER,visitor_id INTEGER,device_id INTEGER,read INTEGER);
		CREATE TABLE visitors (id INTEGER PRIMARY KEY,project_id INTEGER,device_id INTEGER);
		CREATE TABLE devices (id INTEGER PRIMARY KEY,platform TEXT,push_token TEXT);
		CREATE TABLE rpush_notifications (id INTEGER PRIMARY KEY,data TEXT,delivered INTEGER,failed INTEGER);
		INSERT INTO devices VALUES (1,'android',NULL),(2,'ios',NULL);
		INSERT INTO visitors VALUES (1,1,1),(2,1,2);
	`);
	const migration = readFileSync(
		new URL(
			"../../../../../../../packages/plugins/superboard-core/api/migrations/0069_notification_drafts.sql",
			import.meta.url,
		),
		"utf8",
	);
	sqlite.exec(migration);
	sqlite.exec(migration);
	class Statement {
		values: SQLInputValue[] = [];
		constructor(readonly query: string) {}
		bind(...values: SQLInputValue[]) {
			this.values = values;
			return this;
		}
		async first() {
			return sqlite.prepare(this.query).get(...this.values) ?? null;
		}
		async all() {
			return { results: sqlite.prepare(this.query).all(...this.values) };
		}
		async run() {
			return { meta: sqlite.prepare(this.query).run(...this.values) };
		}
	}
	environment = {
		DB: {
			prepare: (query: string) => new Statement(query),
			batch: async (statements: Statement[]) => {
				sqlite.exec("BEGIN");
				try {
					const results = [];
					for (const statement of statements) results.push(await statement.run());
					sqlite.exec("COMMIT");
					return results;
				} catch (error) {
					sqlite.exec("ROLLBACK");
					throw error;
				}
			},
		},
	} as unknown as Env;
});
afterEach(() => sqlite.close());

async function request(path: string, method = "GET", body?: unknown, project = "10-test") {
	return projects.request(
		`/${project}/notifications${path}`,
		{
			method,
			headers: { "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
		environment,
	);
}
async function createDraft() {
	const response = await request("", "POST", {
		title: "New message",
		draft: true,
		existing_users: true,
		new_users: false,
		platforms: ["android", "ios"],
	});
	expect(response.status).toBe(201);
	return (await response.json()) as { id: string; draft: boolean };
}

it("creates a durable draft without exposing a message to devices or queuing a push", async () => {
	const draft = await createDraft();
	expect(draft.draft).toBe(true);
	expect(sqlite.prepare("SELECT COUNT(*) AS total FROM notification_messages").get()?.total).toBe(
		0,
	);
	expect(sqlite.prepare("SELECT COUNT(*) AS total FROM rpush_notifications").get()?.total).toBe(0);
	expect(
		sqlite.prepare("SELECT COUNT(*) AS total FROM notifications WHERE archived=0").get()?.total,
	).toBe(0);
	const hidden = await request("/search", "POST", {});
	expect(await hidden.json()).toMatchObject({ total_entries: 0 });
	const listed = await request("/search", "POST", { include_drafts: true });
	expect(await listed.json()).toMatchObject({
		total_entries: 1,
		data: [{ id: draft.id, draft: true }],
	});
});

it("persists type, content and platform choices, publishing only to the chosen platform", async () => {
	const draft = await createDraft();
	const settings = {
		title: "Android message",
		subtitle: "Hello",
		html: "<p>Hello</p>",
		send_push: false,
		auto_display: true,
		platforms: ["android"],
		existing_users: true,
		new_users: false,
	};
	expect((await request(`/${draft.id}`, "PATCH", settings)).status).toBe(200);
	expect(await (await request(`/${draft.id}`)).json()).toMatchObject({
		draft: true,
		title: settings.title,
		target: { platforms: ["android"] },
		statistics: { recipients: 0 },
	});
	expect((await request(`/${draft.id}/publish`, "POST", {})).status).toBe(200);
	expect(await (await request(`/${draft.id}`)).json()).toMatchObject({
		draft: false,
		archived: false,
		statistics: { recipients: 1, views: 0 },
	});
	expect((await request(`/${draft.id}`, "PATCH", settings)).status).toBe(409);
	expect(sqlite.prepare("SELECT device_id FROM notification_messages").all()).toEqual([
		{ device_id: 1 },
	]);
});

it("rejects incomplete publication and access through a different project", async () => {
	const draft = await createDraft();
	expect((await request(`/${draft.id}/publish`, "POST", {})).status).toBe(422);
	expect((await request(`/${draft.id}`, "GET", undefined, "11-test")).status).toBe(404);
	expect((await request(`/${draft.id}/publish`, "POST", {}, "11-test")).status).toBe(404);
	expect((await request(`/${draft.id}`, "PATCH", {}, "11-test")).status).toBe(409);
	expect(sqlite.prepare("SELECT COUNT(*) AS total FROM notification_messages").get()?.total).toBe(
		0,
	);
});
