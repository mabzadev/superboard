import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord, nowIso } from "../platform/http.js";
import { parseAccessRule, type AccessRule } from "../platform/policy.js";

export const MAXIMUM_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
export const MAXIMUM_REQUEST_BYTES = 100 * 1024 * 1024;
const DEFAULT_BUCKET_BYTES = 50 * 1024 * 1024;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+)$/u;
const MAXIMUM_BUCKETS = 100;

export interface BucketRules {
	read: AccessRule;
	write: AccessRule;
	delete: AccessRule;
}

export interface Bucket {
	name: string;
	public: boolean;
	max_bytes: number;
	allowed_types: string[];
	rules: BucketRules;
	created_at: string;
	updated_at: string;
}

type BucketRow = {
	name: string;
	public: number;
	max_bytes: number;
	allowed_types_json: string;
	read_rule: AccessRule;
	write_rule: AccessRule;
	delete_rule: AccessRule;
	created_at: string;
	updated_at: string;
};

export async function listBuckets(env: DataEnv, projectId: number): Promise<Bucket[]> {
	const { results } = await env.DB.prepare(
		"SELECT * FROM data_buckets WHERE project_id = ? ORDER BY name",
	)
		.bind(projectId)
		.all<BucketRow>();
	return results.map(bucketFromRow);
}

