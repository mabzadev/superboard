import type { Caller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { DataError, boundedInteger, isRecord, nowIso, sha256Hex } from "../platform/http.js";
import { assertAllowed, ownerScope, parseAccessRule, type AccessRule } from "../platform/policy.js";

export const EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;

const NAME_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/u;
const ITEM_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAXIMUM_ITEMS = 50;
const MAXIMUM_TEXT_LENGTH = 8_000;
const MAXIMUM_METADATA_BYTES = 4_096;
const MAXIMUM_COLLECTIONS = 50;

export interface VectorCollection {
	name: string;
	rules: { read: AccessRule; write: AccessRule };
	item_count?: number;
	created_at: string;
	updated_at: string;
}

type CollectionRow = {
	name: string;
	read_rule: AccessRule;
	write_rule: AccessRule;
	created_at: string;
	updated_at: string;
	item_count?: number;
};

type ItemRow = {
	id: string;
	owner_id: string | null;
	content: string | null;
	metadata_json: string;
	vector_id: string;
	created_at: string;
	updated_at: string;
};

export function vectorsAvailable(env: DataEnv): boolean {
	return Boolean(env.AI && env.VECTORS);
}

export async function listCollections(
	env: DataEnv,
	projectId: number,
): Promise<VectorCollection[]> {
	const { results } = await env.DB.prepare(
		`SELECT c.name, c.read_rule, c.write_rule, c.created_at, c.updated_at,
		        (SELECT COUNT(*) FROM data_vector_items i WHERE i.project_id = c.project_id AND i.collection = c.name) AS item_count
		 FROM data_vector_collections c WHERE c.project_id = ? ORDER BY c.name`,
	)
		.bind(projectId)
		.all<CollectionRow>();
	return results.map(collectionFromRow);
}

export async function requireCollection(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<VectorCollection> {
	if (!NAME_PATTERN.test(name)) throw collectionNotFound(name);
	const row = await env.DB.prepare(
		"SELECT name, read_rule, write_rule, created_at, updated_at FROM data_vector_collections WHERE project_id = ? AND name = ?",
	)
		.bind(projectId, name)
		.first<CollectionRow>();
	if (!row) throw collectionNotFound(name);
	return collectionFromRow(row);
}

export async function createCollection(
	env: DataEnv,
	projectId: number,
	body: unknown,
): Promise<VectorCollection> {
	if (!isRecord(body) || typeof body.name !== "string" || !NAME_PATTERN.test(body.name))
		throw new DataError(
			422,
			"collection_name_invalid",
			"A collection name contains up to 40 lowercase letters, digits, dashes or underscores",
		);
	const count = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM data_vector_collections WHERE project_id = ?",
	)
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(count?.total ?? 0) >= MAXIMUM_COLLECTIONS)
		throw new DataError(
			409,
			"collection_limit",
			`A project has at most ${MAXIMUM_COLLECTIONS} collections`,
		);
	const rules = parseRules(body.rules, { read: "owner", write: "owner" });
	const now = nowIso();
	try {
		await env.DB.prepare(
			"INSERT INTO data_vector_collections (project_id, name, read_rule, write_rule, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(projectId, body.name, rules.read, rules.write, now, now)
			.run();
	} catch (cause) {
		if (String(cause).includes("UNIQUE"))
			throw new DataError(409, "collection_exists", `Collection ${body.name} already exists`);
		throw cause;
	}
	return requireCollection(env, projectId, body.name);
}

export async function updateCollection(
	env: DataEnv,
	projectId: number,
	name: string,
	body: unknown,
): Promise<VectorCollection> {
	const current = await requireCollection(env, projectId, name);
	const rules = parseRules(isRecord(body) ? body.rules : undefined, current.rules);
	await env.DB.prepare(
		"UPDATE data_vector_collections SET read_rule = ?, write_rule = ?, updated_at = ? WHERE project_id = ? AND name = ?",
	)
		.bind(rules.read, rules.write, nowIso(), projectId, name)
		.run();
	return requireCollection(env, projectId, name);
}

export async function deleteCollection(
	env: DataEnv,
	projectId: number,
	name: string,
	confirmation: string | null,
): Promise<void> {
	await requireCollection(env, projectId, name);
	if (confirmation !== name)
		throw new DataError(
			422,
			"confirmation_required",
			`Pass confirm=${name} to delete this collection`,
		);
	while (true) {
		const { results } = await env.DB.prepare(
			"SELECT vector_id FROM data_vector_items WHERE project_id = ? AND collection = ? LIMIT 500",
		)
			.bind(projectId, name)
			.all<{ vector_id: string }>();
		if (results.length === 0) break;
		const ids = results.map((row) => row.vector_id);
		if (env.VECTORS) await env.VECTORS.deleteByIds(ids);
		for (let index = 0; index < ids.length; index += 90) {
			const chunk = ids.slice(index, index + 90);
			await env.DB.prepare(
				`DELETE FROM data_vector_items WHERE vector_id IN (${chunk.map(() => "?").join(", ")})`,
			)
				.bind(...chunk)
				.run();
		}
	}
	await env.DB.prepare("DELETE FROM data_vector_collections WHERE project_id = ? AND name = ?")
		.bind(projectId, name)
		.run();
}

export async function embedTexts(env: DataEnv, texts: string[]): Promise<number[][]> {
	if (!env.AI) throw unavailable();
	if (texts.length === 0) return [];
	const output = (await env.AI.run(
		EMBEDDING_MODEL as keyof AiModels,
		{ text: texts } as never,
	)) as {
		data?: number[][];
	};
	if (!Array.isArray(output.data) || output.data.length !== texts.length)
		throw new DataError(
			502,
			"embedding_failed",
			"The embedding model returned an unexpected result",
		);
	return output.data;
}

export async function upsertItems(
	env: DataEnv,
	caller: Caller,
	collection: VectorCollection,
	body: unknown,
): Promise<{ items: { id: string }[] }> {
	const index = vectorIndex(env);
	assertAllowed(collection.rules.write, caller, "write to this collection");
	if (
		!isRecord(body) ||
		!Array.isArray(body.items) ||
		body.items.length === 0 ||
		body.items.length > MAXIMUM_ITEMS
	)
		throw new DataError(422, "items_invalid", `Send 1 to ${MAXIMUM_ITEMS} items`);
	const items = body.items.map(parseItem);
	const existing = await existingItems(
		env,
		caller.projectId,
		collection.name,
		items.map((item) => item.id),
	);
	const owner = ownerScope(collection.rules.write, caller);
	for (const item of items) {
		const previous = existing.get(item.id);
		if (previous && owner !== null && previous.owner_id !== owner)
			throw new DataError(403, "access_denied", `Item ${item.id} belongs to another user`);
	}
	const pending = items.flatMap((item) =>
		item.values || item.text === undefined ? [] : [{ item, text: item.text }],
	);
	const computed = await embedTexts(
		env,
		pending.map((entry) => entry.text),
	);
	pending.forEach((entry, index) => {
		entry.item.values = computed[index];
	});
	const now = nowIso();
	const vectors: VectorizeVector[] = [];
	const statements: D1PreparedStatement[] = [];
	for (const item of items) {
		const vectorId = await vectorIdentifier(caller.projectId, collection.name, item.id);
		const ownerId = existing.get(item.id)?.owner_id ?? caller.userId;
		if (!item.values) throw new DataError(502, "embedding_failed", "An item could not be embedded");
		vectors.push({
			id: vectorId,
			values: item.values,
			namespace: namespace(caller.projectId, collection.name),
			metadata: { owner: ownerId ?? "" },
		});
		statements.push(
			env.DB.prepare(
				`INSERT INTO data_vector_items (project_id, collection, id, owner_id, content, metadata_json, vector_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(project_id, collection, id) DO UPDATE SET content = excluded.content,
				   metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
			).bind(
				caller.projectId,
				collection.name,
				item.id,
				ownerId,
				item.text ?? null,
				JSON.stringify(item.metadata),
				vectorId,
				now,
				now,
			),
		);
	}
	await index.upsert(vectors);
	await env.DB.batch(statements);
	return { items: items.map((item) => ({ id: item.id })) };
}

export async function queryItems(
	env: DataEnv,
	caller: Caller,
	collection: VectorCollection,
	body: unknown,
): Promise<{
	items: {
		id: string;
		score: number;
		content: string | null;
		metadata: unknown;
		owner_id: string | null;
	}[];
}> {
	const index = vectorIndex(env);
	assertAllowed(collection.rules.read, caller, "read this collection");
	if (!isRecord(body)) throw new DataError(422, "query_invalid", "Body must be an object");
	const topK = boundedInteger(
		body.top_k === undefined ? null : String(body.top_k),
		10,
		1,
		50,
		"top_k_invalid",
	);
	let vector: number[] | undefined;
	if (Array.isArray(body.values)) vector = parseValues(body.values);
	else if (
		typeof body.text === "string" &&
		body.text.trim() &&
		body.text.length <= MAXIMUM_TEXT_LENGTH
	)
		[vector] = await embedTexts(env, [body.text]);
	if (!vector) throw new DataError(422, "query_invalid", "Provide text or values");
	const filter = body.filter === undefined ? {} : parseMetadata(body.filter);
	const owner = ownerScope(collection.rules.read, caller);
	const matches = await index.query(vector, {
		topK: Math.min(90, topK * 4),
		namespace: namespace(caller.projectId, collection.name),
		returnValues: false,
		returnMetadata: "none",
		...(owner !== null ? { filter: { owner } } : {}),
	});
	const ids = matches.matches.map((match) => match.id);
	if (ids.length === 0) return { items: [] };
	const { results } = await env.DB.prepare(
		`SELECT id, owner_id, content, metadata_json, vector_id, created_at, updated_at FROM data_vector_items
		 WHERE project_id = ? AND collection = ? AND vector_id IN (${ids.map(() => "?").join(", ")})`,
	)
		.bind(caller.projectId, collection.name, ...ids)
		.all<ItemRow>();
	const rows = new Map(results.map((row) => [row.vector_id, row]));
	const items = [];
	for (const match of matches.matches) {
		const row = rows.get(match.id);
		if (!row || (owner !== null && row.owner_id !== owner)) continue;
		const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
		if (!Object.entries(filter).every(([key, value]) => metadata[key] === value)) continue;
		items.push({
			id: row.id,
			score: match.score,
			content: row.content,
			metadata,
			owner_id: row.owner_id,
		});
		if (items.length === topK) break;
	}
	return { items };
}

export async function deleteItem(
	env: DataEnv,
	caller: Caller,
	collection: VectorCollection,
	id: string,
): Promise<void> {
	const index = vectorIndex(env);
	assertAllowed(collection.rules.write, caller, "write to this collection");
	const row = (await existingItems(env, caller.projectId, collection.name, [id])).get(id);
	const owner = ownerScope(collection.rules.write, caller);
	if (!row || (owner !== null && row.owner_id !== owner))
		throw new DataError(404, "item_not_found", "Item does not exist");
	await index.deleteByIds([row.vector_id]);
	await env.DB.prepare(
		"DELETE FROM data_vector_items WHERE project_id = ? AND collection = ? AND id = ?",
	)
		.bind(caller.projectId, collection.name, id)
		.run();
}

export async function embeddings(env: DataEnv, caller: Caller, body: unknown) {
	if (!env.AI) throw unavailable();
	if (caller.role === "anon")
		throw new DataError(401, "authentication_required", "Sign in to create embeddings");
	const input = isRecord(body) ? body.input : undefined;
	const texts = typeof input === "string" ? [input] : input;
	if (
		!Array.isArray(texts) ||
		texts.length === 0 ||
		texts.length > MAXIMUM_ITEMS ||
		texts.some(
			(text) => typeof text !== "string" || !text.trim() || text.length > MAXIMUM_TEXT_LENGTH,
		)
	)
		throw new DataError(422, "input_invalid", `input is a string or 1 to ${MAXIMUM_ITEMS} strings`);
	const vectors = await embedTexts(env, texts as string[]);
	return {
		model: EMBEDDING_MODEL,
		dimensions: EMBEDDING_DIMENSIONS,
		data: vectors.map((embedding, index) => ({ index, embedding })),
	};
}

function parseItem(value: unknown): {
	id: string;
	text?: string;
	values?: number[];
	metadata: Record<string, unknown>;
} {
	if (!isRecord(value) || typeof value.id !== "string" || !ITEM_ID_PATTERN.test(value.id))
		throw new DataError(
			422,
			"item_invalid",
			"Each item has an id of up to 128 letters, digits, dots, colons or dashes",
		);
	const text = value.text;
	if (
		text !== undefined &&
		(typeof text !== "string" || !text.trim() || text.length > MAXIMUM_TEXT_LENGTH)
	)
		throw new DataError(422, "item_invalid", `text has 1 to ${MAXIMUM_TEXT_LENGTH} characters`);
	const values = value.values === undefined ? undefined : parseValues(value.values);
	if (text === undefined && !values)
		throw new DataError(422, "item_invalid", "Each item needs text or values");
	return {
		id: value.id,
		...(text === undefined ? {} : { text }),
		...(values ? { values } : {}),
		metadata: value.metadata === undefined ? {} : parseMetadata(value.metadata),
	};
}

function parseValues(value: unknown): number[] {
	if (
		!Array.isArray(value) ||
		value.length !== EMBEDDING_DIMENSIONS ||
		value.some((item) => typeof item !== "number" || !Number.isFinite(item))
	)
		throw new DataError(422, "values_invalid", `values has ${EMBEDDING_DIMENSIONS} finite numbers`);
	return value as number[];
}

function parseMetadata(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) throw new DataError(422, "metadata_invalid", "metadata must be an object");
	if (JSON.stringify(value).length > MAXIMUM_METADATA_BYTES)
		throw new DataError(
			422,
			"metadata_invalid",
			`metadata has at most ${MAXIMUM_METADATA_BYTES} bytes`,
		);
	for (const item of Object.values(value))
		if (item !== null && !["string", "number", "boolean"].includes(typeof item))
			throw new DataError(
				422,
				"metadata_invalid",
				"metadata values are strings, numbers, booleans or null",
			);
	return value;
}

function parseRules(value: unknown, fallback: { read: AccessRule; write: AccessRule }) {
	if (value === undefined) return { ...fallback };
	if (!isRecord(value)) throw new DataError(422, "rules_invalid", "rules must be an object");
	return {
		read: value.read === undefined ? fallback.read : parseAccessRule(value.read, "rules.read"),
		write: value.write === undefined ? fallback.write : parseAccessRule(value.write, "rules.write"),
	};
}

async function existingItems(env: DataEnv, projectId: number, collection: string, ids: string[]) {
	const { results } = await env.DB.prepare(
		`SELECT id, owner_id, content, metadata_json, vector_id, created_at, updated_at FROM data_vector_items
		 WHERE project_id = ? AND collection = ? AND id IN (${ids.map(() => "?").join(", ")})`,
	)
		.bind(projectId, collection, ...ids)
		.all<ItemRow>();
	return new Map(results.map((row) => [row.id, row]));
}

function namespace(projectId: number, collection: string): string {
	return `p${projectId}:${collection}`;
}

function vectorIdentifier(projectId: number, collection: string, id: string): Promise<string> {
	return sha256Hex(`${projectId}:${collection}:${id}`);
}

function collectionFromRow(row: CollectionRow): VectorCollection {
	return {
		name: row.name,
		rules: { read: row.read_rule, write: row.write_rule },
		...(row.item_count === undefined ? {} : { item_count: Number(row.item_count) }),
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function collectionNotFound(name: string) {
	return new DataError(404, "collection_not_found", `Collection ${name} does not exist`);
}

function vectorIndex(env: DataEnv): Vectorize {
	if (!env.AI || !env.VECTORS) throw unavailable();
	return env.VECTORS;
}

function unavailable() {
	return new DataError(
		503,
		"vectors_unavailable",
		"Vector search is not configured for this environment",
	);
}
