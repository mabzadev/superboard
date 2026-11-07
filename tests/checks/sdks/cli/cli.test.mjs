import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { main } from "../../../../sdks/cli/src/cli.js";

const secretKey = `sb_secret_${"k".repeat(43)}`;
const bin = fileURLToPath(new URL("../../../../sdks/cli/bin/superboard.js", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "superboard-cli-"));
const requests = [];
const routes = new Map();
const server = createServer((request, response) => {
	const chunks = [];
	request.on("data", (chunk) => chunks.push(chunk));
	request.on("end", () => {
		const url = new URL(request.url, "http://127.0.0.1");
		const body = Buffer.concat(chunks);
		const recorded = {
			method: request.method,
			path: url.pathname,
			query: url.searchParams,
			headers: request.headers,
			body,
		};
		requests.push(recorded);
		const handler = routes.get(`${request.method} ${url.pathname}`);
		const reply = handler
			? handler(recorded)
			: { status: 404, json: { error: { code: "route_not_found", message: "No such route" } } };
		response.writeHead(reply.status ?? 200, {
			"content-type": reply.json !== undefined ? "application/json" : (reply.type ?? "text/plain"),
		});
		response.end(reply.json !== undefined ? JSON.stringify(reply.json) : reply.body);
	});
});
await new Promise((resolve) => {
	server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const env = {
	XDG_CONFIG_HOME: join(workspace, "config"),
	SUPERBOARD_URL: origin,
	SUPERBOARD_SECRET_KEY: secretKey,
};

function route(method, path, reply) {
	routes.set(`${method} ${path}`, typeof reply === "function" ? reply : () => reply);
}

async function run(args, options = {}) {
	const out = [];
	const err = [];
	const start = requests.length;
	const code = await main(args, {
		env: options.env ?? env,
		cwd: workspace,
		stdout: { write: (chunk) => out.push(Buffer.from(chunk)) },
		stderr: { write: (chunk) => err.push(String(chunk)) },
		limits: options.limits,
	});
	return {
		code,
		stdout: Buffer.concat(out).toString(),
		bytes: Buffer.concat(out),
		stderr: err.join(""),
		requests: requests.slice(start),
	};
}

const json = (request) => JSON.parse(request.body.toString());
const line = (request) =>
	`${request.method} ${request.path}${request.query.size ? `?${request.query}` : ""}`;
const status = {
	project_id: 12,
	features: {
		realtime: true,
		functions: true,
		function_secrets: false,
		image_transformations: false,
		vectors: true,
	},
	counts: { tables: 1, buckets: 2, functions: 3 },
};

test.after(async () => {
	server.close();
	await rm(workspace, { recursive: true, force: true });
});

test("login verifies the key and stores private credentials used by later commands", async () => {
	route("GET", "/v1/data/manage/status", { json: status });
	const isolated = { XDG_CONFIG_HOME: join(workspace, "login") };
	const missing = await run(["status"], { env: isolated });
	assert.equal(missing.code, 2);
	assert.match(missing.stderr, /Not logged in/u);
	assert.equal(missing.requests.length, 0);

	const refused = await run(["login", "--url", "http://sdk.example.test", "--key", secretKey], {
		env: isolated,
	});
	assert.equal(refused.code, 2);
	assert.match(refused.stderr, /HTTPS/u);

	const login = await run(["login", "--url", `${origin}/ignored/path`, "--key", secretKey], {
		env: isolated,
	});
	assert.equal(login.code, 0, login.stderr);
	assert.match(login.stdout, /Logged in to project 12/u);
	assert.equal(login.requests[0].headers.authorization, `Bearer ${secretKey}`);
	assert.match(login.requests[0].headers["user-agent"], /^superboard-cli\//u);
	const file = join(workspace, "login", "superboard", "config.json");
	assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { url: origin, secretKey });
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.equal((await stat(join(workspace, "login", "superboard"))).mode & 0o777, 0o700);

	const current = await run(["status"], { env: isolated });
	assert.equal(current.code, 0);
	assert.match(current.stdout, /Project {4}12/u);
	assert.match(current.stdout, /function_secrets: off/u);
	const machine = await run(["status", "--json"], { env: isolated });
	assert.equal(JSON.parse(machine.stdout).url, origin);

	const overridden = await run(["status"], {
		env: { ...isolated, SUPERBOARD_SECRET_KEY: `sb_secret_${"z".repeat(43)}` },
	});
	assert.equal(overridden.requests[0].headers.authorization, `Bearer sb_secret_${"z".repeat(43)}`);

	const logout = await run(["logout"], { env: isolated });
	assert.equal(logout.code, 0);
	await assert.rejects(stat(file), { code: "ENOENT" });
});

test("db pull writes the push input shape and db push prints the plan", async () => {
	route("GET", "/v1/data/manage/tables", {
		json: {
			items: [
				{
					name: "notes",
					label: "Notes",
					rules: { read: "authenticated", insert: "owner", update: "owner", delete: "owner" },
					realtime: false,
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
							indexed: false,
							position: 0,
						},
					],
					created_at: "x",
					updated_at: "y",
				},
			],
		},
	});
	const pulled = await run(["db", "pull", "--out", "schema.json"]);
	assert.equal(pulled.code, 0, pulled.stderr);
	const schema = JSON.parse(await readFile(join(workspace, "schema.json"), "utf8"));
	assert.deepEqual(schema.tables[0].columns, [
		{ name: "body", type: "text", nullable: false, unique: false, indexed: false },
		{
			name: "pinned",
			type: "boolean",
			nullable: true,
			default: false,
			unique: false,
			indexed: false,
		},
	]);
	assert.equal(schema.tables[0].label, "Notes");
	assert.equal("created_at" in schema.tables[0], false);

	const tables = await run(["db", "tables"]);
	assert.match(tables.stdout, /^NAME {3}COLUMNS/mu);
	assert.match(tables.stdout, /notes {2}pinned:boolean, body:text {2}authenticated/u);

	route("POST", "/v1/data/manage/schema", (request) =>
		request.query.get("allow_destructive") === "true" || request.query.get("dry_run") === "true"
			? {
					json: {
						applied: request.query.get("dry_run") !== "true",
						changes: [
							{ action: "add_column", table: "notes", column: "title", destructive: false },
							{ action: "drop_table", table: "old", destructive: true },
						],
					},
				}
			: {
					status: 409,
					json: {
						error: {
							code: "destructive_changes",
							message: "The schema deletes tables or columns",
							retryable: false,
							details: { changes: [{ action: "drop_table", table: "old", destructive: true }] },
						},
					},
				},
	);
	const plan = await run(["db", "push", "schema.json", "--dry-run", "--prune"]);
	assert.equal(plan.code, 0, plan.stderr);
	assert.equal(line(plan.requests[0]), "POST /v1/data/manage/schema?dry_run=true");
	assert.deepEqual(json(plan.requests[0]), { ...schema, prune: true });
	assert.equal(
		plan.stdout,
		"Plan (dry run, nothing applied):\n  + add_column notes.title\n  - drop_table old  (destructive)\n",
	);

	const refused = await run(["db", "push", "schema.json"]);
	assert.equal(refused.code, 1);
	assert.match(refused.stderr, /- drop_table old {2}\(destructive\)/u);
	assert.match(
		refused.stderr,
		/Error: The schema deletes tables or columns \[destructive_changes, HTTP 409\]/u,
	);
	assert.match(refused.stderr, /--allow-destructive/u);
	const machine = await run(["db", "push", "schema.json", "--json"]);
	assert.equal(JSON.parse(machine.stderr).error.code, "destructive_changes");

	const forced = await run(["db", "push", "schema.json", "--allow-destructive"]);
	assert.equal(line(forced.requests[0]), "POST /v1/data/manage/schema?allow_destructive=true");
	assert.match(forced.stdout, /^Applied:/u);

	await writeFile(join(workspace, "broken.json"), "{");
	const broken = await run(["db", "push", "broken.json"]);
	assert.equal(broken.code, 2);
	assert.equal(broken.requests.length, 0);
});

