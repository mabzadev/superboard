import assert from "node:assert/strict";
import test from "node:test";

import { SuperBoardClient, SuperBoardError } from "../../../../sdks/web/src/client.js";

const options = {
	apiUrl: "https://sdk.example.test",
	projectKey: "project-key",
	appId: "demo.web",
	environment: "test",
	projectId: 12,
};
const session = { access_token: "identity-one", refresh_token: "refresh-one", user_id: "alice" };

function recorder(respond) {
	const requests = [];
	const fetch = async (url, init = {}) => {
		const body = init.body;
		const request = {
			method: init.method ?? "GET",
			url: new URL(url),
			headers: new Headers(init.headers),
			body,
			text: typeof body === "string" ? body : body instanceof Blob ? await body.text() : null,
			size: body instanceof Blob ? body.size : typeof body === "string" ? body.length : 0,
		};
		requests.push(request);
		return respond(request, requests.length);
	};
	return { requests, fetch };
}

function client(respond, extra = {}) {
	const recorded = recorder(respond);
	return {
		...recorded,
		client: new SuperBoardClient({ ...options, ...extra, fetch: recorded.fetch }),
	};
}

const filters = (request) => [...request.url.searchParams];

await test("table queries encode PostgREST filters and follow cursors", async () => {
	const pages = [
		{ items: [{ id: "1" }, { id: "2" }], nextCursor: "c1", count: 3 },
		{ items: [{ id: "3" }] },
	];
	const { client: sdk, requests } = client((request, index) =>
		Response.json(pages[index - 1] ?? { items: [] }),
	);
	const query = sdk
		.from("todos")
		.select(["title", "priority"])
		.gte("priority", 1)
		.lt("priority", 10)
		.eq("done", false)
		.neq("owner_id", null)
		.ilike("title", "*milk*")
		.in("tag", ["a,b", 'say "hi"', 3])
		.is("archived", null)
		.not("status", "in", ["x", "y"])
		.order("priority", { ascending: false })
		.limit(2)
		.count();

	const seen = [];
	for await (const page of query.pages()) seen.push(...page.items.map((item) => item.id));

	assert.deepEqual(seen, ["1", "2", "3"]);
	assert.equal(requests.length, 2);
	assert.equal(requests[0].url.pathname, "/v1/data/db/todos");
	assert.deepEqual(filters(requests[0]), [
		["select", "title,priority"],
		["priority", "gte.1"],
		["priority", "lt.10"],
		["done", "eq.false"],
		["owner_id", "not.is.null"],
		["title", "ilike.*milk*"],
		["tag", 'in.("a,b","say ""hi""",3)'],
		["archived", "is.null"],
		["status", "not.in.(x,y)"],
		["order", "priority.desc"],
		["limit", "2"],
		["count", "exact"],
	]);
	assert.equal(requests[1].url.searchParams.get("cursor"), "c1");
	assert.equal(requests[0].headers.get("PROJECT-KEY"), "project-key");
	assert.equal(requests[0].headers.get("PLATFORM"), "web");
	assert.equal(requests[0].headers.get("IDENTIFIER"), "demo.web");
	assert.equal(requests[0].headers.has("Authorization"), false);

	const base = sdk.from("todos").eq("done", true);
	await base.limit(1);
	await base;
	assert.equal(requests[2].url.searchParams.get("limit"), "1");
	assert.equal(requests[3].url.searchParams.has("limit"), false);

	assert.throws(() => sdk.from("todos").eq("limit", 3), TypeError);
	assert.throws(() => sdk.from("todos").in("tag", []), TypeError);
	assert.throws(() => sdk.from("todos").is("done", "yes"), TypeError);
});

