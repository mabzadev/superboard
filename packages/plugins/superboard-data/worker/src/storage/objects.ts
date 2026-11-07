import { filesBucket } from "../files-bucket.js";
import type { Caller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { DataError, boundedInteger, isRecord, nowIso } from "../platform/http.js";
import { assertAllowed, ownerScope } from "../platform/policy.js";
import { MAXIMUM_REQUEST_BYTES, contentTypeAllowed, type Bucket } from "./buckets.js";

interface StoredObject {
	bucket: string;
	path: string;
	owner_id: string | null;
	content_type: string;
	size: number;
	etag: string;
	created_at: string;
	updated_at: string;
}

type ObjectRow = Omit<StoredObject, "size"> & { byte_size: number };

// oxlint-disable-next-line no-control-regex -- Object paths exclude control characters.
const PATH_PATTERN = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\x00-\x1f\x7f\\]{1,512}$/u;
const CONTENT_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const MINIMUM_PART_BYTES = 5 * 1024 * 1024;
const IMAGE_FITS = ["scale-down", "contain", "cover", "crop", "pad"] as const;
const UPLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

const MAXIMUM_PATH_BYTES = 900;

export function assertPath(path: string): void {
	if (!PATH_PATTERN.test(path) || new TextEncoder().encode(path).byteLength > MAXIMUM_PATH_BYTES)
		throw new DataError(422, "path_invalid", "Object path is invalid", { path });
}

export function objectKey(projectId: number, bucket: string, path: string): string {
	return `storage/${projectId}/${bucket}/${path}`;
}

function contentType(value: string | null | undefined): string {
	const [base = ""] = (value ?? "application/octet-stream").split(";", 1);
	const type = base.trim().toLowerCase();
	if (!CONTENT_TYPE_PATTERN.test(type))
		throw new DataError(422, "content_type_invalid", "Content type is invalid");
	return type;
}

export async function findObject(
	env: DataEnv,
	projectId: number,
	bucket: string,
	path: string,
): Promise<StoredObject | null> {
	const row = await env.DB.prepare(
		"SELECT * FROM data_objects WHERE project_id = ? AND bucket = ? AND path = ?",
	)
		.bind(projectId, bucket, path)
		.first<ObjectRow>();
	return row ? objectFromRow(row) : null;
}

export async function readableObject(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	path: string,
): Promise<StoredObject> {
	assertAllowed(bucket.rules.read, caller, "read this bucket");
	assertPath(path);
	const object = await findObject(env, caller.projectId, bucket.name, path);
	const owner = ownerScope(bucket.rules.read, caller);
	if (!object || (owner !== null && object.owner_id !== owner)) throw objectNotFound();
	return object;
}

export async function listObjects(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	params: URLSearchParams,
): Promise<{ items: StoredObject[]; nextCursor?: string }> {
	assertAllowed(bucket.rules.read, caller, "read this bucket");
	const limit = boundedInteger(params.get("limit"), 100, 1, 1000, "limit_invalid");
	const prefix = params.get("prefix") ?? "";
	const cursor = params.get("cursor") ?? "";
	const owner = ownerScope(bucket.rules.read, caller);
	const { results } = await env.DB.prepare(
		`SELECT * FROM data_objects
		 WHERE project_id = ? AND bucket = ? AND path >= ? AND path < ? AND path > ?
		   AND (? IS NULL OR owner_id = ?)
		 ORDER BY path LIMIT ?`,
	)
		.bind(
			caller.projectId,
			bucket.name,
			prefix,
			`${prefix}\u{10ffff}`,
			cursor,
			owner,
			owner,
			limit + 1,
		)
		.all<ObjectRow>();
	const items = results.slice(0, limit).map(objectFromRow);
	const last = items.at(-1);
	return results.length > limit && last ? { items, nextCursor: last.path } : { items };
}