test("gen types writes the generated declarations", async () => {
	route("GET", "/v1/data/manage/types", { body: "export interface Database {}\n" });
	const result = await run(["gen", "types", "--out", "database.ts"]);
	assert.equal(result.code, 0, result.stderr);
	assert.equal(
		await readFile(join(workspace, "database.ts"), "utf8"),
		"export interface Database {}\n",
	);
	assert.equal((await run(["gen", "types"])).stdout, "export interface Database {}\n");
});

test("functions are deployed, invoked, scheduled and deleted", async () => {
	await writeFile(
		join(workspace, "hello.js"),
		"export default { fetch: () => new Response('hi') };\n",
	);
	route("PUT", "/v1/data/manage/functions/hello", {
		json: { name: "hello", access: "public", active_version: 2, timeout_ms: 5000 },
	});
	route("POST", "/v1/data/manage/functions/hello/invoke", {
		json: {
			run_id: "run-1",
			status: 201,
			headers: {},
			body: '{"ok":true}',
			logs: [{ level: "info", message: "started" }],
			duration_ms: 4,
		},
	});
	route("GET", "/v1/data/manage/functions/hello/runs", {
		json: {
			items: [
				{
					id: "run-1",
					version: 2,
					trigger: "http",
					status: 201,
					outcome: "ok",
					duration_ms: 4,
					error: null,
					started_at: "2026-11-07T10:00:00Z",
				},
			],
		},
	});
	route("PUT", "/v1/data/manage/functions/hello/schedule", {
		json: {
			cron: "*/5 * * * *",
			enabled: true,
			next_run_at: "2026-11-07T10:05:00Z",
			last_run_at: null,
		},
	});
	route("DELETE", "/v1/data/manage/functions/hello/schedule", { json: { deleted: true } });
	route("DELETE", "/v1/data/manage/functions/hello", { json: { deleted: true } });

	const deployed = await run([
		"functions",
		"deploy",
		"hello",
		"hello.js",
		"--access",
		"public",
		"--timeout-ms",
		"5000",
		"--var",
		"GREETING=bonjour=hi",
		"--var",
		"LANG=fr",
		"--secret",
		"TOKEN=s3cr3t",
	]);
	assert.equal(deployed.code, 0, deployed.stderr);
	assert.equal(deployed.stdout, "Deployed hello version 2 (access public, timeout 5000 ms)\n");
	assert.deepEqual(json(deployed.requests[0]), {
		source: "export default { fetch: () => new Response('hi') };\n",
		access: "public",
		timeout_ms: 5000,
		vars: { GREETING: "bonjour=hi", LANG: "fr" },
		secrets: { TOKEN: "s3cr3t" },
	});

	const invoked = await run([
		"functions",
		"invoke",
		"hello",
		"--method",
		"put",
		"--path",
		"/items/1",
		"--data",
		'{"n":1}',
	]);
	assert.equal(invoked.code, 0);
	assert.deepEqual(json(invoked.requests[0]), { method: "PUT", path: "/items/1", body: { n: 1 } });
	assert.equal(invoked.stdout, '{"ok":true}\n');
	assert.match(invoked.stderr, /\[info\] started\nHTTP 201 in 4 ms \(run run-1\)/u);
	const raw = await run(["functions", "invoke", "hello", "--data", "plain text"]);
	assert.deepEqual(json(raw.requests[0]), { body: "plain text" });

	const runs = await run(["functions", "runs", "hello", "--limit", "5"]);
	assert.equal(line(runs.requests[0]), "GET /v1/data/manage/functions/hello/runs?limit=5");
	assert.match(runs.stdout, /2026-11-07T10:00:00Z\s+http\s+201\s+ok/u);

	const scheduled = await run(["functions", "schedule", "hello", "*/5 * * * *"]);
	assert.deepEqual(json(scheduled.requests[0]), { cron: "*/5 * * * *" });
	assert.match(scheduled.stdout, /next run 2026-11-07T10:05:00Z/u);
	assert.equal((await run(["functions", "unschedule", "hello"])).requests[0].method, "DELETE");
	const deleted = await run(["functions", "delete", "hello"]);
	assert.equal(line(deleted.requests[0]), "DELETE /v1/data/manage/functions/hello?confirm=hello");

	const invalid = await run(["functions", "deploy", "hello", "hello.js", "--var", "NOVALUE"]);
	assert.equal(invalid.code, 2);
	assert.match(invalid.stderr, /--var expects KEY=VALUE/u);
});

