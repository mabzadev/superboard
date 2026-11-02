import { isDid } from "@atcute/lexicons/syntax";

import { drainBackfillDeadLetterBatch, processBackfillBatch } from "./backfill-consumer.js";
import { discoverDids, enqueueBackfillJobs } from "./backfill.js";
import type { BackfillJob, RecordsJob } from "./env.js";
import { PROJECTION_COORDINATOR_NAME } from "./label-ingest-do.js";
import { enforceRequiredLabelSourceHealth } from "./label-source-health.js";
import {
	acknowledgeLabelSourceStop,
	labelSourcePolicy,
	reconcileLabelSources,
} from "./label-source-policy.js";
import { isCurrentSubject, listCurrentSubjects } from "./labeler-reconciliation-service.js";
import { getListingPolicy } from "./listing-policy.js";
import { enforceConfiguredProjection } from "./projection-enforcement.js";
import { drainDeadLetterBatch, processBatch } from "./records-consumer.js";
import { RECORDS_DO_NAME } from "./records-do.js";
import { handleXrpc } from "./routes/xrpc/router.js";
import { isPlainObject } from "./utils.js";

const RECORDS_QUEUE_NAME = "emdash-aggregator-records";
const RECORDS_DLQ_NAME = "emdash-aggregator-records-dlq";
const BACKFILL_QUEUE_NAME = "emdash-aggregator-backfill";
const BACKFILL_DLQ_NAME = "emdash-aggregator-backfill-dlq";

export { LabelIngestDO } from "./label-ingest-do.js";
export { RecordsJetstreamDO } from "./records-do.js";

const BOOTSTRAP_PATH = "/_admin/start";
const BACKFILL_PATH = "/_admin/backfill";
const STATUS_PATH = "/_admin/status";
const RECONCILIATION_SUBJECTS_PATH = "/_internal/labeler/subjects";
const RECONCILIATION_CURRENT_PATH = "/_internal/labeler/current";
const LABEL_REPLAY_PATH = "/_admin/labels/replay";

const MAX_BACKFILL_DIDS = 100;

const tokenEncoder = new TextEncoder();

