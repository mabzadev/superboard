import type { PluginContext } from "emdash";

export interface AtSession {
	accessJwt: string;
	refreshJwt: string;
	did: string;
	handle: string;
}

export interface AtRecord {
	uri: string;
	cid: string;
}

export interface BlobRef {
	$type: "blob";
	ref: { $link: string };
	mimeType: string;
	size: number;
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

export function requireHttp(ctx: PluginContext) {
	if (!ctx.http) {
		throw new Error("AT Protocol plugin requires the network:request capability");
	}
	return ctx.http;
}

export function normalizePdsHost(value: string | null | undefined): string {
	const raw = value?.trim() || "bsky.social";
	const withScheme = URL_SCHEME_RE.test(raw) ? raw : `https://${raw}`;

	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new Error(`Invalid PDS host: ${raw}`);
	}

	if (url.protocol !== "https:") {
		throw new Error(`Invalid PDS host protocol: ${url.protocol}`);
	}

	return url.host;
}

function xrpcUrl(pdsHost: string, method: string): string {
	return `https://${normalizePdsHost(pdsHost)}/xrpc/${method}`;
}

async function responseNeedsSessionRefresh(res: Response): Promise<boolean> {
	if (res.status === 401) return true;
	if (res.status !== 400) return false;

	try {
		const body = (await res.clone().json()) as Record<string, unknown>;
		return body.error === "ExpiredToken";
	} catch {
		return false;
	}
}

function requireString(data: Record<string, unknown>, field: string, context: string): string {
	const value = data[field];
	if (typeof value !== "string") {
		throw new Error(`${context}: missing or invalid '${field}' in response`);
	}
	return value;
}

export async function createSession(
	ctx: PluginContext,
	pdsHost: string,
	identifier: string,
	password: string,
): Promise<AtSession> {
	const http = requireHttp(ctx);
	const res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.server.createSession"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ identifier, password }),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`createSession failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	return {
		accessJwt: requireString(data, "accessJwt", "createSession"),
		refreshJwt: requireString(data, "refreshJwt", "createSession"),
		did: requireString(data, "did", "createSession"),
		handle: requireString(data, "handle", "createSession"),
	};
}

export async function refreshSession(
	ctx: PluginContext,
	pdsHost: string,
	refreshJwt: string,
): Promise<AtSession> {
	const http = requireHttp(ctx);
	const res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.server.refreshSession"), {
		method: "POST",
		headers: { Authorization: `Bearer ${refreshJwt}` },
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`refreshSession failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	return {
		accessJwt: requireString(data, "accessJwt", "refreshSession"),
		refreshJwt: requireString(data, "refreshJwt", "refreshSession"),
		did: requireString(data, "did", "refreshSession"),
		handle: requireString(data, "handle", "refreshSession"),
	};
}

let refreshDeadlineMs = 15_000;
let refreshPollMs = 25;
let refreshMaxWaitMs = 30_000;
let refreshOwnerStartedAt: number | null = null;
let refreshGeneration = 0;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAccessDeduped(
	ctx: PluginContext,
	pdsHost: string,
	refreshJwt: string,
): Promise<{ accessJwt: string; did: string } | null> {
	const waitStart = Date.now();
	for (;;) {
		const access = await ctx.kv.get<string>("state:accessJwt");
		if (access) {
			const did = await ctx.kv.get<string>("state:did");
			if (did) return { accessJwt: access, did };
		}

		const ownerStartedAt = refreshOwnerStartedAt;
		if (ownerStartedAt === null || Date.now() - ownerStartedAt > refreshDeadlineMs) {
			refreshGeneration += 1;
			const claim = refreshGeneration;
			refreshOwnerStartedAt = Date.now();
			try {
				const session = await refreshSession(ctx, pdsHost, refreshJwt);
				await persistSession(ctx, session);
				return { accessJwt: session.accessJwt, did: session.did };
			} catch {
				return null;
			} finally {
				if (refreshGeneration === claim) {
					refreshOwnerStartedAt = null;
				}
			}
		}

		if (Date.now() - waitStart > refreshMaxWaitMs) {
			return null;
		}
		await sleep(refreshPollMs);
	}
}

export function __resetRefreshSingleFlightForTests(timing?: {
	deadlineMs?: number;
	pollMs?: number;
	maxWaitMs?: number;
}): void {
	refreshOwnerStartedAt = null;
	refreshGeneration = 0;
	refreshDeadlineMs = timing?.deadlineMs ?? 15_000;
	refreshPollMs = timing?.pollMs ?? 25;
	refreshMaxWaitMs = timing?.maxWaitMs ?? 30_000;
}

export async function ensureSession(ctx: PluginContext): Promise<{
	accessJwt: string;
	did: string;
	pdsHost: string;
}> {
	const pdsHost = normalizePdsHost(await ctx.kv.get<string>("settings:pdsHost"));
	const handle = await ctx.kv.get<string>("settings:handle");
	const appPassword = await ctx.kv.get<string>("settings:appPassword");

	if (!handle || !appPassword) {
		throw new Error("AT Protocol credentials not configured");
	}

	const existingAccess = await ctx.kv.get<string>("state:accessJwt");
	const existingRefresh = await ctx.kv.get<string>("state:refreshJwt");
	const existingDid = await ctx.kv.get<string>("state:did");

	if (existingAccess && existingDid) {
		return { accessJwt: existingAccess, did: existingDid, pdsHost };
	}

	if (existingRefresh) {
		const refreshed = await refreshAccessDeduped(ctx, pdsHost, existingRefresh);
		if (refreshed) {
			return { accessJwt: refreshed.accessJwt, did: refreshed.did, pdsHost };
		}
	}

	const session = await createSession(ctx, pdsHost, handle, appPassword);
	await persistSession(ctx, session);
	return { accessJwt: session.accessJwt, did: session.did, pdsHost };
}

async function persistSession(ctx: PluginContext, session: AtSession): Promise<void> {
	await ctx.kv.set("state:accessJwt", session.accessJwt);
	await ctx.kv.set("state:refreshJwt", session.refreshJwt);
	await ctx.kv.set("state:did", session.did);
}

export async function createRecord(
	ctx: PluginContext,
	pdsHost: string,
	accessJwt: string,
	did: string,
	collection: string,
	record: unknown,
): Promise<AtRecord> {
	const http = requireHttp(ctx);
	let res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.createRecord"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessJwt}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ repo: did, collection, record }),
	});

	if (await responseNeedsSessionRefresh(res)) {
		const refreshed = await ensureSessionFresh(ctx, pdsHost);
		if (refreshed) {
			res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.createRecord"), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${refreshed.accessJwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ repo: refreshed.did, collection, record }),
			});
		}
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`createRecord failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	return {
		uri: requireString(data, "uri", "createRecord"),
		cid: requireString(data, "cid", "createRecord"),
	};
}

