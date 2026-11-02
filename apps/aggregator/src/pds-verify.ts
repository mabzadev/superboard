import type { PublicKey } from "@atcute/crypto";
import { type AtprotoDid, isDid } from "@atcute/lexicons/syntax";
import { verifyRecord } from "@atcute/repo";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type VerificationFailureReason =
	| "PDS_NETWORK_ERROR"
	| "PDS_HTTP_ERROR"
	| "RECORD_NOT_FOUND"
	| "RESPONSE_TOO_LARGE"
	| "INVALID_PROOF";

export class PdsVerificationError extends Error {
	override readonly name = "PdsVerificationError";
	constructor(
		readonly reason: VerificationFailureReason,
		message: string,
		readonly status?: number,
		override readonly cause?: unknown,
	) {
		super(message);
	}
}

export interface FetchAndVerifyOptions {
	pds: string;
	did: string;
	collection: string;
	rkey: string;
	publicKey: PublicKey;
	timeoutMs?: number;
	maxResponseBytes?: number;
	fetch?: typeof fetch;
}

export interface VerifiedPdsRecord {
	cid: string;
	record: unknown;
	carBytes: Uint8Array;
}

export async function fetchAndVerifyRecord(
	opts: FetchAndVerifyOptions,
): Promise<VerifiedPdsRecord> {
	const fetchImpl = opts.fetch ?? fetch;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxResponseBytes = opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

	if (!isAtprotoDid(opts.did)) {
		throw new PdsVerificationError(
			"INVALID_PROOF",
			`unsupported DID method (expected did:plc or did:web): ${opts.did}`,
		);
	}
	const url = buildGetRecordUrl(opts.pds, opts.did, opts.collection, opts.rkey);
	const carBytes = await fetchCar(fetchImpl, url, timeoutMs, maxResponseBytes);

	try {
		const result = await verifyRecord({
			did: opts.did,
			collection: opts.collection,
			rkey: opts.rkey,
			publicKey: opts.publicKey,
			carBytes,
		});
		return { cid: result.cid, record: result.record, carBytes };
	} catch (err) {
		throw new PdsVerificationError(
			"INVALID_PROOF",
			`verifyRecord failed: ${err instanceof Error ? err.message : String(err)}`,
			undefined,
			err,
		);
	}
}

function buildGetRecordUrl(pds: string, did: string, collection: string, rkey: string): string {
	const url = new URL("/xrpc/com.atproto.sync.getRecord", pds);
	url.searchParams.set("did", did);
	url.searchParams.set("collection", collection);
	url.searchParams.set("rkey", rkey);
	return url.toString();
}

async function fetchCar(
	fetchImpl: typeof fetch,
	url: string,
	timeoutMs: number,
	maxBytes: number,
): Promise<Uint8Array> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response;
	try {
		response = await fetchImpl(url, {
			signal: controller.signal,
			headers: { accept: "application/vnd.ipld.car" },
		});
	} catch (err) {
		throw new PdsVerificationError(
			"PDS_NETWORK_ERROR",
			err instanceof Error && err.name === "AbortError"
				? `PDS fetch aborted after ${timeoutMs}ms`
				: `PDS fetch failed: ${err instanceof Error ? err.message : String(err)}`,
			undefined,
			err,
		);
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 404) {
		throw new PdsVerificationError("RECORD_NOT_FOUND", `PDS returned 404 for ${url}`, 404);
	}
	if (!response.ok) {
		throw new PdsVerificationError(
			"PDS_HTTP_ERROR",
			`PDS returned ${response.status} for ${url}`,
			response.status,
		);
	}

	const reader = response.body?.getReader();
	if (!reader) {
		throw new PdsVerificationError("INVALID_PROOF", "PDS response body is null");
	}
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		// biome-ignore lint/correctness/noConstantCondition: drains the stream
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				throw new PdsVerificationError(
					"RESPONSE_TOO_LARGE",
					`PDS response exceeded ${maxBytes} bytes`,
				);
			}
			chunks.push(value);
		}
	} catch (err) {
		await reader.cancel().catch(() => {});
		throw err;
	} finally {
		reader.releaseLock();
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

function isAtprotoDid(value: string): value is AtprotoDid {
	if (!isDid(value)) return false;
	return value.startsWith("did:plc:") || value.startsWith("did:web:");
}

export function isTransient(
	reason: VerificationFailureReason,
	status: number | undefined,
): boolean {
	if (reason === "PDS_NETWORK_ERROR") return true;
	if (reason === "PDS_HTTP_ERROR" && status !== undefined && status >= 500) return true;
	return false;
}
