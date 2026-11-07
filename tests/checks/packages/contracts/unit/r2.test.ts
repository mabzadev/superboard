import { describe, expect, it } from "vitest";

import { R2_FOLDERS, scopedR2Bucket } from "../../../../../packages/contracts/src/r2";

class MemoryObject {
	constructor(
		readonly key: string,
		readonly size: number,
	) {}

	describe() {
		return `${this.key}:${this.size}`;
	}
}

function memoryBucket(keys: string[] = []) {
	const objects = new Map(keys.map((key) => [key, new MemoryObject(key, 1)]));
	const calls: string[] = [];
	return {
		objects,
		calls,
		bucket: {
			async head(key: string) {
				calls.push(`head ${key}`);
				return objects.get(key) ?? null;
			},
			async get(key: string, options?: { range?: { offset: number } }) {
				calls.push(`get ${key}${options?.range ? ` range=${options.range.offset}` : ""}`);
				return objects.get(key) ?? null;
			},
			async put(key: string, value: string) {
				const object = new MemoryObject(key, value.length);
				objects.set(key, object);
				return object;
			},
			async delete(keys: string | string[]) {
				for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
			},
			async list(options: { prefix?: string; delimiter?: string } = {}) {
				const prefix = options.prefix ?? "";
				const matching = [...objects.values()].filter((object) => object.key.startsWith(prefix));
				if (!options.delimiter) {
					return { objects: matching, delimitedPrefixes: [], truncated: false };
				}
				const direct = matching.filter((object) => !object.key.slice(prefix.length).includes("/"));
				const folders = new Set(
					matching
						.map((object) => object.key.slice(prefix.length))
						.filter((rest) => rest.includes("/"))
						.map((rest) => `${prefix}${rest.slice(0, rest.indexOf("/") + 1)}`),
				);
				return { objects: direct, delimitedPrefixes: [...folders], truncated: false };
			},
		},
	};
}

describe("scopedR2Bucket", () => {
	it("keeps each module's objects inside its folder of the shared bucket", async () => {
		const { bucket, objects } = memoryBucket();
		const support = scopedR2Bucket(bucket, R2_FOLDERS.support);
		const analytics = scopedR2Bucket(bucket, R2_FOLDERS.analytics);

		await support.put("exports/p1/job.json", "{}");
		await analytics.put("exports/p1/job.json", "[]");

		expect([...objects.keys()].sort()).toEqual([
			"analytics/exports/p1/job.json",
			"support/exports/p1/job.json",
		]);
		expect((await support.head("exports/p1/job.json"))?.size).toBe(2);
		expect((await analytics.head("exports/p1/job.json"))?.size).toBe(2);
		expect(await support.get("missing")).toBeNull();
	});

	it("forwards read options and deletes single keys or batches within the folder", async () => {
		const { bucket, calls, objects } = memoryBucket([
			"files/a.csv",
			"files/b.csv",
			"files/c.csv",
			"site/a.csv",
		]);
		const files = scopedR2Bucket(bucket, R2_FOLDERS.files);

		await files.get("a.csv", { range: { offset: 4 } });
		await files.delete("a.csv");
		await files.delete(["b.csv", "c.csv"]);

		expect(calls).toEqual(["get files/a.csv range=4"]);
		expect([...objects.keys()]).toEqual(["site/a.csv"]);
	});

	it("lists only the folder and returns keys and prefixes relative to it", async () => {
		const { bucket } = memoryBucket([
			"files/report.csv",
			"files/purchases/p1/day.csv",
			"site/hero.png",
			"backups/prod/1.sql.enc",
		]);
		const files = scopedR2Bucket(bucket, R2_FOLDERS.files);

		const listed = await files.list({ delimiter: "/" });

		expect(listed.objects.map((object) => object.key)).toEqual(["report.csv"]);
		expect(listed.objects[0]?.describe()).toBe("files/report.csv:1");
		expect(listed.delimitedPrefixes).toEqual(["purchases/"]);
		expect(
			(await files.list({ prefix: "purchases/" })).objects.map((object) => object.key),
		).toEqual(["purchases/p1/day.csv"]);
	});
});
