import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import type { Caller } from "../../../../../../packages/plugins/superboard-data/worker/src/platform/caller";
import type { DataEnv } from "../../../../../../packages/plugins/superboard-data/worker/src/platform/env";
import {
	EMBEDDING_DIMENSIONS,
	createCollection,
	deleteCollection,
	deleteItem,
	embeddings,
	queryItems,
	requireCollection,
	upsertItems,
} from "../../../../../../packages/plugins/superboard-data/worker/src/vectors/collections";
import { PROJECT_ID } from "./helpers";

const WORDS = ["chat", "chien", "voiture", "train", "pomme", "poire"];

function embed(text: string): number[] {
	const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
	for (const word of text.toLowerCase().split(/\W+/u)) {
		const index = WORDS.indexOf(word);
		if (index >= 0) vector[index] = 1;
	}
	vector[EMBEDDING_DIMENSIONS - 1] = 0.01;
	return vector;
}

function cosine(left: number[], right: number[]): number {
	let dot = 0;
	let a = 0;
	let b = 0;
	left.forEach((value, index) => {
		dot += value * right[index]!;
		a += value * value;
		b += right[index]! * right[index]!;
	});
	return dot / Math.sqrt(a * b);
}

class LocalVectorize {
	readonly vectors = new Map<string, VectorizeVector>();

	async upsert(vectors: VectorizeVector[]) {
		for (const vector of vectors) this.vectors.set(vector.id, vector);
		return { mutationId: "local" };
	}

	async deleteByIds(ids: string[]) {
		for (const id of ids) this.vectors.delete(id);
		return { mutationId: "local" };
	}

	async query(values: number[], options: VectorizeQueryOptions) {
		const matches = [...this.vectors.values()]
			.filter((vector) => vector.namespace === options.namespace)
			.filter((vector) =>
				Object.entries(options.filter ?? {}).every(
					([key, value]) => vector.metadata?.[key] === value,
				),
			)
			.map((vector) => ({ id: vector.id, score: cosine(values, [...(vector.values as number[])]) }))
			.sort((left, right) => right.score - left.score)
			.slice(0, options.topK ?? 5);
		return { matches, count: matches.length };
	}
}

const vectorize = new LocalVectorize();
const ai = {
	run: async (_model: string, input: { text: string[] }) => ({ data: input.text.map(embed) }),
};
const dataEnv = { ...env, AI: ai, VECTORS: vectorize } as unknown as DataEnv;
const user = (userId: string): Caller => ({
	projectId: PROJECT_ID,
	role: "authenticated",
	userId,
	keyId: null,
	operatorId: null,
});
const anonymous: Caller = {
	projectId: PROJECT_ID,
	role: "anon",
	userId: null,
	keyId: null,
	operatorId: null,
};

describe("Vector collections", () => {
	beforeAll(async () => {
		await createCollection(dataEnv, PROJECT_ID, { name: "notes" });
		await createCollection(dataEnv, PROJECT_ID, {
			name: "catalog",
			rules: { read: "public", write: "service" },
		});
	});

	it("indexes text and returns the closest items of the caller", async () => {
		const notes = await requireCollection(dataEnv, PROJECT_ID, "notes");
		await upsertItems(dataEnv, user("alice"), notes, {
			items: [
				{ id: "a1", text: "Mon chat et mon chien", metadata: { kind: "animal" } },
				{ id: "a2", text: "Le train et la voiture", metadata: { kind: "transport" } },
			],
		});
		await upsertItems(dataEnv, user("bob"), notes, { items: [{ id: "b1", text: "Un chat noir" }] });

		const result = await queryItems(dataEnv, user("alice"), notes, { text: "chat", top_k: 5 });
		expect(result.items.map((item) => item.id)).toEqual(["a1", "a2"]);
		expect(result.items[0]).toMatchObject({
			content: "Mon chat et mon chien",
			metadata: { kind: "animal" },
			owner_id: "alice",
		});
		const filtered = await queryItems(dataEnv, user("alice"), notes, {
			text: "chat",
			filter: { kind: "transport" },
		});
		expect(filtered.items.map((item) => item.id)).toEqual(["a2"]);
		const bob = await queryItems(dataEnv, user("bob"), notes, { text: "chat" });
		expect(bob.items.map((item) => item.id)).toEqual(["b1"]);
	});

	it("protects items owned by another user", async () => {
		const notes = await requireCollection(dataEnv, PROJECT_ID, "notes");
		await expect(
			upsertItems(dataEnv, user("bob"), notes, { items: [{ id: "a1", text: "pomme" }] }),
		).rejects.toMatchObject({ code: "access_denied" });
		await expect(deleteItem(dataEnv, user("bob"), notes, "a1")).rejects.toMatchObject({
			code: "item_not_found",
		});
		await deleteItem(dataEnv, user("alice"), notes, "a1");
		const result = await queryItems(dataEnv, user("alice"), notes, { text: "chat" });
		expect(result.items.map((item) => item.id)).toEqual(["a2"]);
	});

	it("applies collection rules to anonymous callers", async () => {
		const catalog = await requireCollection(dataEnv, PROJECT_ID, "catalog");
		const service: Caller = {
			projectId: PROJECT_ID,
			role: "service",
			userId: null,
			keyId: "key",
			operatorId: null,
		};
		await upsertItems(dataEnv, service, catalog, {
			items: [
				{ id: "p1", text: "pomme poire" },
				{ id: "p2", text: "train" },
			],
		});
		const result = await queryItems(dataEnv, anonymous, catalog, { text: "poire", top_k: 1 });
		expect(result.items.map((item) => item.id)).toEqual(["p1"]);
		await expect(
			upsertItems(dataEnv, anonymous, catalog, { items: [{ id: "x", text: "train" }] }),
		).rejects.toMatchObject({
			code: "access_denied",
		});
		await expect(embeddings(dataEnv, anonymous, { input: "chat" })).rejects.toMatchObject({
			code: "authentication_required",
		});
		const vectors = await embeddings(dataEnv, user("alice"), { input: ["chat", "train"] });
		expect(vectors.data).toHaveLength(2);
		expect(vectors.dimensions).toBe(EMBEDDING_DIMENSIONS);
	});

	it("validates items and reports a missing binding", async () => {
		const notes = await requireCollection(dataEnv, PROJECT_ID, "notes");
		await expect(
			upsertItems(dataEnv, user("alice"), notes, { items: [{ id: "bad id!", text: "x" }] }),
		).rejects.toMatchObject({
			code: "item_invalid",
		});
		await expect(
			upsertItems(dataEnv, user("alice"), notes, { items: [{ id: "v", values: [1, 2] }] }),
		).rejects.toMatchObject({
			code: "values_invalid",
		});
		const unbound = { ...env } as unknown as DataEnv;
		await expect(queryItems(unbound, user("alice"), notes, { text: "chat" })).rejects.toMatchObject(
			{
				code: "vectors_unavailable",
			},
		);
	});

	it("deletes a collection with its vectors", async () => {
		await expect(deleteCollection(dataEnv, PROJECT_ID, "notes", null)).rejects.toMatchObject({
			code: "confirmation_required",
		});
		await deleteCollection(dataEnv, PROJECT_ID, "notes", "notes");
		expect(
			[...vectorize.vectors.values()].some((vector) => vector.namespace === `p${PROJECT_ID}:notes`),
		).toBe(false);
		await expect(requireCollection(dataEnv, PROJECT_ID, "notes")).rejects.toMatchObject({
			code: "collection_not_found",
		});
	});
});
