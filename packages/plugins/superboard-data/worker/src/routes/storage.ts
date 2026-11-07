import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { resolveCaller, type Caller } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import {
	DataError,
	boundedInteger,
	isRecord,
	json,
	readJsonObject,
	scalarText,
} from "../platform/http.js";
import { allows } from "../platform/policy.js";
import { publicOrigin, signToken, verifyToken } from "../platform/signing.js";
import { getBucket, listBuckets, requireBucket } from "../storage/buckets.js";
import {
	abortUpload,
	assertPath,
	completeUpload,
	deleteObject,
	findObject,
	listObjects,
	objectResponse,
	putObject,
	readableObject,
	startUpload,
	uploadPart,
	uploadStatus,
} from "../storage/objects.js";
import {
	DATA_PLUGIN_ID,
	action,
	deferralOf,
	searchParams,
	wildcardPath,
	type DataContext,
	param,
} from "./context.js";

export const storageRoutes = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
	service: "files",
	module: "storage",
	pluginId: DATA_PLUGIN_ID,
	surface: "internal",
	access: "sdk-key",
});

const SIGNED_PURPOSE = "superboard-data-storage-v1";
const MAXIMUM_SIGNED_SECONDS = 7 * 24 * 60 * 60;
const PUBLIC_CACHE = "public, max-age=3600, stale-while-revalidate=86400";
const TRANSFORM_KEYS = ["width", "height", "fit", "format", "quality"];

interface SignedObject {
	p: number;
	b: string;
	k: string;
	t?: Record<string, string>;
	e: number;
}

function isSignedObject(value: unknown): value is SignedObject {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.p) &&
		typeof value.b === "string" &&
		typeof value.k === "string" &&
		(value.t === undefined ||
			(isRecord(value.t) && Object.values(value.t).every((item) => typeof item === "string"))) &&
		Number.isSafeInteger(value.e)
	);
}

async function bucketContext(
	c: DataContext,
): Promise<{ caller: Caller; bucket: Awaited<ReturnType<typeof requireBucket>> }> {
	const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
	return { caller, bucket: await requireBucket(c.env, caller.projectId, param(c, "bucket")) };
}

function objectPath(c: DataContext, family: string): string {
	return wildcardPath(c, `/v1/storage/${family}/${param(c, "bucket")}/`);
}

storageRoutes.defineRoute({ id: "data:storage:buckets" }).get(
	"/v1/storage/buckets",
	action("storage-buckets", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		const items = (await listBuckets(c.env, caller.projectId))
			.filter((bucket) => allows(bucket.rules.read, caller) || allows(bucket.rules.write, caller))
			.map(({ name, public: isPublic, max_bytes, allowed_types }) => ({
				name,
				public: isPublic,
				max_bytes,
				allowed_types,
			}));
		return json({ items });
	}),
);

storageRoutes.defineRoute({ id: "data:storage:list" }).get(
	"/v1/storage/list/:bucket",
	action("storage-list", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		return json(await listObjects(c.env, caller, bucket, searchParams(c)));
	}),
);

storageRoutes.defineRoute({ id: "data:storage:object-put" }).put(
	"/v1/storage/object/:bucket/*",
	action("storage-put", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		const upsert = c.req.header("x-upsert") === "true";
		return json(
			await putObject(c.env, caller, bucket, objectPath(c, "object"), c.req.raw, upsert),
			201,
		);
	}),
);

storageRoutes.defineRoute({ id: "data:storage:object-get" }).get(
	"/v1/storage/object/:bucket/*",
	action("storage-get", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		const object = await readableObject(c.env, caller, bucket, objectPath(c, "object"));
		return objectResponse(
			c.env,
			caller.projectId,
			object,
			c.req.raw,
			bucket.public ? PUBLIC_CACHE : "private, no-store",
		);
	}),
);

storageRoutes.defineRoute({ id: "data:storage:object-delete" }).delete(
	"/v1/storage/object/:bucket/*",
	action("storage-delete", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		return json({
			deleted: true,
			item: await deleteObject(c.env, caller, bucket, objectPath(c, "object")),
		});
	}),
);