export async function putObject(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	path: string,
	request: Request,
	upsert: boolean,
): Promise<StoredObject> {
	assertAllowed(bucket.rules.write, caller, "write to this bucket");
	assertPath(path);
	const type = contentType(request.headers.get("content-type"));
	if (!contentTypeAllowed(bucket, type))
		throw new DataError(
			415,
			"content_type_not_allowed",
			"This bucket does not accept this content type",
		);
	const declared = Number(request.headers.get("content-length") ?? Number.NaN);
	const maximum = Math.min(bucket.max_bytes, MAXIMUM_REQUEST_BYTES);
	if (!Number.isSafeInteger(declared) || declared < 0)
		throw new DataError(411, "length_required", "Content-Length is required");
	if (declared > maximum)
		throw new DataError(
			413,
			"object_too_large",
			`Send at most ${maximum} bytes in one request; use an upload for larger files`,
		);
	const existing = await findObject(env, caller.projectId, bucket.name, path);
	assertReplaceable(caller, bucket, existing, upsert);
	const key = objectKey(caller.projectId, bucket.name, path);
	const stored = await filesBucket(env).put(key, request.body ?? new Uint8Array(), {
		httpMetadata: { contentType: type },
	});
	if (!stored) throw new DataError(500, "object_write_failed", "Object could not be stored");
	if (stored.size > maximum) {
		await filesBucket(env).delete(key);
		throw new DataError(
			413,
			"object_too_large",
			`Objects of this bucket have at most ${maximum} bytes`,
		);
	}
	return recordObject(env, caller, bucket, path, type, stored.size, stored.httpEtag, existing);
}

export async function deleteObject(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	path: string,
): Promise<StoredObject> {
	assertAllowed(bucket.rules.delete, caller, "delete from this bucket");
	assertPath(path);
	const object = await findObject(env, caller.projectId, bucket.name, path);
	const owner = ownerScope(bucket.rules.delete, caller);
	if (!object || (owner !== null && object.owner_id !== owner)) throw objectNotFound();
	await filesBucket(env).delete(objectKey(caller.projectId, bucket.name, path));
	await env.DB.prepare("DELETE FROM data_objects WHERE project_id = ? AND bucket = ? AND path = ?")
		.bind(caller.projectId, bucket.name, path)
		.run();
	return object;
}

export async function objectResponse(
	env: DataEnv,
	projectId: number,
	object: StoredObject,
	request: Request,
	cacheControl: string,
): Promise<Response> {
	const key = objectKey(projectId, object.bucket, object.path);
	const transform = imageTransform(new URL(request.url).searchParams, object.content_type);
	if (transform && env.IMAGES) {
		const source = await filesBucket(env).get(key);
		if (!source) throw objectNotFound();
		const bytes = source.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>());
		const result = await env.IMAGES.input(bytes)
			.transform(transform.transform)
			.output({ format: transform.format, quality: transform.quality });
		const response = result.response();
		const headers = new Headers(response.headers);
		headers.set("cache-control", cacheControl);
		headers.set("x-content-type-options", "nosniff");
		return new Response(response.body, { status: 200, headers });
	}
	const source = await filesBucket(env).get(key, {
		range: request.headers,
		onlyIf: request.headers,
	});
	if (!source) throw objectNotFound();
	const headers = new Headers({
		"content-type": object.content_type,
		etag: source.httpEtag,
		"cache-control": cacheControl,
		"accept-ranges": "bytes",
		"x-content-type-options": "nosniff",
		"content-security-policy": "sandbox",
	});
	if (!("body" in source)) return new Response(null, { status: 304, headers });
	if (request.headers.has("range") && source.range && "offset" in source.range) {
		const start = source.range.offset ?? 0;
		const length = source.range.length ?? source.size - start;
		headers.set("content-range", `bytes ${start}-${start + length - 1}/${source.size}`);
		headers.set("content-length", String(length));
		return new Response(source.body, { status: 206, headers });
	}
	headers.set("content-length", String(source.size));
	return new Response(source.body, { status: 200, headers });
}