await test("row writes use the application token of the signed-in user", async () => {
	const { client: sdk, requests } = client((request) => {
		if (request.url.pathname === "/v1/auth/superboard-token")
			return Response.json({ access_token: "app-token", expires_in: 300 });
		if (request.method === "POST")
			return Response.json(
				request.text.startsWith("[") ? { items: JSON.parse(request.text) } : { id: "r1", data: 7 },
				{ status: 201 },
			);
		return Response.json({ items: [] });
	});
	sdk.setSession(session);

	const row = await sdk.from("notes").insert({ data: 7 });
	assert.deepEqual(row, { id: "r1", data: 7 });
	await sdk.from("notes").insert([{ title: "a" }, { title: "b" }], { upsert: true });
	await sdk.from("notes").eq("title", "a").update({ done: true });
	await sdk.from("notes").updateById("r1", { done: false });
	await sdk.from("notes").in("id", ["r1", "r2"]).delete();
	await sdk.from("notes").deleteById("r 1");
	await sdk.from("notes").select("title").single("r1");

	const data = requests.filter((request) => request.url.pathname.startsWith("/v1/data/"));
	assert.equal(
		requests.filter((request) => request.url.pathname === "/v1/auth/superboard-token").length,
		1,
	);
	for (const request of data)
		assert.equal(request.headers.get("Authorization"), "Bearer app-token");
	assert.deepEqual(
		data.map((request) => `${request.method} ${request.url.pathname}${request.url.search}`),
		[
			"POST /v1/data/db/notes",
			"POST /v1/data/db/notes?upsert=true",
			"PATCH /v1/data/db/notes?title=eq.a",
			"PATCH /v1/data/db/notes/r1",
			"DELETE /v1/data/db/notes?id=in.%28r1%2Cr2%29",
			"DELETE /v1/data/db/notes/r%201",
			"GET /v1/data/db/notes/r1?select=title",
		],
	);
	assert.equal(data[0].headers.get("Content-Type"), "application/json");
	assert.deepEqual(JSON.parse(data[2].text), { done: true });
	assert.throws(() => sdk.from("notes").update({ done: true }), /needs at least one filter/u);
	assert.throws(() => sdk.from("notes").delete(), /needs at least one filter/u);
});

await test("an expired application token is exchanged again once", async () => {
	let exchanges = 0;
	let attempts = 0;
	const { client: sdk } = client((request) => {
		if (request.url.pathname === "/v1/auth/superboard-token") {
			exchanges++;
			return Response.json({ access_token: `app-${exchanges}`, expires_in: 300 });
		}
		attempts++;
		return request.headers.get("Authorization") === "Bearer app-2"
			? Response.json({ items: [{ id: "x" }] })
			: Response.json(
					{ error: { code: "token_invalid", message: "Token expired", retryable: false } },
					{ status: 401 },
				);
	});
	sdk.setSession(session);
	assert.deepEqual((await sdk.from("todos").get()).items, [{ id: "x" }]);
	assert.equal(exchanges, 2);
	assert.equal(attempts, 2);
});

await test("API errors keep their code, details and retryability", async () => {
	const { client: sdk } = client(() =>
		Response.json(
			{
				error: {
					code: "filter_column_unknown",
					message: "Column nope does not exist",
					retryable: false,
					details: { column: "nope" },
				},
			},
			{ status: 422 },
		),
	);
	await assert.rejects(
		sdk.from("todos").eq("nope", 1).get(),
		(error) =>
			error instanceof SuperBoardError &&
			error.code === "filter_column_unknown" &&
			error.status === 422 &&
			error.retryable === false &&
			error.details.column === "nope",
	);
	const { client: unavailable } = client(() => new Response("upstream", { status: 503 }));
	await assert.rejects(unavailable.storage.listBuckets(), { code: "http_503", retryable: true });
});

