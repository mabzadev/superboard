import { beforeAll, describe, expect, it } from "vitest";

import { jsonOf, operator, publicRequest, sdk } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function upload(
	path: string,
	user: string,
	bytes: Uint8Array,
	headers: Record<string, string> = {},
) {
	return sdk(`/v1/storage/object/${path}`, {
		method: "PUT",
		user,
		raw: bytes,
		headers: {
			"content-type": "image/png",
			"content-length": String(bytes.byteLength),
			...headers,
		},
	});
}

describe("Application storage", () => {
	beforeAll(async () => {
		for (const bucket of [
			{ name: "avatars", allowed_types: ["image/*"], max_bytes: 1_000_000 },
			{ name: "assets", public: true, rules: { write: "authenticated" } },
		]) {
			const response = await operator("/buckets", { method: "POST", body: bucket });
			expect(response.status).toBe(201);
		}
	});

	it("stores private objects that only their owner can read", async () => {
		const created = await upload("avatars/alice/me.png", "alice", PNG);
		expect(created.status).toBe(201);
		expect(await jsonOf(created)).toMatchObject({
			bucket: "avatars",
			path: "alice/me.png",
			owner_id: "alice",
			size: PNG.byteLength,
		});

		const read = await sdk("/v1/storage/object/avatars/alice/me.png", { user: "alice" });
		expect(read.status).toBe(200);
		expect(read.headers.get("content-type")).toBe("image/png");
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
		expect((await sdk("/v1/storage/object/avatars/alice/me.png", { user: "bob" })).status).toBe(
			404,
		);

		const partial = await sdk("/v1/storage/object/avatars/alice/me.png", {
			user: "alice",
			headers: { range: "bytes=0-3" },
		});
		expect(partial.status).toBe(206);
		expect(new Uint8Array(await partial.arrayBuffer())).toEqual(PNG.slice(0, 4));
	});

	it("refuses duplicates, wrong types and unsafe paths", async () => {
		expect((await upload("avatars/alice/me.png", "alice", PNG)).status).toBe(409);
		expect(
			(await upload("avatars/alice/me.png", "alice", PNG, { "x-upsert": "true" })).status,
		).toBe(201);
		expect((await upload("avatars/alice/me.png", "bob", PNG, { "x-upsert": "true" })).status).toBe(
			403,
		);
		const text = await upload("avatars/alice/notes.txt", "alice", PNG, {
			"content-type": "text/plain",
		});
		expect(text.status).toBe(415);
		const traversal = await upload("avatars/alice%2F..%2Fbob/x.png", "alice", PNG);
		expect(await jsonOf(traversal)).toMatchObject({ error: { code: "path_invalid" } });
	});

	it("lists objects by prefix for their owner", async () => {
		await upload("avatars/alice/second.png", "alice", PNG);
		await upload("avatars/bob/other.png", "bob", PNG);
		const listed = await jsonOf<{ items: { path: string }[] }>(
			await sdk("/v1/storage/list/avatars?prefix=alice/", { user: "alice" }),
		);
		expect(listed.items.map((item) => item.path)).toEqual(["alice/me.png", "alice/second.png"]);
		const bob = await jsonOf<{ items: { path: string }[] }>(
			await sdk("/v1/storage/list/avatars", { user: "bob" }),
		);
		expect(bob.items.map((item) => item.path)).toEqual(["bob/other.png"]);
	});

	it("serves signed URLs without credentials and rejects tampering", async () => {
		const signed = await jsonOf<{ url: string }>(
			await sdk("/v1/storage/sign/avatars/alice/me.png", {
				method: "POST",
				user: "alice",
				body: { expires_in: 120 },
			}),
		);
		const path = new URL(signed.url).pathname.replace(/^\/v1\/data/u, "/v1");
		const read = await publicRequest(path);
		expect(read.status).toBe(200);
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);
		const tampered = await publicRequest(`${path.slice(0, -3)}abc`);
		expect(tampered.status).toBe(401);
		const forbidden = await sdk("/v1/storage/sign/avatars/alice/me.png", {
			method: "POST",
			user: "bob",
			body: {},
		});
		expect(forbidden.status).toBe(404);
	});

	it("publishes objects of a public bucket without credentials", async () => {
		const response = await sdk("/v1/storage/object/assets/logo.png", {
			method: "PUT",
			user: "alice",
			raw: PNG,
			headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) },
		});
		expect(response.status).toBe(201);
		const published = await publicRequest("/v1/storage/public/12/assets/logo.png");
		expect(published.status).toBe(200);
		expect(published.headers.get("cache-control")).toContain("public");
		expect((await publicRequest("/v1/storage/public/12/avatars/alice/me.png")).status).toBe(404);
	});

	it("resumes and completes a multipart upload", async () => {
		const started = await sdk("/v1/storage/uploads/avatars", {
			method: "POST",
			user: "carol",
			body: { path: "carol/big.png", content_type: "image/png" },
		});
		expect(started.status).toBe(201);
		const { upload_id } = await jsonOf<{ upload_id: string }>(started);
		const part = await sdk(`/v1/storage/uploads/avatars/${upload_id}/1`, {
			method: "PUT",
			user: "carol",
			raw: PNG,
			headers: { "content-length": String(PNG.byteLength) },
		});
		expect(await jsonOf(part)).toMatchObject({ part_number: 1, size: PNG.byteLength });
		expect((await sdk(`/v1/storage/uploads/avatars/${upload_id}`, { user: "dave" })).status).toBe(
			404,
		);
		const status = await jsonOf<{ parts: unknown[] }>(
			await sdk(`/v1/storage/uploads/avatars/${upload_id}`, { user: "carol" }),
		);
		expect(status.parts).toHaveLength(1);
		const completed = await sdk(`/v1/storage/uploads/avatars/${upload_id}/complete`, {
			method: "POST",
			user: "carol",
		});
		expect(await jsonOf(completed)).toMatchObject({
			path: "carol/big.png",
			size: PNG.byteLength,
			owner_id: "carol",
		});
		const read = await sdk("/v1/storage/object/avatars/carol/big.png", { user: "carol" });
		expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);

		const abandoned = await jsonOf<{ upload_id: string }>(
			await sdk("/v1/storage/uploads/avatars", {
				method: "POST",
				user: "carol",
				body: { path: "carol/tmp.png", content_type: "image/png" },
			}),
		);
		expect(
			(
				await sdk(`/v1/storage/uploads/avatars/${abandoned.upload_id}`, {
					method: "DELETE",
					user: "carol",
				})
			).status,
		).toBe(200);
		expect(
			(await sdk(`/v1/storage/uploads/avatars/${abandoned.upload_id}`, { user: "carol" })).status,
		).toBe(404);
	});

	it("deletes objects and keeps non-empty buckets", async () => {
		expect((await operator("/buckets/assets?confirm=assets", { method: "DELETE" })).status).toBe(
			409,
		);
		expect(
			(await sdk("/v1/storage/object/avatars/alice/second.png", { method: "DELETE", user: "bob" }))
				.status,
		).toBe(404);
		expect(
			(
				await sdk("/v1/storage/object/avatars/alice/second.png", {
					method: "DELETE",
					user: "alice",
				})
			).status,
		).toBe(200);
		expect(
			(await sdk("/v1/storage/object/avatars/alice/second.png", { user: "alice" })).status,
		).toBe(404);
	});
});