test("storage uploads small files directly and large files in resumable parts", async () => {
	await writeFile(join(workspace, "small.json"), '{"a":1}');
	await writeFile(join(workspace, "large.bin"), Buffer.from("abcdefghij"));
	const stored = (request, path) => ({
		status: 201,
		json: {
			bucket: "media",
			path,
			size: request.body.length || 10,
			content_type: "application/json",
		},
	});
	route("PUT", "/v1/data/storage/object/media/docs/my%20file.json", (request) =>
		stored(request, "docs/my file.json"),
	);
	route("POST", "/v1/data/storage/uploads/media", {
		status: 201,
		json: { upload_id: "up-1", path: "big/large.bin" },
	});
	let failSecond = true;
	for (const part of [1, 2, 3])
		route("PUT", `/v1/data/storage/uploads/media/up-1/${part}`, (request) => {
			if (part === 2 && failSecond) {
				failSecond = false;
				return {
					status: 503,
					json: { error: { code: "upstream_unavailable", message: "Try again", retryable: true } },
				};
			}
			return { json: { part_number: part, etag: `e${part}`, size: request.body.length } };
		});
	route("GET", "/v1/data/storage/uploads/media/up-1", {
		json: {
			upload_id: "up-1",
			path: "big/large.bin",
			expires_at: "x",
			parts: [{ part_number: 1, etag: "e1", size: 4 }],
		},
	});
	route("POST", "/v1/data/storage/uploads/media/up-1/complete", (request) =>
		stored(request, "big/large.bin"),
	);

	const small = await run([
		"storage",
		"upload",
		"media",
		"docs/my file.json",
		"small.json",
		"--upsert",
	]);
	assert.equal(small.code, 0, small.stderr);
	assert.equal(small.requests[0].path, "/v1/data/storage/object/media/docs/my%20file.json");
	assert.equal(small.requests[0].headers["content-type"], "application/json");
	assert.equal(small.requests[0].headers["x-upsert"], "true");
	assert.equal(small.requests[0].body.toString(), '{"a":1}');

	const limits = { multipartThreshold: 5, partSize: 4 };
	const failed = await run(["storage", "upload", "media", "big/large.bin", "large.bin"], {
		limits,
	});
	assert.equal(failed.code, 1);
	assert.match(failed.stderr, /\[upstream_unavailable, HTTP 503\]/u);
	assert.match(failed.stderr, /--resume up-1/u);
	assert.deepEqual(json(failed.requests[0]), {
		path: "big/large.bin",
		content_type: "application/octet-stream",
		upsert: false,
	});

	const resumed = await run(
		["storage", "upload", "media", "big/large.bin", "large.bin", "--resume", "up-1"],
		{ limits },
	);
	assert.equal(resumed.code, 0, resumed.stderr);
	assert.deepEqual(
		resumed.requests.map(
			(request) => `${request.method} ${request.path} ${request.body.toString()}`,
		),
		[
			"GET /v1/data/storage/uploads/media/up-1 ",
			"PUT /v1/data/storage/uploads/media/up-1/2 efgh",
			"PUT /v1/data/storage/uploads/media/up-1/3 ij",
			"POST /v1/data/storage/uploads/media/up-1/complete ",
		],
	);
});