await test("storage objects are uploaded, listed, signed and addressed publicly", async () => {
	const { client: sdk, requests } = client((request) => {
		if (request.method === "GET" && request.url.pathname.startsWith("/v1/data/storage/object/"))
			return new Response("pixels", { headers: { "content-type": "image/webp" } });
		if (request.url.pathname.startsWith("/v1/data/storage/sign/"))
			return Response.json({
				url: "https://sdk.example.test/v1/data/storage/signed/t",
				expires_at: "x",
			});
		return Response.json(
			{ items: [], path: "a" },
			{ status: request.method === "PUT" ? 201 : 200 },
		);
	});
	const avatars = sdk.storage.from("avatars");
	await avatars.upload("users/a b.png", new Blob(["png"], { type: "image/png" }), { upsert: true });
	await avatars.upload("notes/readme.txt", "hello");
	const blob = await avatars.download("users/a b.png", {
		transform: { width: 64, format: "webp" },
	});
	await avatars.list({ prefix: "users/", limit: 10, cursor: "users/a" });
	await avatars.remove("users/a b.png");
	const signed = await avatars.createSignedUrl("users/a b.png", 60, { transform: { height: 32 } });
	await sdk.storage.listBuckets();

	assert.equal(await blob.text(), "pixels");
	assert.equal(signed.url, "https://sdk.example.test/v1/data/storage/signed/t");
	assert.deepEqual(
		requests.map((request) => `${request.method} ${request.url.pathname}${request.url.search}`),
		[
			"PUT /v1/data/storage/object/avatars/users/a%20b.png",
			"PUT /v1/data/storage/object/avatars/notes/readme.txt",
			"GET /v1/data/storage/object/avatars/users/a%20b.png?width=64&format=webp",
			"GET /v1/data/storage/list/avatars?prefix=users%2F&limit=10&cursor=users%2Fa",
			"DELETE /v1/data/storage/object/avatars/users/a%20b.png",
			"POST /v1/data/storage/sign/avatars/users/a%20b.png",
			"GET /v1/data/storage/buckets",
		],
	);
	assert.equal(requests[0].headers.get("x-upsert"), "true");
	assert.equal(requests[0].headers.get("Content-Type"), "image/png");
	assert.equal(requests[0].text, "png");
	assert.equal(requests[1].headers.has("x-upsert"), false);
	assert.equal(requests[1].headers.get("Content-Type"), "text/plain");
	assert.deepEqual(JSON.parse(requests[5].text), { expires_in: 60, transform: { height: "32" } });
	assert.equal(
		avatars.getPublicUrl("users/a b.png", { transform: { width: 10 } }),
		"https://sdk.example.test/v1/data/storage/public/12/avatars/users/a%20b.png?width=10",
	);
	assert.throws(
		() =>
			new SuperBoardClient({ ...options, projectId: undefined }).storage
				.from("a")
				.getPublicUrl("x"),
		/projectId/u,
	);
	assert.throws(() => avatars.upload("/absolute", "x"), TypeError);
});

await test("large uploads send ordered parts and resume from the parts already received", async () => {
	const MiB = 1024 * 1024;
	const file = new Blob([new Uint8Array(12 * MiB + 3)], { type: "video/mp4" });
	let failPart = 2;
	const { client: sdk, requests } = client((request) => {
		const path = request.url.pathname;
		if (request.method === "POST" && path === "/v1/data/storage/uploads/media")
			return Response.json(
				{ upload_id: "u1", path: "clip.mp4", minimum_part_size: 5 * MiB },
				{ status: 201 },
			);
		if (request.method === "PUT") {
			const part = Number(path.split("/").at(-1));
			if (part === failPart) {
				failPart = 0;
				return Response.json(
					{ error: { code: "part_failed", message: "Network", retryable: true } },
					{ status: 503 },
				);
			}
			return Response.json({ part_number: part, etag: `e${part}`, size: request.size });
		}
		if (request.method === "GET")
			return Response.json({
				upload_id: "u1",
				path: "clip.mp4",
				expires_at: "x",
				parts: [{ part_number: 1, etag: "e1", size: 5 * MiB }],
			});
		return Response.json({ bucket: "media", path: "clip.mp4", size: file.size }, { status: 201 });
	});
	const media = sdk.storage.from("media");
	const progress = [];
	const failure = await media
		.uploadLarge("clip.mp4", file, {
			partSize: 5 * MiB,
			upsert: true,
			onProgress: (event) => progress.push(event),
		})
		.catch((error) => error);
	assert.equal(failure.code, "part_failed");
	assert.equal(failure.uploadId, "u1");
	assert.deepEqual(JSON.parse(requests[0].text), {
		path: "clip.mp4",
		content_type: "video/mp4",
		upsert: true,
	});

	const resumedFrom = requests.length;
	const stored = await media.uploadLarge("clip.mp4", file, {
		partSize: 5 * MiB,
		resumeUploadId: "u1",
		onProgress: (event) => progress.push(event),
	});
	assert.equal(stored.size, file.size);
	assert.deepEqual(
		requests
			.slice(resumedFrom)
			.map((request) => `${request.method} ${request.url.pathname} ${request.size}`),
		[
			"GET /v1/data/storage/uploads/media/u1 0",
			`PUT /v1/data/storage/uploads/media/u1/2 ${5 * MiB}`,
			`PUT /v1/data/storage/uploads/media/u1/3 ${2 * MiB + 3}`,
			"POST /v1/data/storage/uploads/media/u1/complete 0",
		],
	);
	assert.deepEqual(progress.at(-1), {
		uploadId: "u1",
		uploadedBytes: file.size,
		totalBytes: file.size,
		partNumber: 3,
	});
	await assert.rejects(media.uploadLarge("clip.mp4", file, { partSize: MiB }), TypeError);
	await assert.rejects(
		media.uploadLarge("other.mp4", file, { partSize: 5 * MiB, resumeUploadId: "u1" }),
		{ code: "upload_resume_mismatch" },
	);
});

