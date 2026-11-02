import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import {
	MemoryStore,
	OAuthClient,
	type OAuthSession,
	type StoredSession,
	type StoredState,
} from "@atcute/oauth-node-client";

import { createDbStore } from "./db-store.js";

type Did = `did:${string}:${string}`;

interface StorageCollectionLike<T = unknown> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	deleteMany(ids: string[]): Promise<number>;
	query(options?: { limit?: number }): Promise<{ items: Array<{ id: string; data: T }> }>;
}

type AuthProviderStorageMap = Record<string, StorageCollectionLike>;

function isLoopback(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

export async function getAtprotoOAuthClient(
	baseUrl: string,
	storage?: AuthProviderStorageMap | null,
): Promise<OAuthClient> {
	if (isLoopback(baseUrl)) {
		baseUrl = baseUrl.replace("://localhost", "://127.0.0.1");
	}

	const actorResolver = new LocalActorResolver({
		handleResolver: new CompositeHandleResolver({
			methods: {
				dns: new DohJsonHandleResolver({ dohUrl: "https://cloudflare-dns.com/dns-query" }),
				http: new WellKnownHandleResolver(),
			},
		}),
		didDocumentResolver: new CompositeDidDocumentResolver({
			methods: {
				plc: new PlcDidDocumentResolver(),
				web: new WebDidDocumentResolver(),
			},
		}),
	});

	const stores = storage
		? {
				sessions: createDbStore<Did, StoredSession>(
					() =>
						// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- plugin storage collections match StorageCollectionLike shape
						storage.sessions as StorageCollectionLike<{
							value: StoredSession;
							expiresAt: number | null;
						}>,
				),
				states: createDbStore<string, StoredState>(
					() =>
						// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- plugin storage collections match StorageCollectionLike shape
						storage.states as StorageCollectionLike<{
							value: StoredState;
							expiresAt: number | null;
						}>,
				),
			}
		: {
				sessions: new MemoryStore<Did, StoredSession>(),
				states: new MemoryStore<string, StoredState>(),
			};

	if (isLoopback(baseUrl)) {
		return new OAuthClient({
			metadata: {
				redirect_uris: [`${baseUrl}/_emdash/api/auth/atproto/callback`],
				scope: "atproto transition:generic",
			},
			stores,
			actorResolver,
		});
	}

	return new OAuthClient({
		metadata: {
			client_id: `${baseUrl}/.well-known/atproto-client-metadata.json`,
			redirect_uris: [`${baseUrl}/_emdash/api/auth/atproto/callback`],
			scope: "atproto transition:generic",
		},
		stores,
		actorResolver,
	});
}

export async function resolveAtprotoProfile(
	atprotoSession: OAuthSession,
): Promise<{ displayName: string | null; handle: string }> {
	const did = atprotoSession.did;

	let handle: string = did;
	let displayName: string | null = null;

	try {
		const sessionRes = await atprotoSession.handle("/xrpc/com.atproto.server.getSession");
		if (sessionRes.ok) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- atproto XRPC getSession returns { handle?: string }
			const sessionData = (await sessionRes.json()) as { handle?: string };
			if (sessionData.handle) handle = sessionData.handle;
		}
	} catch (error) {
		console.warn("[atproto-auth] Failed to resolve handle via getSession:", error);
	}

	try {
		const res = await atprotoSession.handle(
			`/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`,
		);
		if (res.ok) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- atproto XRPC getRecord returns { value?: { displayName?: string } }
			const data = (await res.json()) as {
				value?: { displayName?: string };
			};
			displayName = data.value?.displayName || null;
		}
	} catch (error) {
		console.warn("[atproto-auth] Failed to resolve profile record:", error);
	}

	return { displayName, handle };
}
