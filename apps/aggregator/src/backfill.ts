import {
	parseCanonicalResourceUri,
	type ParsedCanonicalResourceUri,
} from "@atcute/lexicons/syntax";

import { WANTED_COLLECTIONS } from "./constants.js";
import type { DidResolver } from "./did-resolver.js";
import type { BackfillJob, RecordsJob } from "./env.js";
import { isPlainObject } from "./utils.js";

const PAGE_SIZE = 100;
const LIST_RECORDS_TIMEOUT_MS = 15_000;
const MAX_PAGES_PER_COLLECTION = 1000;
const MAX_RECORDS_PER_PAGE = PAGE_SIZE;
export const QUEUE_SEND_BATCH_CAP = 100;
if (MAX_RECORDS_PER_PAGE > QUEUE_SEND_BATCH_CAP) {
	throw new Error(
		`MAX_RECORDS_PER_PAGE (${MAX_RECORDS_PER_PAGE}) exceeds QUEUE_SEND_BATCH_CAP (${QUEUE_SEND_BATCH_CAP})`,
	);
}
export interface RecordsQueueProducer {
	sendBatch(messages: ReadonlyArray<{ body: RecordsJob }>): Promise<unknown>;
}

export interface BackfillQueueProducer {
	sendBatch(messages: ReadonlyArray<{ body: BackfillJob }>): Promise<unknown>;
}

const MAX_DISCOVERY_PAGES_PER_COLLECTION = 100;
const DISCOVERY_PAGE_SIZE = 100;
const DISCOVERY_TIMEOUT_MS = 15_000;
export const MAX_DISCOVERED_DIDS = 1000;