export async function startUpload(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	body: unknown,
): Promise<{ upload_id: string; path: string; minimum_part_size: number; expires_at: string }> {
	assertAllowed(bucket.rules.write, caller, "write to this bucket");
	if (!isRecord(body) || typeof body.path !== "string")
		throw new DataError(422, "upload_invalid", "path is required");
	assertPath(body.path);
	const type = contentType(typeof body.content_type === "string" ? body.content_type : null);
	if (!contentTypeAllowed(bucket, type))
		throw new DataError(
			415,
			"content_type_not_allowed",
			"This bucket does not accept this content type",
		);
	const upsert = body.upsert === true;
	assertReplaceable(
		caller,
		bucket,
		await findObject(env, caller.projectId, bucket.name, body.path),
		upsert,
	);
	const upload = await filesBucket(env).createMultipartUpload(
		objectKey(caller.projectId, bucket.name, body.path),
		{ httpMetadata: { contentType: type } },
	);
	const id = crypto.randomUUID();
	const expires = new Date(Date.now() + UPLOAD_LIFETIME_MS).toISOString();
	await env.DB.prepare(
		`INSERT INTO data_uploads (id, project_id, bucket, path, owner_id, content_type, r2_upload_id, upsert, created_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			caller.projectId,
			bucket.name,
			body.path,
			caller.userId,
			type,
			upload.uploadId,
			upsert ? 1 : 0,
			nowIso(),
			expires,
		)
		.run();
	return {
		upload_id: id,
		path: body.path,
		minimum_part_size: MINIMUM_PART_BYTES,
		expires_at: expires,
	};
}

export async function uploadPart(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	uploadId: string,
	partNumber: number,
	request: Request,
): Promise<{ part_number: number; etag: string; size: number }> {
	const upload = await ownedUpload(env, caller, bucket, uploadId);
	if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000)
		throw new DataError(422, "part_number_invalid", "Part numbers go from 1 to 10000");
	const declared = Number(request.headers.get("content-length") ?? Number.NaN);
	if (!Number.isSafeInteger(declared) || declared < 1)
		throw new DataError(411, "length_required", "Content-Length is required");
	if (declared > MAXIMUM_REQUEST_BYTES)
		throw new DataError(413, "part_too_large", `A part has at most ${MAXIMUM_REQUEST_BYTES} bytes`);
	const uploaded = await env.DB.prepare(
		"SELECT COALESCE(SUM(byte_size), 0) AS total FROM data_upload_parts WHERE upload_id = ? AND part_number != ?",
	)
		.bind(upload.id, partNumber)
		.first<{ total: number }>();
	if (Number(uploaded?.total ?? 0) + declared > bucket.max_bytes)
		throw new DataError(
			413,
			"object_too_large",
			`Objects of this bucket have at most ${bucket.max_bytes} bytes`,
		);
	if (!request.body) throw new DataError(411, "length_required", "A part body is required");
	const part = await filesBucket(env)
		.resumeMultipartUpload(
			objectKey(caller.projectId, bucket.name, upload.path),
			upload.r2_upload_id,
		)
		.uploadPart(partNumber, request.body);
	await env.DB.prepare(
		`INSERT INTO data_upload_parts (upload_id, part_number, etag, byte_size, created_at) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(upload_id, part_number) DO UPDATE SET etag = excluded.etag, byte_size = excluded.byte_size, created_at = excluded.created_at`,
	)
		.bind(upload.id, part.partNumber, part.etag, declared, nowIso())
		.run();
	return { part_number: part.partNumber, etag: part.etag, size: declared };
}

export async function uploadStatus(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	uploadId: string,
): Promise<{
	upload_id: string;
	path: string;
	expires_at: string;
	parts: { part_number: number; etag: string; size: number }[];
}> {
	const upload = await ownedUpload(env, caller, bucket, uploadId);
	return {
		upload_id: upload.id,
		path: upload.path,
		expires_at: upload.expires_at,
		parts: await uploadParts(env, upload.id),
	};
}

export async function completeUpload(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	uploadId: string,
): Promise<StoredObject> {
	const upload = await ownedUpload(env, caller, bucket, uploadId);
	const parts = await uploadParts(env, upload.id);
	if (parts.length === 0) throw new DataError(422, "upload_empty", "Send at least one part first");
	if (parts.reduce((total, part) => total + Number(part.size), 0) > bucket.max_bytes)
		throw tooLarge(bucket.max_bytes);
	const existing = await findObject(env, caller.projectId, bucket.name, upload.path);
	assertReplaceable(caller, bucket, existing, upload.upsert === 1);
	const key = objectKey(caller.projectId, bucket.name, upload.path);
	const stored = await filesBucket(env)
		.resumeMultipartUpload(key, upload.r2_upload_id)
		.complete(parts.map((part) => ({ partNumber: part.part_number, etag: part.etag })));
	await deleteUploadRows(env, upload.id);
	if (stored.size > bucket.max_bytes) {
		await filesBucket(env).delete(key);
		await env.DB.prepare(
			"DELETE FROM data_objects WHERE project_id = ? AND bucket = ? AND path = ?",
		)
			.bind(caller.projectId, bucket.name, upload.path)
			.run();
		throw tooLarge(bucket.max_bytes);
	}
	return recordObject(
		env,
		caller,
		bucket,
		upload.path,
		upload.content_type,
		stored.size,
		stored.httpEtag,
		existing,
	);
}

export async function abortUpload(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	uploadId: string,
): Promise<void> {
	const upload = await ownedUpload(env, caller, bucket, uploadId);
	await filesBucket(env)
		.resumeMultipartUpload(
			objectKey(caller.projectId, bucket.name, upload.path),
			upload.r2_upload_id,
		)
		.abort();
	await deleteUploadRows(env, upload.id);
}

export async function abortExpiredUploads(env: DataEnv, now = new Date()): Promise<number> {
	const { results } = await env.DB.prepare(
		"SELECT id, project_id, bucket, path, r2_upload_id FROM data_uploads WHERE expires_at <= ? ORDER BY expires_at LIMIT 50",
	)
		.bind(now.toISOString())
		.all<{ id: string; project_id: number; bucket: string; path: string; r2_upload_id: string }>();
	for (const upload of results) {
		try {
			await filesBucket(env)
				.resumeMultipartUpload(
					objectKey(upload.project_id, upload.bucket, upload.path),
					upload.r2_upload_id,
				)
				.abort();
		} catch (cause) {
			console.warn("[data-storage] expired upload already closed", upload.id, cause);
		}
		await deleteUploadRows(env, upload.id);
	}
	return results.length;
}

function assertReplaceable(
	caller: Caller,
	bucket: Bucket,
	existing: StoredObject | null,
	upsert: boolean,
): void {
	if (!existing) return;
	if (!upsert) throw new DataError(409, "object_exists", "An object already exists at this path");
	const owner = ownerScope(bucket.rules.write, caller);
	if (owner !== null && existing.owner_id !== owner)
		throw new DataError(403, "access_denied", "This object belongs to another user");
}

async function recordObject(
	env: DataEnv,
	caller: Caller,
	bucket: Bucket,
	path: string,
	type: string,
	size: number,
	etag: string,
	existing: StoredObject | null,
): Promise<StoredObject> {
	const now = nowIso();
	const owner = existing?.owner_id ?? caller.userId;
	await env.DB.prepare(
		`INSERT INTO data_objects (project_id, bucket, path, owner_id, content_type, byte_size, etag, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, bucket, path) DO UPDATE SET content_type = excluded.content_type,
		   byte_size = excluded.byte_size, etag = excluded.etag, updated_at = excluded.updated_at`,
	)
		.bind(
			caller.projectId,
			bucket.name,
			path,
			owner,
			type,
			size,
			etag,
			existing?.created_at ?? now,
			now,
		)
		.run();
	return {
		bucket: bucket.name,
		path,
		owner_id: owner,
		content_type: type,
		size,
		etag,
		created_at: existing?.created_at ?? now,
		updated_at: now,
	};
}

async function ownedUpload(env: DataEnv, caller: Caller, bucket: Bucket, uploadId: string) {
	assertAllowed(bucket.rules.write, caller, "write to this bucket");
	const upload = await env.DB.prepare(
		"SELECT * FROM data_uploads WHERE id = ? AND project_id = ? AND bucket = ?",
	)
		.bind(uploadId, caller.projectId, bucket.name)
		.first<{
			id: string;
			path: string;
			owner_id: string | null;
			content_type: string;
			r2_upload_id: string;
			upsert: number;
			expires_at: string;
		}>();
	if (!upload || (caller.role !== "service" && upload.owner_id !== caller.userId))
		throw new DataError(404, "upload_not_found", "Upload does not exist");
	if (Date.parse(upload.expires_at) <= Date.now())
		throw new DataError(410, "upload_expired", "Upload expired; start a new one");
	return upload;
}

async function uploadParts(env: DataEnv, uploadId: string) {
	const { results } = await env.DB.prepare(
		"SELECT part_number, etag, byte_size AS size FROM data_upload_parts WHERE upload_id = ? ORDER BY part_number",
	)
		.bind(uploadId)
		.all<{ part_number: number; etag: string; size: number }>();
	return results;
}

async function deleteUploadRows(env: DataEnv, uploadId: string): Promise<void> {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM data_upload_parts WHERE upload_id = ?").bind(uploadId),
		env.DB.prepare("DELETE FROM data_uploads WHERE id = ?").bind(uploadId),
	]);
}

function imageTransform(
	params: URLSearchParams,
	type: string,
): { transform: ImageTransform; format: ImageOutputOptions["format"]; quality?: number } | null {
	const keys = ["width", "height", "fit", "format", "quality"];
	if (!keys.some((key) => params.has(key))) return null;
	if (!type.startsWith("image/") || type === "image/svg+xml") return null;
	const dimension = (name: string) => {
		const value = params.get(name);
		return value === null ? undefined : boundedInteger(value, 0, 1, 4096, "transform_invalid");
	};
	const requestedFit = params.get("fit") ?? "scale-down";
	const fit = IMAGE_FITS.find((candidate) => candidate === requestedFit);
	if (!fit)
		throw new DataError(422, "transform_invalid", "fit is scale-down, contain, cover, crop or pad");
	const formats: Record<string, ImageOutputOptions["format"]> = {
		webp: "image/webp",
		avif: "image/avif",
		jpeg: "image/jpeg",
		png: "image/png",
	};
	const format = formats[params.get("format") ?? "webp"];
	if (!format) throw new DataError(422, "transform_invalid", "format is webp, avif, jpeg or png");
	const quality = params.has("quality")
		? boundedInteger(params.get("quality"), 85, 1, 100, "transform_invalid")
		: undefined;
	return {
		transform: {
			width: dimension("width"),
			height: dimension("height"),
			fit,
		},
		format,
		quality,
	};
}

function objectFromRow(row: ObjectRow): StoredObject {
	return {
		bucket: row.bucket,
		path: row.path,
		owner_id: row.owner_id,
		content_type: row.content_type,
		size: Number(row.byte_size),
		etag: row.etag,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function tooLarge(maximum: number) {
	return new DataError(
		413,
		"object_too_large",
		`Objects of this bucket have at most ${maximum} bytes`,
	);
}

function objectNotFound() {
	return new DataError(404, "object_not_found", "Object does not exist");
}