test("storage lists, downloads and removes objects", async () => {
	const binary = Buffer.from([0, 255, 1, 254]);
	route("GET", "/v1/data/manage/buckets", {
		json: {
			items: [
				{
					name: "media",
					public: true,
					max_bytes: 52428800,
					allowed_types: [],
					rules: { read: "public", write: "owner", delete: "owner" },
				},
			],
		},
	});
	route("GET", "/v1/data/storage/list/media", {
		json: {
			items: [
				{
					bucket: "media",
					path: "a.png",
					size: 2048,
					content_type: "image/png",
					updated_at: "2026-11-07",
				},
			],
			nextCursor: "a.png",
		},
	});
	route("GET", "/v1/data/storage/object/media/a.png", { type: "image/png", body: binary });
	route("DELETE", "/v1/data/storage/object/media/a.png", { json: { deleted: true } });

	assert.match(
		(await run(["storage", "buckets"])).stdout,
		/media\s+yes\s+50 MiB\s+any\s+public\s+owner\s+owner/u,
	);
	const listed = await run(["storage", "ls", "media", "--prefix", "a", "--limit", "1"]);
	assert.equal(line(listed.requests[0]), "GET /v1/data/storage/list/media?prefix=a&limit=1");
	assert.match(listed.stdout, /a\.png\s+2\.0 KiB\s+image\/png/u);
	assert.match(listed.stderr, /--cursor a\.png/u);

	const piped = await run(["storage", "download", "media", "a.png"]);
	assert.deepEqual(piped.bytes, binary);
	const saved = await run(["storage", "download", "media", "a.png", "--out", "copy.png"]);
	assert.equal(saved.code, 0, saved.stderr);
	assert.deepEqual(await readFile(join(workspace, "copy.png")), binary);
	const removed = await run(["storage", "rm", "media", "a.png"]);
	assert.equal(removed.stdout, "Deleted media/a.png\n");
	const missing = await run(["storage", "download", "media", "missing.png"]);
	assert.equal(missing.code, 1);
	assert.match(missing.stderr, /\[route_not_found, HTTP 404\]/u);
});