export async function discoverDids(
	relayUrl: string,
	opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<string[]> {
	const fetchImpl = opts.fetch ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DISCOVERY_TIMEOUT_MS;
	const dids = new Set<string>();
	for (const collection of WANTED_COLLECTIONS) {
		try {
			await discoverCollection(relayUrl, collection, fetchImpl, timeoutMs, dids);
		} catch (err) {
			console.error("[aggregator] backfill discovery failed for collection", {
				collection,
				error: err instanceof Error ? err.message : String(err),
			});
		}
		if (dids.size >= MAX_DISCOVERED_DIDS) {
			console.warn("[aggregator] backfill discovery hit DID cap, stopping early", {
				cap: MAX_DISCOVERED_DIDS,
				stoppedAfterCollection: collection,
			});
			break;
		}
	}
	return [...dids];
}

async function discoverCollection(
	relayUrl: string,
	collection: string,
	fetchImpl: typeof fetch,
	timeoutMs: number,
	dids: Set<string>,
): Promise<void> {
	let cursor: string | undefined;
	let prevCursor: string | undefined;
	let pages = 0;
	do {
		if (++pages > MAX_DISCOVERY_PAGES_PER_COLLECTION) {
			throw new Error(`exceeded ${MAX_DISCOVERY_PAGES_PER_COLLECTION} discovery pages`);
		}
		if (cursor !== undefined && cursor === prevCursor) {
			throw new Error("relay returned identical cursor twice");
		}
		prevCursor = cursor;

		const url = new URL("/xrpc/com.atproto.sync.listReposByCollection", relayUrl);
		url.searchParams.set("collection", collection);
		url.searchParams.set("limit", String(DISCOVERY_PAGE_SIZE));
		if (cursor) url.searchParams.set("cursor", cursor);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		let response: Response;
		try {
			response = await fetchImpl(url.toString(), {
				headers: { accept: "application/json" },
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				throw new Error(`listReposByCollection timed out after ${timeoutMs}ms`, { cause: err });
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) {
			throw new Error(`listReposByCollection returned ${response.status}`);
		}
		const body: unknown = await response.json();
		if (!isPlainObject(body)) throw new Error("listReposByCollection returned non-object body");
		const repos = body["repos"];
		if (!Array.isArray(repos)) {
			throw new Error("listReposByCollection response missing `repos` array");
		}
		for (const repo of repos) {
			if (!isPlainObject(repo)) continue;
			const did = repo["did"];
			if (typeof did === "string") {
				dids.add(did);
				if (dids.size >= MAX_DISCOVERED_DIDS) return;
			}
		}
		const nextCursor = body["cursor"];
		cursor = typeof nextCursor === "string" && nextCursor.length > 0 ? nextCursor : undefined;
	} while (cursor);
}

export async function enqueueBackfillJobs(
	dids: readonly string[],
	queue: BackfillQueueProducer,
): Promise<number> {
	const messages: { body: BackfillJob }[] = [];
	for (const did of dids) {
		for (const collection of WANTED_COLLECTIONS) {
			messages.push({ body: { did, collection } });
		}
	}
	const sends: Promise<unknown>[] = [];
	for (let i = 0; i < messages.length; i += QUEUE_SEND_BATCH_CAP) {
		sends.push(queue.sendBatch(messages.slice(i, i + QUEUE_SEND_BATCH_CAP)));
	}
	await Promise.all(sends);
	return messages.length;
}

export interface ProcessBackfillJobDeps {
	resolver: DidResolver;
	queue: RecordsQueueProducer;
	fetch?: typeof fetch;
	listRecordsTimeoutMs?: number;
}

export interface ProcessBackfillJobResult {
	did: string;
	collection: string;
	enqueued: number;
}

export async function processBackfillJob(
	job: BackfillJob,
	deps: ProcessBackfillJobDeps,
): Promise<ProcessBackfillJobResult> {
	const resolved = await deps.resolver.resolve(job.did);
	const fetchImpl = deps.fetch ?? fetch;
	const timeoutMs = deps.listRecordsTimeoutMs ?? LIST_RECORDS_TIMEOUT_MS;
	const enqueued = await paginateAndEnqueue({
		did: job.did,
		pds: resolved.pds,
		collection: job.collection,
		queue: deps.queue,
		fetchImpl,
		timeoutMs,
	});
	return { did: job.did, collection: job.collection, enqueued };
}

interface PaginateOpts {
	did: string;
	pds: string;
	collection: string;
	queue: RecordsQueueProducer;
	fetchImpl: typeof fetch;
	timeoutMs: number;
}

async function paginateAndEnqueue(opts: PaginateOpts): Promise<number> {
	let cursor: string | undefined;
	let prevCursor: string | undefined;
	let pages = 0;
	let totalEnqueued = 0;
	do {
		if (++pages > MAX_PAGES_PER_COLLECTION) {
			throw new Error(`exceeded ${MAX_PAGES_PER_COLLECTION} pages`);
		}
		if (cursor !== undefined && cursor === prevCursor) {
			throw new Error("PDS returned identical cursor twice");
		}
		prevCursor = cursor;

		const url = new URL("/xrpc/com.atproto.repo.listRecords", opts.pds);
		url.searchParams.set("repo", opts.did);
		url.searchParams.set("collection", opts.collection);
		url.searchParams.set("limit", String(PAGE_SIZE));
		if (cursor) url.searchParams.set("cursor", cursor);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
		let response: Response;
		try {
			response = await opts.fetchImpl(url.toString(), {
				headers: { accept: "application/json" },
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				throw new Error(`listRecords timed out after ${opts.timeoutMs}ms`, { cause: err });
			}
			throw err;
		} finally {
			clearTimeout(timer);
		}
		if (response.status === 404) {
			if (cursor === undefined) {
				return totalEnqueued;
			}
			throw new Error(`listRecords returned 404 mid-pagination at cursor=${cursor}`);
		}
		if (!response.ok) {
			throw new Error(`listRecords returned ${response.status}`);
		}

		const body: unknown = await response.json();
		const records = extractListRecordsBody(body);
		if (records.length > MAX_RECORDS_PER_PAGE) {
			throw new Error(
				`PDS returned ${records.length} records, exceeding per-page cap of ${MAX_RECORDS_PER_PAGE}`,
			);
		}
		cursor = extractCursor(body);

		const messages: { body: RecordsJob }[] = [];
		for (const record of records) {
			let parsed: ParsedCanonicalResourceUri;
			try {
				parsed = parseCanonicalResourceUri(record.uri);
			} catch (err) {
				if (err instanceof SyntaxError) continue;
				throw err;
			}
			if (parsed.repo !== opts.did) continue;
			if (parsed.collection !== opts.collection) continue;
			messages.push({
				body: {
					did: opts.did,
					collection: opts.collection,
					rkey: parsed.rkey,
					operation: "create",
					cid: record.cid,
				},
			});
		}
		if (messages.length > 0) {
			await opts.queue.sendBatch(messages);
			totalEnqueued += messages.length;
		}
	} while (cursor);
	return totalEnqueued;
}

interface ListRecordEntry {
	uri: string;
	cid: string;
	value: unknown;
}

function extractListRecordsBody(body: unknown): ListRecordEntry[] {
	if (!isPlainObject(body)) {
		throw new Error("listRecords response was not a JSON object");
	}
	const records = body["records"];
	if (!Array.isArray(records)) {
		throw new Error("listRecords response missing `records` array");
	}
	const out: ListRecordEntry[] = [];
	for (const r of records) {
		if (!isPlainObject(r)) {
			throw new Error("listRecords record entry was not a JSON object");
		}
		const uri = r["uri"];
		const cid = r["cid"];
		if (typeof uri !== "string" || typeof cid !== "string") {
			throw new Error("listRecords record entry missing string `uri` or `cid`");
		}
		out.push({ uri, cid, value: r["value"] });
	}
	return out;
}

function extractCursor(body: unknown): string | undefined {
	if (!isPlainObject(body)) {
		throw new Error("listRecords response was not a JSON object");
	}
	const cursor = body["cursor"];
	if (cursor === undefined) return undefined;
	if (typeof cursor !== "string") {
		throw new Error(`listRecords cursor was not a string (got ${typeof cursor})`);
	}
	return cursor;
}