await test("functions, vectors and embeddings call their public routes", async () => {
	const { client: sdk, requests } = client((request) => {
		if (request.url.pathname.startsWith("/v1/data/functions/hello"))
			return request.method === "GET"
				? new Response("plain", { headers: { "content-type": "text/plain" } })
				: Response.json({ greeting: "bonjour", data: 1 });
		if (request.url.pathname.startsWith("/v1/data/functions/broken"))
			return Response.json({ reason: "bad input" }, { status: 400 });
		return Response.json({
			model: "bge-m3",
			dimensions: 3,
			data: [{ index: 0, embedding: [1, 0, 0] }],
		});
	});
	assert.deepEqual(
		await sdk.functions.invoke("hello", {
			body: { name: "Ada" },
			path: "/greet/fr",
			query: { v: 2 },
		}),
		{ greeting: "bonjour", data: 1 },
	);
	assert.equal(await sdk.functions.invoke("hello", { method: "GET" }), "plain");
	await assert.rejects(sdk.functions.invoke("broken"), (error) => {
		assert.equal(error.code, "http_400");
		assert.deepEqual(error.details, { body: { reason: "bad input" } });
		return true;
	});
	const raw = await sdk.functions.invoke("broken", { raw: true });
	assert.equal(raw.status, 400);

	const docs = sdk.vectors.from("docs");
	await docs.upsert([{ id: "a", text: "hello", metadata: { lang: "en" } }]);
	await docs.query({ text: "hi", topK: 3, filter: { lang: "en" } });
	await docs.remove("a");
	const embedded = await sdk.ai.embeddings(["hello"]);
	assert.equal(embedded.model, "bge-m3");

	assert.deepEqual(
		requests.map((request) => `${request.method} ${request.url.pathname}${request.url.search}`),
		[
			"POST /v1/data/functions/hello/greet/fr?v=2",
			"GET /v1/data/functions/hello",
			"POST /v1/data/functions/broken",
			"POST /v1/data/functions/broken",
			"POST /v1/data/vectors/docs/upsert",
			"POST /v1/data/vectors/docs/query",
			"DELETE /v1/data/vectors/docs/a",
			"POST /v1/data/ai/embeddings",
		],
	);
	assert.deepEqual(JSON.parse(requests[0].text), { name: "Ada" });
	assert.equal(requests[1].body, undefined);
	assert.deepEqual(JSON.parse(requests[5].text), { text: "hi", top_k: 3, filter: { lang: "en" } });
	assert.deepEqual(JSON.parse(requests[7].text), { input: ["hello"] });
});

await test("a CAPTCHA token is sent only when the caller provides one", async () => {
	const { client: sdk, requests } = client(() => Response.json({ data: session }));
	await sdk.signIn("ada@example.test", "secret");
	await sdk.signIn("ada@example.test", "secret", { captchaToken: "turnstile-1" });
	await sdk.register({ email: "ada@example.test", password: "secret" });
	await sdk.register(
		{ email: "ada@example.test", password: "secret" },
		{ captchaToken: "turnstile-2" },
	);
	assert.deepEqual(
		requests.map((request) => JSON.parse(request.text)),
		[
			{ email: "ada@example.test", password: "secret" },
			{ email: "ada@example.test", password: "secret", captcha_token: "turnstile-1" },
			{ email: "ada@example.test", password: "secret" },
			{ email: "ada@example.test", password: "secret", captcha_token: "turnstile-2" },
		],
	);
	assert.throws(() => sdk.signIn("ada@example.test", "secret", { captchaToken: "" }), TypeError);
});