storageRoutes.defineRoute({ id: "data:storage:sign" }).post(
	"/v1/storage/sign/:bucket/*",
	action("storage-sign", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		const object = await readableObject(c.env, caller, bucket, objectPath(c, "sign"));
		const body = await readJsonObject(c.req.raw, 4_096);
		const seconds = boundedInteger(
			scalarText(body.expires_in),
			3_600,
			1,
			MAXIMUM_SIGNED_SECONDS,
			"expires_in_invalid",
		);
		const transform: Record<string, string> = {};
		if (isRecord(body.transform))
			for (const key of TRANSFORM_KEYS) {
				const value = body.transform[key];
				if (typeof value === "string" || typeof value === "number") transform[key] = String(value);
			}
		const expires = Math.floor(Date.now() / 1000) + seconds;
		const token = await signToken(c.env, SIGNED_PURPOSE, {
			p: caller.projectId,
			b: bucket.name,
			k: object.path,
			...(Object.keys(transform).length ? { t: transform } : {}),
			e: expires,
		} satisfies SignedObject);
		return json({
			url: `${publicOrigin(c.env)}/storage/signed/${token}`,
			expires_at: new Date(expires * 1000).toISOString(),
		});
	}),
);

storageRoutes.defineRoute({ id: "data:storage:signed", access: "public" }).get(
	"/v1/storage/signed/:token",
	action("storage-signed", async (c) => {
		const token = await verifyToken(
			c.env,
			SIGNED_PURPOSE,
			param(c, "token"),
			MAXIMUM_SIGNED_SECONDS,
			isSignedObject,
		);
		if (!token) throw new DataError(401, "signature_invalid", "Signed URL is invalid or expired");
		const object = await findObject(c.env, token.p, token.b, token.k);
		if (!object) throw new DataError(404, "object_not_found", "Object does not exist");
		const url = new URL(c.req.url);
		for (const [key, value] of Object.entries(token.t ?? {})) url.searchParams.set(key, value);
		return objectResponse(
			c.env,
			token.p,
			object,
			new Request(url, c.req.raw),
			"private, max-age=60",
		);
	}),
);

storageRoutes.defineRoute({ id: "data:storage:public", access: "public" }).get(
	"/v1/storage/public/:projectId/:bucket/*",
	action("storage-public", async (c) => {
		const projectId = boundedInteger(
			param(c, "projectId"),
			0,
			1,
			Number.MAX_SAFE_INTEGER,
			"project_invalid",
		);
		const bucket = await getBucket(c.env, projectId, param(c, "bucket"));
		const path = wildcardPath(c, `/v1/storage/public/${projectId}/${param(c, "bucket")}/`);
		if (!bucket?.public) throw new DataError(404, "object_not_found", "Object does not exist");
		assertPath(path);
		const cache = typeof caches === "undefined" ? null : caches.default;
		const cacheKey = new Request(c.req.url, { method: "GET" });
		const cached = cache && !c.req.header("range") ? await cache.match(cacheKey) : undefined;
		if (cached) return cached;
		const object = await findObject(c.env, projectId, bucket.name, path);
		if (!object) throw new DataError(404, "object_not_found", "Object does not exist");
		const response = await objectResponse(c.env, projectId, object, c.req.raw, PUBLIC_CACHE);
		if (cache && response.status === 200)
			deferralOf(c).waitUntil(cache.put(cacheKey, response.clone()));
		return response;
	}),
);

storageRoutes.defineRoute({ id: "data:storage:upload-start" }).post(
	"/v1/storage/uploads/:bucket",
	action("storage-upload-start", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		return json(
			await startUpload(c.env, caller, bucket, await readJsonObject(c.req.raw, 8_192)),
			201,
		);
	}),
);

storageRoutes.defineRoute({ id: "data:storage:upload-status" }).get(
	"/v1/storage/uploads/:bucket/:uploadId",
	action("storage-upload-status", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		return json(await uploadStatus(c.env, caller, bucket, param(c, "uploadId")));
	}),
);

storageRoutes.defineRoute({ id: "data:storage:upload-part" }).put(
	"/v1/storage/uploads/:bucket/:uploadId/:partNumber",
	action("storage-upload-part", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		const part = Number(param(c, "partNumber"));
		return json(await uploadPart(c.env, caller, bucket, param(c, "uploadId"), part, c.req.raw));
	}),
);

storageRoutes.defineRoute({ id: "data:storage:upload-complete" }).post(
	"/v1/storage/uploads/:bucket/:uploadId/complete",
	action("storage-upload-complete", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		return json(await completeUpload(c.env, caller, bucket, param(c, "uploadId")), 201);
	}),
);

storageRoutes.defineRoute({ id: "data:storage:upload-abort" }).delete(
	"/v1/storage/uploads/:bucket/:uploadId",
	action("storage-upload-abort", async (c) => {
		const { caller, bucket } = await bucketContext(c);
		await abortUpload(c.env, caller, bucket, param(c, "uploadId"));
		return json({ aborted: true });
	}),
);
