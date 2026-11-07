import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureTable, jsonOf, operator, publicRequest, sdk } from "./helpers";

type Row = Record<string, unknown> & { id: string };

const pause = (milliseconds: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});

async function sql(query: string) {
	return operator("/sql", { method: "POST", body: { query } });
}

describe("Read-only SQL console", () => {
	beforeAll(async () => {
		await ensureTable({ name: "ledger", columns: [{ name: "label", type: "text" }] });
	});

	it.each([
		["SELECT key_hash, hint FROM 'data_service_keys'"],
		[`SELECT "'" AS a FROM sqlite_master, (SELECT 1 AS "'")`],
		["SELECT * FROM pragma_table_list"],
		["SELECT * FROM [data_tables]"],
		["SELECT * FROM `data_service_keys`"],
		["SELECT * FROM main.data_project_settings"],
		["SELECT * FROM adb_99_ledger"],
	])("refuses to read system or foreign tables: %s", async (query) => {
		const response = await sql(query);
		expect(response.status).toBe(403);
		expect(await jsonOf(response)).toMatchObject({ error: { code: "sql_table_forbidden" } });
	});

	it("refuses statements hidden behind quoted identifiers", async () => {
		const response = await sql(
			`SELECT "'" AS a); INSERT INTO data_project_settings VALUES (999,1,'x'); SELECT * FROM (SELECT "'"`,
		);
		expect(response.status).toBe(422);
		const written = await env.DB.prepare(
			"SELECT COUNT(*) AS total FROM data_project_settings WHERE project_id = 999",
		).first<{ total: number }>();
		expect(written?.total).toBe(0);
	});

	it("still runs a project query with semicolons inside literals", async () => {
		const response = await sql(`SELECT 'a;b' AS "x;y" FROM "adb_12_ledger" UNION ALL SELECT 'c;d'`);
		expect(response.status).toBe(200);
		expect(await jsonOf(response)).toMatchObject({ columns: ["x;y"], rows: [["c;d"]] });
	});
});

describe("Storage visibility", () => {
	it("stops serving anonymous readers when a public bucket becomes private", async () => {
		await operator("/buckets", { method: "POST", body: { name: "flyers", public: true } });
		const bytes = new TextEncoder().encode("hello");
		await sdk("/v1/storage/object/flyers/a.txt", {
			method: "PUT",
			user: "alice",
			raw: bytes,
			headers: { "content-type": "text/plain", "content-length": String(bytes.byteLength) },
		});
		expect((await sdk("/v1/storage/object/flyers/a.txt")).status).toBe(200);
		const updated = await operator("/buckets/flyers", { method: "PATCH", body: { public: false } });
		expect(await jsonOf(updated)).toMatchObject({ public: false, rules: { read: "owner" } });
		expect((await sdk("/v1/storage/object/flyers/a.txt")).status).toBe(401);
		expect((await publicRequest("/v1/storage/public/12/flyers/a.txt")).status).toBe(404);
		expect((await sdk("/v1/storage/object/flyers/a.txt", { user: "alice" })).status).toBe(200);
	});

	it("rejects a multipart upload whose parts exceed the bucket size", async () => {
		await operator("/buckets", { method: "POST", body: { name: "tiny", max_bytes: 10 } });
		const { upload_id } = await jsonOf<{ upload_id: string }>(
			await sdk("/v1/storage/uploads/tiny", {
				method: "POST",
				user: "alice",
				body: { path: "big.bin", content_type: "application/octet-stream" },
			}),
		);
		const part = new Uint8Array(8);
		await sdk(`/v1/storage/uploads/tiny/${upload_id}/1`, {
			method: "PUT",
			user: "alice",
			raw: part,
			headers: { "content-length": String(part.byteLength) },
		});
		await env.DB.prepare(
			"INSERT INTO data_upload_parts (upload_id, part_number, etag, byte_size, created_at) VALUES (?, 2, 'concurrent', 8, ?)",
		)
			.bind(upload_id, new Date().toISOString())
			.run();
		const completed = await sdk(`/v1/storage/uploads/tiny/${upload_id}/complete`, {
			method: "POST",
			user: "alice",
		});
		expect(completed.status).toBe(413);
		expect((await sdk("/v1/storage/object/tiny/big.bin", { user: "alice" })).status).toBe(404);
	});

	it("answers 422 to a path with invalid percent-encoding", async () => {
		const response = await sdk("/v1/storage/object/flyers/%E0%A4%A", { user: "alice" });
		expect(await jsonOf(response)).toMatchObject({ error: { code: "path_invalid" } });
	});
});