export async function putRecord(
	ctx: PluginContext,
	pdsHost: string,
	accessJwt: string,
	did: string,
	collection: string,
	rkey: string,
	record: unknown,
): Promise<AtRecord> {
	const http = requireHttp(ctx);
	let res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.putRecord"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessJwt}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ repo: did, collection, rkey, record }),
	});

	if (await responseNeedsSessionRefresh(res)) {
		const refreshed = await ensureSessionFresh(ctx, pdsHost);
		if (refreshed) {
			res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.putRecord"), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${refreshed.accessJwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ repo: refreshed.did, collection, rkey, record }),
			});
		}
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`putRecord failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	return {
		uri: requireString(data, "uri", "putRecord"),
		cid: requireString(data, "cid", "putRecord"),
	};
}

export async function deleteRecord(
	ctx: PluginContext,
	pdsHost: string,
	accessJwt: string,
	did: string,
	collection: string,
	rkey: string,
): Promise<void> {
	const http = requireHttp(ctx);
	let res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.deleteRecord"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessJwt}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ repo: did, collection, rkey }),
	});

	if (await responseNeedsSessionRefresh(res)) {
		const refreshed = await ensureSessionFresh(ctx, pdsHost);
		if (refreshed) {
			res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.deleteRecord"), {
				method: "POST",
				headers: {
					Authorization: `Bearer ${refreshed.accessJwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ repo: refreshed.did, collection, rkey }),
			});
		}
	}

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`deleteRecord failed (${res.status}): ${body}`);
	}
}

async function ensureSessionFresh(
	ctx: PluginContext,
	_pdsHost: string,
): Promise<{ accessJwt: string; did: string } | null> {
	await ctx.kv.set("state:accessJwt", "");

	try {
		const result = await ensureSession(ctx);
		return { accessJwt: result.accessJwt, did: result.did };
	} catch {
		return null;
	}
}

export async function resolveHandle(ctx: PluginContext, handle: string): Promise<string> {
	const http = requireHttp(ctx);
	const res = await http.fetch(
		`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
	);

	if (!res.ok) {
		throw new Error(`resolveHandle failed for ${handle} (${res.status})`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	return requireString(data, "did", "resolveHandle");
}

export async function uploadBlob(
	ctx: PluginContext,
	pdsHost: string,
	accessJwt: string,
	imageBytes: ArrayBuffer,
	mimeType: string,
): Promise<BlobRef> {
	const http = requireHttp(ctx);
	const res = await http.fetch(xrpcUrl(pdsHost, "com.atproto.repo.uploadBlob"), {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessJwt}`,
			"Content-Type": mimeType,
		},
		body: imageBytes,
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`uploadBlob failed (${res.status}): ${body}`);
	}

	const data = (await res.json()) as Record<string, unknown>;
	if (!data.blob || typeof data.blob !== "object") {
		throw new Error("uploadBlob: missing 'blob' in response");
	}
	const blob = data.blob as Record<string, unknown>;
	if (!blob.ref || typeof blob.ref !== "object") {
		throw new Error("uploadBlob: malformed blob reference in response");
	}
	return data.blob as BlobRef;
}

export function rkeyFromUri(uri: string): string {
	const parts = uri.split("/");
	const rkey = parts.at(-1);
	if (!rkey) {
		throw new Error(`Invalid AT-URI: ${uri}`);
	}
	return rkey;
}
