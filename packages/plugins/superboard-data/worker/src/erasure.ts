import { physicalTable, quoteIdentifier } from "./database/schema.js";
import { filesBucket } from "./files-bucket.js";
import type { DataEnv } from "./platform/env.js";
import { objectKey } from "./storage/objects.js";

const BATCH = 90;

export interface ErasureSummary {
	rows: number;
	objects: number;
	uploads: number;
	vectors: number;
}

export interface ErasureResult {
	complete: boolean;
	summary: ErasureSummary;
}

export async function eraseApplicationUser(
	env: DataEnv,
	userId: string,
	deadline: number,
): Promise<ErasureResult> {
	const summary: ErasureSummary = { rows: 0, objects: 0, uploads: 0, vectors: 0 };
	const steps: [keyof ErasureSummary, () => Promise<number>][] = [
		["rows", () => eraseRows(env, userId, deadline)],
		["objects", () => eraseObjects(env, userId)],
		["uploads", () => eraseUploads(env, userId)],
		["vectors", () => eraseVectors(env, userId)],
	];
	for (const [name, step] of steps) {
		for (;;) {
			if (Date.now() >= deadline) return { complete: false, summary };
			const erased = await step();
			summary[name] += erased;
			if (erased === 0) break;
		}
	}
	return { complete: true, summary };
}

async function eraseRows(env: DataEnv, userId: string, deadline: number): Promise<number> {
	const { results: tables } = await env.DB.prepare(
		"SELECT project_id, name FROM data_tables ORDER BY project_id, name",
	)
		.bind()
		.all<{ project_id: number; name: string }>();
	let erased = 0;
	for (const table of tables) {
		if (Date.now() >= deadline) break;
		const quoted = quoteIdentifier(physicalTable(Number(table.project_id), table.name));
		const { results } = await env.DB.prepare(
			`DELETE FROM ${quoted} WHERE "id" IN (SELECT "id" FROM ${quoted} WHERE "owner_id" = ? LIMIT ?) RETURNING "id"`,
		)
			.bind(userId, BATCH * 10)
			.all();
		erased += results.length;
	}
	return erased;
}

async function eraseObjects(env: DataEnv, userId: string): Promise<number> {
	const { results } = await env.DB.prepare(
		"SELECT project_id, bucket, path FROM data_objects WHERE owner_id = ? LIMIT ?",
	)
		.bind(userId, BATCH)
		.all<{ project_id: number; bucket: string; path: string }>();
	if (results.length === 0) return 0;
	await filesBucket(env).delete(
		results.map((row) => objectKey(Number(row.project_id), row.bucket, row.path)),
	);
	await env.DB.batch(
		results.map((row) =>
			env.DB.prepare(
				"DELETE FROM data_objects WHERE project_id = ? AND bucket = ? AND path = ?",
			).bind(row.project_id, row.bucket, row.path),
		),
	);
	return results.length;
}

async function eraseUploads(env: DataEnv, userId: string): Promise<number> {
	const { results } = await env.DB.prepare(
		"SELECT id, project_id, bucket, path, r2_upload_id FROM data_uploads WHERE owner_id = ? LIMIT ?",
	)
		.bind(userId, BATCH)
		.all<{ id: string; project_id: number; bucket: string; path: string; r2_upload_id: string }>();
	for (const upload of results) {
		try {
			await filesBucket(env)
				.resumeMultipartUpload(
					objectKey(Number(upload.project_id), upload.bucket, upload.path),
					upload.r2_upload_id,
				)
				.abort();
		} catch (cause) {
			console.warn("[data-erasure] upload already closed", upload.id, cause);
		}
		await env.DB.batch([
			env.DB.prepare("DELETE FROM data_upload_parts WHERE upload_id = ?").bind(upload.id),
			env.DB.prepare("DELETE FROM data_uploads WHERE id = ?").bind(upload.id),
		]);
	}
	return results.length;
}

async function eraseVectors(env: DataEnv, userId: string): Promise<number> {
	const { results } = await env.DB.prepare(
		"SELECT vector_id FROM data_vector_items WHERE owner_id = ? LIMIT ?",
	)
		.bind(userId, BATCH)
		.all<{ vector_id: string }>();
	if (results.length === 0) return 0;
	const ids = results.map((row) => row.vector_id);
	if (env.VECTORS) await env.VECTORS.deleteByIds(ids);
	await env.DB.prepare(
		`DELETE FROM data_vector_items WHERE vector_id IN (${ids.map(() => "?").join(", ")})`,
	)
		.bind(...ids)
		.run();
	return ids.length;
}