describe("Row writes", () => {
	beforeAll(async () => {
		await ensureTable({
			name: "secrets",
			rules: { read: "owner", insert: "authenticated", update: "owner", delete: "authenticated" },
			columns: [
				{ name: "title", type: "text", nullable: false },
				{ name: "secret", type: "text" },
				{ name: "rank", type: "integer" },
			],
		});
	});

	it("updates only the columns an upsert provides", async () => {
		const row = await jsonOf<Row>(
			await sdk("/v1/db/secrets", {
				method: "POST",
				user: "alice",
				body: { title: "first", secret: "s", rank: 3 },
			}),
		);
		const upserted = await sdk("/v1/db/secrets?upsert=true", {
			method: "POST",
			user: "alice",
			body: { id: row.id, rank: 4 },
		});
		expect(await jsonOf(upserted)).toMatchObject({
			id: row.id,
			title: "first",
			secret: "s",
			rank: 4,
		});
	});

	it("refuses a mixed upsert batch before writing anything", async () => {
		const owned = await jsonOf<Row>(
			await sdk("/v1/db/secrets", { method: "POST", user: "alice", body: { title: "mine" } }),
		);
		const fresh = crypto.randomUUID();
		const response = await sdk("/v1/db/secrets?upsert=true", {
			method: "POST",
			user: "bob",
			body: [
				{ id: fresh, title: "new" },
				{ id: owned.id, title: "stolen" },
			],
		});
		expect(response.status).toBe(409);
		const stored = await env.DB.prepare(
			'SELECT COUNT(*) AS total FROM "adb_12_secrets" WHERE id = ?',
		)
			.bind(fresh)
			.first<{ total: number }>();
		expect(stored?.total).toBe(0);
	});

	it("never returns columns the caller cannot read", async () => {
		const victim = await jsonOf<Row>(
			await sdk("/v1/db/secrets", {
				method: "POST",
				user: "alice",
				body: { title: "victim", secret: "hunter2" },
			}),
		);
		const filtered = await sdk("/v1/db/secrets?secret=like.*", { method: "DELETE", user: "bob" });
		expect(await jsonOf(filtered)).toEqual({ items: [] });
		const stillThere = await sdk(`/v1/db/secrets/${victim.id}`, { user: "alice" });
		expect(stillThere.status).toBe(200);
		const byId = await sdk(`/v1/db/secrets/${victim.id}`, { method: "DELETE", user: "bob" });
		expect(await jsonOf(byId)).toEqual({ deleted: true, item: { id: victim.id } });
	});

	it("rejects names that could collide with generated index names", async () => {
		const response = await operator("/tables", { method: "POST", body: { name: "audit__uq" } });
		expect(await jsonOf(response)).toMatchObject({ error: { code: "table_name_invalid" } });
	});

	it("keeps the rules of a table when a schema push omits them", async () => {
		await ensureTable({
			name: "internal_notes",
			rules: { read: "service", insert: "service", update: "service", delete: "service" },
			columns: [{ name: "body", type: "text" }],
		});
		const pushed = await operator("/schema", {
			method: "POST",
			body: { tables: [{ name: "internal_notes", columns: [{ name: "body", type: "text" }] }] },
		});
		expect(await jsonOf(pushed)).toMatchObject({ applied: true, changes: [] });
		const table = await jsonOf<{ rules: Record<string, string> }>(
			await operator("/tables/internal_notes"),
		);
		expect(table.rules).toEqual({
			read: "service",
			insert: "service",
			update: "service",
			delete: "service",
		});
	});
});

describe("Function responses", () => {
	it("strip cookies both ways and sandbox the response", async () => {
		const deployed = await operator("/functions/page", {
			method: "PUT",
			body: {
				access: "public",
				source: `export default {
					async fetch(request) {
						return new Response("<script>" + (request.headers.get("cookie") ?? "none") + "</script>", {
							headers: { "content-type": "text/html", "set-cookie": "session=stolen" },
						});
					},
				};`,
			},
		});
		expect(deployed.status).toBe(200);
		const response = await sdk("/v1/functions/page", { headers: { cookie: "session=secret" } });
		expect(await response.text()).toBe("<script>none</script>");
		expect(response.headers.get("set-cookie")).toBeNull();
		expect(response.headers.get("content-security-policy")).toBe("sandbox");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	});
});

describe("Realtime sessions", () => {
	async function connect(user?: string, tokenExpiresIn?: string): Promise<WebSocket> {
		const ticket = await jsonOf<{ url: string }>(
			await sdk("/v1/realtime/tickets", {
				method: "POST",
				...(user ? { user } : {}),
				...(tokenExpiresIn ? { tokenExpiresIn } : {}),
			}),
		);
		const response = await publicRequest(
			`/v1/realtime/connect${new URL(ticket.url.replace(/^wss:/u, "https:")).search}`,
			{
				headers: { upgrade: "websocket" },
			},
		);
		const socket = response.webSocket;
		if (!socket) throw new Error("no websocket");
		socket.accept();
		return socket;
	}

	function closed(socket: WebSocket): Promise<number> {
		return new Promise((resolve) => {
			socket.addEventListener("close", (event) => {
				resolve(event.code);
			});
		});
	}

	it("closes a connection when the session behind its ticket expires", async () => {
		const socket = await connect("alice", "2s");
		const closing = closed(socket);
		await pause(2_200);
		socket.send(JSON.stringify({ type: "ping" }));
		expect(await closing).toBe(4001);
	});

	it("disconnects anonymous visitors when the project stops allowing them", async () => {
		await operator("/settings", { method: "PATCH", body: { realtime_anonymous: true } });
		await pause(50);
		const visitor = await connect();
		const closing = closed(visitor);
		visitor.send(JSON.stringify({ type: "join", channel: "lobby", ref: "1" }));
		await pause(50);
		await operator("/settings", { method: "PATCH", body: { realtime_anonymous: false } });
		expect(await closing).toBe(4003);
	});
});
