import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { ensureTable, jsonOf, operator, publicRequest, sdk } from "./helpers";

describe("Account erasure", () => {
	it("removes the rows, objects and uploads of an erased application user", async () => {
		await ensureTable({ name: "journal", columns: [{ name: "entry", type: "text" }] });
		await operator("/buckets", { method: "POST", body: { name: "private-notes" } });
		for (const user of ["zoe", "yann"])
			await sdk("/v1/db/journal", { method: "POST", user, body: { entry: `${user} wrote` } });
		const bytes = new TextEncoder().encode("secret");
		const stored = await sdk("/v1/storage/object/private-notes/zoe/diary.txt", {
			method: "PUT",
			user: "zoe",
			raw: bytes,
			headers: { "content-type": "text/plain", "content-length": String(bytes.byteLength) },
		});
		expect(stored.status).toBe(201);
		await sdk("/v1/storage/uploads/private-notes", {
			method: "POST",
			user: "zoe",
			body: { path: "zoe/big.txt", content_type: "text/plain" },
		});

		const erased = await publicRequest("/internal/v1/users/zoe", {
			method: "DELETE",
			headers: { "x-internal-token": env.FILES_INTERNAL_TOKEN },
		});
		expect(await jsonOf(erased)).toEqual({
			deleted: 0,
			data: { rows: 1, objects: 1, uploads: 1, vectors: 0 },
		});
		const remaining = await jsonOf<{ items: { entry: string }[] }>(
			await operator("/tables/journal/rows"),
		);
		expect(remaining.items.map((item) => item.entry)).toEqual(["yann wrote"]);
		expect(await env.FILES.head("files/storage/12/private-notes/zoe/diary.txt")).toBeNull();
		expect(
			(await sdk("/v1/storage/object/private-notes/zoe/diary.txt", { user: "zoe" })).status,
		).toBe(404);
	});

	it("requires the internal token", async () => {
		const response = await publicRequest("/internal/v1/users/zoe", { method: "DELETE" });
		expect(response.status).toBe(401);
	});
});
