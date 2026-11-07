import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import { R2Storage } from "../../../../../packages/cloudflare/src/storage/r2.js";

describe("R2Storage same-key upload", () => {
	it("replaces the object bytes without changing the key", async () => {
		const objects = new Map<string, Uint8Array>();
		const cacheControls: string[] = [];
		const bucket = {
			async put(key: string, body: Uint8Array, options: R2PutOptions) {
				objects.set(key, body);
				const metadata = options.httpMetadata;
				cacheControls.push(
					metadata instanceof Headers
						? (metadata.get("Cache-Control") ?? "")
						: (metadata?.cacheControl ?? ""),
				);
				return { size: body.byteLength };
			},
		} as unknown as R2Bucket;
		const storage = new R2Storage(bucket);

		await storage.upload({
			key: "hero.png",
			body: new Uint8Array([1, 2, 3]),
			contentType: "image/png",
			cacheControl: "public, max-age=0, must-revalidate",
		});
		await storage.upload({
			key: "hero.png",
			body: new Uint8Array([9, 8]),
			contentType: "image/png",
			cacheControl: "public, max-age=0, must-revalidate",
		});

		expect(objects.get("hero.png")).toEqual(new Uint8Array([9, 8]));
		expect(cacheControls).toEqual([
			"public, max-age=0, must-revalidate",
			"public, max-age=0, must-revalidate",
		]);
	});
});

describe("R2Storage ranged download", () => {
	it("describes the requested bytes when R2 doesn't report the range it read", async () => {
		const bucket = {
			async get() {
				return { body: new Blob(["789"]).stream(), size: 10, httpMetadata: {} };
			},
		} as unknown as R2Bucket;

		const result = await new R2Storage(bucket).download("clip.mp4", { range: { suffix: 3 } });

		expect(result.size).toBe(10);
		expect(result.range).toEqual({ offset: 7, length: 3 });
	});
});

function memoryBucket(initial: Record<string, string> = {}) {
	const objects = new Map<string, Uint8Array>(
		Object.entries(initial).map(([key, value]) => [key, new TextEncoder().encode(value)]),
	);
	const entry = (key: string) => {
		const body = objects.get(key);
		return body
			? { key, size: body.byteLength, uploaded: new Date(0), etag: key, httpMetadata: {} }
			: null;
	};
	const bucket = {
		async put(key: string, body: Uint8Array) {
			objects.set(key, body);
			return { size: body.byteLength };
		},
		async get(key: string) {
			const object = entry(key);
			return object && { ...object, body: new Blob([new Uint8Array(objects.get(key)!)]).stream() };
		},
		async head(key: string) {
			return entry(key);
		},
		async delete(key: string) {
			objects.delete(key);
		},
		async list(options: { prefix?: string } = {}) {
			const keys = [...objects.keys()].filter((key) => key.startsWith(options.prefix ?? ""));
			return { objects: keys.map((key) => entry(key)), truncated: false };
		},
	} as unknown as R2Bucket;
	return { bucket, objects };
}

describe("R2Storage key prefix", () => {
	it("stores and reads objects under the prefix while callers keep flat keys", async () => {
		const { bucket, objects } = memoryBucket();
		const storage = new R2Storage(bucket, undefined, "site/");

		const uploaded = await storage.upload({
			key: "hero.png",
			body: new Uint8Array([1, 2, 3]),
			contentType: "image/png",
		});

		expect(uploaded.key).toBe("hero.png");
		expect([...objects.keys()]).toEqual(["site/hero.png"]);
		expect(await storage.exists("hero.png")).toBe(true);
		expect((await storage.download("hero.png")).size).toBe(3);

		await storage.delete("hero.png");
		expect(objects.size).toBe(0);
	});

	it("lists only the prefixed objects and returns their keys without the prefix", async () => {
		const { bucket } = memoryBucket({
			"site/hero.png": "a",
			"site/backups/2026-11-07.json": "b",
			"support/ticket.pdf": "c",
		});
		const storage = new R2Storage(bucket, undefined, "site/");

		expect((await storage.list()).files.map((file) => file.key)).toEqual([
			"hero.png",
			"backups/2026-11-07.json",
		]);
		expect((await storage.list({ prefix: "backups/" })).files.map((file) => file.key)).toEqual([
			"backups/2026-11-07.json",
		]);
	});

	it("includes the prefix in public bucket URLs but not in EmDash media routes", () => {
		const { bucket } = memoryBucket();

		expect(new R2Storage(bucket, "https://cdn.example.com/", "site").getPublicUrl("a.png")).toBe(
			"https://cdn.example.com/site/a.png",
		);
		expect(new R2Storage(bucket, undefined, "site/").getPublicUrl("a.png")).toBe(
			"/_emdash/api/media/file/a.png",
		);
	});

	it("rejects prefixes that escape the bucket root", () => {
		const { bucket } = memoryBucket();

		expect(() => new R2Storage(bucket, undefined, "/site/")).toThrow();
		expect(() => new R2Storage(bucket, undefined, "site/../support/")).toThrow();
	});
});
