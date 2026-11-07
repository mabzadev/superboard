import assert from "node:assert/strict";
import test from "node:test";

import {
	SuperBoardAdmin,
	SuperBoardError,
	SuperBoardServer,
} from "../../../../sdks/web/src/server.js";

const secretKey = `sb_secret_${"A".repeat(43)}`;
const table = {
	name: "notes",
	label: null,
	rules: { read: "authenticated", insert: "owner", update: "owner", delete: "owner" },
	realtime: true,
	columns: [
		{
			name: "pinned",
			type: "boolean",
			nullable: true,
			default: false,
			unique: false,
			indexed: false,
			position: 1,
		},
		{
			name: "body",
			type: "text",
			nullable: false,
			default: null,
			unique: false,
			indexed: true,
			position: 0,
		},
	],
	created_at: "2026-11-07T10:00:00.000Z",
	updated_at: "2026-11-07T10:00:00.000Z",
};

function admin(respond = () => Response.json({ ok: true })) {
	const requests = [];
	const instance = new SuperBoardAdmin({
		apiUrl: "https://sdk.example.test/ignored",
		secretKey,
		projectId: 12,
		fetch: async (url, init) => {
			const request = {
				method: init.method,
				url: new URL(url),
				headers: new Headers(init.headers),
				json: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
			};
			requests.push(request);
			return respond(request);
		},
	});
	return { admin: instance, requests };
}

const line = (request) => `${request.method} ${request.url.pathname}${request.url.search}`;

test("the server key authenticates data calls without application headers", async () => {
	const { admin: client, requests } = admin(() => Response.json({ items: [] }));
	await client.from("notes").eq("pinned", true).get();
	await client.storage.from("exports").list();
	await client.vectors.from("docs").query({ values: [1, 0], topK: 2 });
	await client.realtime.broadcast("news", "published", { id: 1 });

	for (const request of requests) {
		assert.equal(request.headers.get("Authorization"), `Bearer ${secretKey}`);
		assert.equal(request.headers.has("PROJECT-KEY"), false);
		assert.equal(request.headers.has("PLATFORM"), false);
	}
	assert.deepEqual(requests.map(line), [
		"GET /v1/data/db/notes?pinned=eq.true",
		"GET /v1/data/storage/list/exports",
		"POST /v1/data/vectors/docs/query",
		"POST /v1/data/realtime/broadcast",
	]);
	assert.deepEqual(requests[3].json, { channel: "news", event: "published", payload: { id: 1 } });
	assert.equal(
		client.storage.from("exports").getPublicUrl("2026/report.csv"),
		"https://sdk.example.test/v1/data/storage/public/12/exports/2026/report.csv",
	);
});

test("management calls map to the manage routes and confirm deletions by name", async () => {
	const { admin: client, requests } = admin((request) =>
		request.url.pathname === "/v1/data/manage/types"
			? new Response("export interface Database {}\n", {
					headers: { "content-type": "text/plain" },
				})
			: Response.json({ items: [table], changes: [], applied: false }),
	);
	const { manage } = client;
	assert.equal(await manage.types(), "export interface Database {}\n");
	await manage.status();
	await manage.tables.delete("notes");
	await manage.tables.dropColumn("notes", "pinned");
	await manage.functions.deploy("hello", {
		source: "export default {}",
		access: "public",
		timeoutMs: 5000,
		vars: { GREETING: "hi" },
	});
	await manage.functions.schedule("hello", "*/5 * * * *");
	await manage.functions.unschedule("hello");
	await manage.functions.runs("hello", { limit: 5 });
	await manage.functions.test("hello", { method: "GET", path: "/ping" });
	await manage.functions.delete("hello");
	await manage.buckets.delete("exports");
	await manage.vectorCollections.list();
	await manage.schema.push({ tables: [] }, { dryRun: true, allowDestructive: true, prune: true });

	assert.deepEqual(requests.map(line), [
		"GET /v1/data/manage/types",
		"GET /v1/data/manage/status",
		"DELETE /v1/data/manage/tables/notes?confirm=notes",
		"DELETE /v1/data/manage/tables/notes/columns/pinned?confirm=pinned",
		"PUT /v1/data/manage/functions/hello",
		"PUT /v1/data/manage/functions/hello/schedule",
		"DELETE /v1/data/manage/functions/hello/schedule",
		"GET /v1/data/manage/functions/hello/runs?limit=5",
		"POST /v1/data/manage/functions/hello/invoke",
		"DELETE /v1/data/manage/functions/hello?confirm=hello",
		"DELETE /v1/data/manage/buckets/exports?confirm=exports",
		"GET /v1/data/manage/vector-collections",
		"POST /v1/data/manage/schema?dry_run=true&allow_destructive=true",
	]);
	assert.deepEqual(requests[4].json, {
		source: "export default {}",
		access: "public",
		timeout_ms: 5000,
		vars: { GREETING: "hi" },
	});
	assert.deepEqual(requests[5].json, { cron: "*/5 * * * *" });
	assert.deepEqual(requests[8].json, { method: "GET", path: "/ping" });
	assert.deepEqual(requests[12].json, { tables: [], prune: true });
});

test("schema pull returns the tables in the shape accepted by push", async () => {
	const { admin: client } = admin(() => Response.json({ items: [table] }));
	assert.deepEqual(await client.manage.schema.pull(), {
		tables: [
			{
				name: "notes",
				rules: { read: "authenticated", insert: "owner", update: "owner", delete: "owner" },
				realtime: true,
				columns: [
					{ name: "body", type: "text", nullable: false, unique: false, indexed: true },
					{
						name: "pinned",
						type: "boolean",
						nullable: true,
						default: false,
						unique: false,
						indexed: false,
					},
				],
			},
		],
	});
});

test("server keys are validated and errors expose the API code", async () => {
	assert.throws(
		() => new SuperBoardAdmin({ apiUrl: "https://sdk.example.test", secretKey: "sb_email_x" }),
		TypeError,
	);
	assert.throws(
		() => new SuperBoardAdmin({ apiUrl: "http://sdk.example.test", secretKey }),
		/HTTPS/u,
	);
	const { admin: client } = admin(() =>
		Response.json(
			{
				error: {
					code: "destructive_changes",
					message: "The schema deletes tables or columns",
					retryable: false,
					details: { changes: [] },
				},
			},
			{ status: 409 },
		),
	);
	await assert.rejects(client.manage.schema.push({ tables: [] }), (error) => {
		assert.ok(error instanceof SuperBoardError);
		assert.equal(error.code, "destructive_changes");
		assert.equal(error.status, 409);
		assert.deepEqual(error.details, { changes: [] });
		return true;
	});
	assert.equal(typeof SuperBoardServer, "function");
});