function timingSafeEqual(a: string, b: string): boolean {
	const aBuf = tokenEncoder.encode(a);
	const bBuf = tokenEncoder.encode(b);
	if (aBuf.byteLength !== bBuf.byteLength) return false;
	return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

function requireAdminAuth(request: Request, env: Env): Response | null {
	const expected = env.ADMIN_TOKEN;
	if (!expected || expected.trim().length === 0) {
		return new Response("admin endpoints not configured", { status: 503 });
	}
	const auth = request.headers.get("authorization");
	const SCHEME_PREFIX = "bearer ";
	if (
		!auth ||
		auth.length < SCHEME_PREFIX.length ||
		auth.slice(0, SCHEME_PREFIX.length).toLowerCase() !== SCHEME_PREFIX
	) {
		return new Response("unauthorized", {
			status: 401,
			headers: { "www-authenticate": "Bearer" },
		});
	}
	const token = auth.slice(SCHEME_PREFIX.length);
	if (!timingSafeEqual(token, expected)) {
		return new Response("unauthorized", {
			status: 401,
			headers: { "www-authenticate": "Bearer" },
		});
	}
	return null;
}

function requireReconciliationAuth(request: Request, env: Env): Response | null {
	const expected = env.RECONCILIATION_TOKEN;
	if (!expected || expected.trim().length === 0) {
		return new Response("reconciliation endpoint not configured", { status: 503 });
	}
	const auth = request.headers.get("authorization");
	const prefix = "Bearer ";
	if (!auth?.startsWith(prefix) || !timingSafeEqual(auth.slice(prefix.length), expected)) {
		return new Response("unauthorized", { status: 401 });
	}
	return null;
}

type BackfillRequest = { mode: "explicit"; dids: string[] } | { mode: "discover" };

function parseBackfillBody(body: unknown): BackfillRequest | { error: string } {
	if (!isPlainObject(body)) {
		return { error: "request body must be a JSON object" };
	}
	const rawDids = body["dids"];
	if (rawDids === undefined || rawDids === null) {
		return { mode: "discover" };
	}
	if (!Array.isArray(rawDids)) {
		return {
			error: "`dids` must be an array of DID strings, or omitted to discover via the relay",
		};
	}
	if (rawDids.length === 0) {
		return {
			error: "`dids` must not be empty (omit the field to discover via the relay)",
		};
	}
	if (rawDids.length > MAX_BACKFILL_DIDS) {
		return {
			error: `\`dids\` must contain at most ${MAX_BACKFILL_DIDS} entries (got ${rawDids.length})`,
		};
	}
	const seen = new Set<string>();
	for (const did of rawDids) {
		if (!isDid(did)) {
			return { error: `invalid DID in list: ${JSON.stringify(did)}` };
		}
		seen.add(did);
	}
	return { mode: "explicit", dids: [...seen] };
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === RECONCILIATION_SUBJECTS_PATH) {
			const denied = requireReconciliationAuth(request, env);
			if (denied) return denied;
			const limit = Number(url.searchParams.get("limit") ?? 100);
			const page = await listCurrentSubjects(
				env.DB,
				url.searchParams.get("cursor") ?? undefined,
				limit,
			);
			return Response.json(page, { headers: { "cache-control": "private, no-store" } });
		}
		if (url.pathname === RECONCILIATION_CURRENT_PATH) {
			const denied = requireReconciliationAuth(request, env);
			if (denied) return denied;
			const uri = url.searchParams.get("uri") ?? "";
			const cid = url.searchParams.get("cid") ?? "";
			return Response.json(
				{ current: await isCurrentSubject(env.DB, uri, cid) },
				{ headers: { "cache-control": "private, no-store" } },
			);
		}
		if (url.pathname === BOOTSTRAP_PATH) {
			if (request.method !== "POST") {
				return new Response("method not allowed", {
					status: 405,
					headers: { allow: "POST" },
				});
			}
			const denied = requireAdminAuth(request, env);
			if (denied) return denied;
			const id = env.RECORDS_DO.idFromName(RECORDS_DO_NAME);
			const stub = env.RECORDS_DO.get(id);
			ctx.waitUntil(stub.fetch("https://do.internal/bootstrap"));
			return new Response(null, { status: 204 });
		}
		if (url.pathname === STATUS_PATH) {
			if (request.method !== "GET") {
				return new Response("method not allowed", {
					status: 405,
					headers: { allow: "GET" },
				});
			}
			const denied = requireAdminAuth(request, env);
			if (denied) return denied;
			const id = env.RECORDS_DO.idFromName(RECORDS_DO_NAME);
			const stub = env.RECORDS_DO.get(id);
			return stub.fetch("https://do.internal/status");
		}
		if (url.pathname === BACKFILL_PATH) {
			if (request.method !== "POST") {
				return new Response("method not allowed", {
					status: 405,
					headers: { allow: "POST" },
				});
			}
			const denied = requireAdminAuth(request, env);
			if (denied) return denied;
			let body: unknown = {};
			const text = await request.text();
			if (text.length > 0) {
				try {
					body = JSON.parse(text);
				} catch {
					return new Response("request body must be valid JSON", { status: 400 });
				}
			}
			const parsed = parseBackfillBody(body);
			if ("error" in parsed) {
				return new Response(parsed.error, { status: 400 });
			}
			ctx.waitUntil(runBackfill(parsed, env));
			return new Response(null, { status: 202 });
		}
		if (url.pathname === LABEL_REPLAY_PATH) {
			if (request.method !== "POST") {
				return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
			}
			const denied = requireAdminAuth(request, env);
			if (denied) return denied;
			return Response.json(await replayAllLabels(env), {
				headers: { "cache-control": "private, no-store" },
			});
		}
		const xrpc = await handleXrpc(env, request);
		if (xrpc) return xrpc;
		return new Response("emdash-aggregator: not found", {
			status: 404,
			headers: { "content-type": "text/plain" },
		});
	},

	async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext): Promise<void> {
		switch (batch.queue) {
			case RECORDS_QUEUE_NAME:
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by queue name
				await processBatch(batch as MessageBatch<RecordsJob>, env);
				return;
			case RECORDS_DLQ_NAME:
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by queue name
				await drainDeadLetterBatch(batch as MessageBatch<RecordsJob>, env);
				return;
			case BACKFILL_QUEUE_NAME:
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by queue name
				await processBackfillBatch(batch as MessageBatch<BackfillJob>, env);
				return;
			case BACKFILL_DLQ_NAME:
				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by queue name
				drainBackfillDeadLetterBatch(batch as MessageBatch<BackfillJob>, env);
				return;
			default:
				console.error("[aggregator] unknown queue, acking batch", { queue: batch.queue });
				for (const m of batch.messages) m.ack();
		}
	},

	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
		const id = env.RECORDS_DO.idFromName(RECORDS_DO_NAME);
		const stub = env.RECORDS_DO.get(id);
		ctx.waitUntil(stub.fetch("https://do.internal/liveness"));
		ctx.waitUntil(
			runScheduledLabelMaintenance(env).catch((error: unknown) => {
				console.error("[aggregator] projection enforcement failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}),
		);
	},
};

async function reconcileAndWakeLabelers(env: Env): Promise<void> {
	const policy = labelSourcePolicy(await getListingPolicy(env));
	const result = await reconcileLabelSources(env.DB, policy);
	const demotedSources = await enforceRequiredLabelSourceHealth(env.DB, new Date());
	await Promise.all(
		result.sourcesRequiringStop.map(async (did) => {
			await env.LABEL_INGEST_DO.getByName(did).stop(did);
			await acknowledgeLabelSourceStop(env.DB, did);
		}),
	);
	if (result.changed || demotedSources.length > 0) {
		await env.LABEL_INGEST_DO.getByName(PROJECTION_COORDINATOR_NAME).markProjectionDirty();
	}
	await Promise.all(
		result.activeSources.map((did) => env.LABEL_INGEST_DO.getByName(did).wake(did)),
	);
}

async function runScheduledLabelMaintenance(env: Env): Promise<void> {
	await reconcileAndWakeLabelers(env);
	await enforceConfiguredProjection(env);
	await env.LABEL_INGEST_DO.getByName(PROJECTION_COORDINATOR_NAME).markProjectionDirty();
}

async function replayAllLabels(env: Env): Promise<{ sources: readonly string[] }> {
	const policy = labelSourcePolicy(await getListingPolicy(env));
	await reconcileLabelSources(env.DB, policy);
	const sources = [...policy.acceptedSources];
	for (const did of sources) {
		const stub = env.LABEL_INGEST_DO.getByName(did);
		await stub.replay(did, new Date().toISOString());
	}
	await env.LABEL_INGEST_DO.getByName(PROJECTION_COORDINATOR_NAME).markProjectionDirty();
	return { sources };
}

type BackfillRequestParsed = { mode: "explicit"; dids: string[] } | { mode: "discover" };

async function runBackfill(req: BackfillRequestParsed, env: Env): Promise<void> {
	try {
		let dids: readonly string[];
		if (req.mode === "discover") {
			console.log("[aggregator] backfill discovery starting", {
				relay: env.RELAY_URL,
			});
			dids = await discoverDids(env.RELAY_URL);
			console.log("[aggregator] backfill discovery complete", {
				relay: env.RELAY_URL,
				didCount: dids.length,
			});
		} else {
			dids = req.dids;
			console.log("[aggregator] backfill enqueue starting", {
				mode: "explicit",
				didCount: dids.length,
			});
		}

		if (dids.length === 0) {
			console.warn("[aggregator] backfill produced zero DIDs, nothing to enqueue", {
				mode: req.mode,
			});
			return;
		}

		const enqueued = await enqueueBackfillJobs(dids, env.BACKFILL_QUEUE);
		console.log("[aggregator] backfill enqueue complete", {
			mode: req.mode,
			didCount: dids.length,
			jobsEnqueued: enqueued,
		});
	} catch (err) {
		console.error("[aggregator] backfill aborted", {
			mode: req.mode,
			error: err instanceof Error ? (err.stack ?? err.message) : String(err),
		});
	}
}