export async function getBucket(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<Bucket | null> {
	if (!NAME_PATTERN.test(name)) return null;
	const row = await env.DB.prepare("SELECT * FROM data_buckets WHERE project_id = ? AND name = ?")
		.bind(projectId, name)
		.first<BucketRow>();
	return row ? bucketFromRow(row) : null;
}

export async function requireBucket(
	env: DataEnv,
	projectId: number,
	name: string,
): Promise<Bucket> {
	const bucket = await getBucket(env, projectId, name);
	if (!bucket) throw new DataError(404, "bucket_not_found", `Bucket ${name} does not exist`);
	return bucket;
}

export async function createBucket(
	env: DataEnv,
	projectId: number,
	body: unknown,
): Promise<Bucket> {
	if (!isRecord(body)) throw new DataError(422, "bucket_invalid", "Body must be an object");
	if (typeof body.name !== "string" || !NAME_PATTERN.test(body.name))
		throw new DataError(
			422,
			"bucket_name_invalid",
			"A bucket name contains up to 63 lowercase letters, digits, dashes or underscores",
		);
	const count = await env.DB.prepare(
		"SELECT COUNT(*) AS total FROM data_buckets WHERE project_id = ?",
	)
		.bind(projectId)
		.first<{ total: number }>();
	if (Number(count?.total ?? 0) >= MAXIMUM_BUCKETS)
		throw new DataError(409, "bucket_limit", `A project has at most ${MAXIMUM_BUCKETS} buckets`);
	if (await getBucket(env, projectId, body.name))
		throw new DataError(409, "bucket_exists", `Bucket ${body.name} already exists`);
	const settings = bucketSettings(body, {
		public: false,
		max_bytes: DEFAULT_BUCKET_BYTES,
		allowed_types: [],
		rules: { read: "owner", write: "owner", delete: "owner" },
	});
	const now = nowIso();
	await env.DB.prepare(
		`INSERT INTO data_buckets (project_id, name, public, max_bytes, allowed_types_json, read_rule, write_rule, delete_rule, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			projectId,
			body.name,
			settings.public ? 1 : 0,
			settings.max_bytes,
			JSON.stringify(settings.allowed_types),
			settings.rules.read,
			settings.rules.write,
			settings.rules.delete,
			now,
			now,
		)
		.run();
	return requireBucket(env, projectId, body.name);
}

export async function updateBucket(
	env: DataEnv,
	projectId: number,
	name: string,
	body: unknown,
): Promise<Bucket> {
	const current = await requireBucket(env, projectId, name);
	if (!isRecord(body)) throw new DataError(422, "bucket_invalid", "Body must be an object");
	const settings = bucketSettings(body, current);
	await env.DB.prepare(
		`UPDATE data_buckets SET public = ?, max_bytes = ?, allowed_types_json = ?, read_rule = ?, write_rule = ?, delete_rule = ?, updated_at = ?
		 WHERE project_id = ? AND name = ?`,
	)
		.bind(
			settings.public ? 1 : 0,
			settings.max_bytes,
			JSON.stringify(settings.allowed_types),
			settings.rules.read,
			settings.rules.write,
			settings.rules.delete,
			nowIso(),
			projectId,
			name,
		)
		.run();
	return requireBucket(env, projectId, name);
}

export async function deleteBucket(
	env: DataEnv,
	projectId: number,
	name: string,
	confirmation: string | null,
): Promise<void> {
	await requireBucket(env, projectId, name);
	if (confirmation !== name)
		throw new DataError(422, "confirmation_required", `Pass confirm=${name} to delete this bucket`);
	const used = await env.DB.prepare(
		"SELECT 1 AS present FROM data_objects WHERE project_id = ? AND bucket = ? LIMIT 1",
	)
		.bind(projectId, name)
		.first();
	if (used) throw new DataError(409, "bucket_not_empty", "Delete the objects of this bucket first");
	await env.DB.prepare("DELETE FROM data_buckets WHERE project_id = ? AND name = ?")
		.bind(projectId, name)
		.run();
}

export function contentTypeAllowed(bucket: Bucket, contentType: string): boolean {
	if (bucket.allowed_types.length === 0) return true;
	const family = contentType.slice(0, contentType.indexOf("/"));
	return bucket.allowed_types.some((rule) => rule === contentType || rule === `${family}/*`);
}

function bucketSettings(
	body: Record<string, unknown>,
	fallback: Pick<Bucket, "public" | "max_bytes" | "allowed_types" | "rules">,
): Pick<Bucket, "public" | "max_bytes" | "allowed_types" | "rules"> {
	const isPublic = body.public === undefined ? fallback.public : body.public;
	if (typeof isPublic !== "boolean")
		throw new DataError(422, "bucket_invalid", "public must be a boolean");
	const maximum = body.max_bytes === undefined ? fallback.max_bytes : body.max_bytes;
	if (
		typeof maximum !== "number" ||
		!Number.isSafeInteger(maximum) ||
		maximum < 1 ||
		maximum > MAXIMUM_OBJECT_BYTES
	)
		throw new DataError(
			422,
			"bucket_invalid",
			`max_bytes is between 1 and ${MAXIMUM_OBJECT_BYTES}`,
		);
	const types = body.allowed_types === undefined ? fallback.allowed_types : body.allowed_types;
	if (
		!Array.isArray(types) ||
		types.length > 50 ||
		types.some((type) => typeof type !== "string" || !TYPE_PATTERN.test(type))
	)
		throw new DataError(422, "bucket_invalid", "allowed_types lists media types such as image/*");
	const rulesInput = isRecord(body.rules) ? body.rules : {};
	const rules: BucketRules = {
		read:
			rulesInput.read === undefined
				? fallback.rules.read
				: parseAccessRule(rulesInput.read, "rules.read"),
		write:
			rulesInput.write === undefined
				? fallback.rules.write
				: parseAccessRule(rulesInput.write, "rules.write"),
		delete:
			rulesInput.delete === undefined
				? fallback.rules.delete
				: parseAccessRule(rulesInput.delete, "rules.delete"),
	};
	if (isPublic) rules.read = "public";
	else if (fallback.public && rulesInput.read === undefined) rules.read = "owner";
	return {
		public: isPublic,
		max_bytes: maximum,
		allowed_types: [...new Set(types as string[])],
		rules,
	};
}

function bucketFromRow(row: BucketRow): Bucket {
	return {
		name: row.name,
		public: Number(row.public) === 1,
		max_bytes: Number(row.max_bytes),
		allowed_types: JSON.parse(row.allowed_types_json) as string[],
		rules: { read: row.read_rule, write: row.write_rule, delete: row.delete_rule },
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}