test("vector collections and similarity queries", async () => {
	route("GET", "/v1/data/manage/vector-collections", {
		json: {
			items: [{ name: "docs", rules: { read: "public", write: "service" }, item_count: 3 }],
			available: false,
		},
	});
	route("POST", "/v1/data/vectors/docs/query", {
		json: {
			items: [{ id: "a", score: 0.91234, content: "Hello world", metadata: {}, owner_id: null }],
		},
	});
	const collections = await run(["vectors", "collections"]);
	assert.match(collections.stdout, /not available/u);
	assert.match(collections.stdout, /docs\s+3\s+public\s+service/u);
	const query = await run(["vectors", "query", "docs", "hello there", "--top-k", "3"]);
	assert.deepEqual(json(query.requests[0]), { text: "hello there", top_k: 3 });
	assert.match(query.stdout, /0\.9123\s+a\s+Hello world/u);
	const machine = await run(["vectors", "query", "docs", "hello", "--json"]);
	assert.equal(JSON.parse(machine.stdout).items[0].id, "a");
});

test("every command has help and rejects unknown input", async () => {
	for (const args of [
		["--help"],
		["help"],
		["db"],
		["storage", "--help"],
		["functions", "deploy", "-h"],
		["help", "vectors", "query"],
	]) {
		const result = await run(args);
		assert.equal(result.code, 0, args.join(" "));
		assert.match(result.stdout, /Usage: superboard/u);
		assert.equal(result.requests.length, 0);
	}
	assert.match((await run(["help", "vectors", "query"])).stdout, /--top-k <value>/u);
	for (const args of [
		["nope"],
		["db", "nope"],
		["db", "tables", "--nope"],
		["storage", "rm", "media"],
	]) {
		const result = await run(args);
		assert.equal(result.code, 2, args.join(" "));
		assert.match(result.stderr, /^Error: /u);
	}
	const { stdout } = await promisify(execFile)(process.execPath, [bin, "--version"]);
	assert.match(stdout, /^\d+\.\d+\.\d+\n$/u);
});
