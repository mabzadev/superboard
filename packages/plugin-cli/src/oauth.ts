import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";

import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import type { ActorIdentifier, Did } from "@atcute/lexicons";
import { isDid, isHandle } from "@atcute/lexicons/syntax";
import {
	type LoopbackClientMetadata,
	type OAuthSession,
	OAuthClient,
	OAuthResponseError,
	type Store,
	type StoredSession,
	type StoredState,
} from "@atcute/oauth-node-client";
import { QUERY_NSIDS, RECORD_NSIDS } from "@emdash-cms/registry-lexicons";

import { DEFAULT_OAUTH_DIR } from "./config.js";

const DEFAULT_CLI_SCOPE = [
	"atproto",
	...RECORD_NSIDS.map((nsid) => `repo:${nsid}`),
	...QUERY_NSIDS.map((nsid) => `rpc:${nsid}?aud=*`),
].join(" ");

const LEGACY_FALLBACK_SCOPE = "atproto transition:generic";

interface FileStoreEnvelope<V> {
	version: number;
	entries: Record<string, V>;
}

const FILE_STORE_VERSION = 1;

class FileStore<V> implements Store<string, V> {
	readonly #path: string;
	readonly #cache = new Map<string, V>();
	#loaded = false;

	constructor(path: string) {
		this.#path = path;
	}

	async get(key: string): Promise<V | undefined> {
		await this.#ensureLoaded();
		return this.#cache.get(key);
	}

	async set(key: string, value: V): Promise<void> {
		await this.#ensureLoaded();
		this.#cache.set(key, value);
		await this.#flush();
	}

	async delete(key: string): Promise<void> {
		await this.#ensureLoaded();
		this.#cache.delete(key);
		await this.#flush();
	}

	async clear(): Promise<void> {
		await this.#ensureLoaded();
		this.#cache.clear();
		await this.#flush();
	}

	async #ensureLoaded(): Promise<void> {
		if (this.#loaded) return;
		try {
			const raw = await readFile(this.#path, "utf8");
			const parsed: unknown = JSON.parse(raw);
			if (
				parsed &&
				typeof parsed === "object" &&
				"entries" in parsed &&
				parsed.entries &&
				typeof parsed.entries === "object"
			) {
				// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion
				for (const [k, v] of Object.entries(parsed.entries) as Array<[string, V]>) {
					this.#cache.set(k, v);
				}
			}
		} catch (error) {
			if (!isErrnoException(error) || error.code !== "ENOENT") {
				throw error;
			}
		}
		this.#loaded = true;
	}

	async #flush(): Promise<void> {
		const dir = dirname(this.#path);
		await mkdir(dir, { recursive: true, mode: 0o700 });
		const envelope: FileStoreEnvelope<V> = {
			version: FILE_STORE_VERSION,
			entries: Object.fromEntries(this.#cache),
		};
		const body = `${JSON.stringify(envelope, null, 2)}\n`;
		const tmp = `${this.#path}.tmp`;
		try {
			await writeFile(tmp, body, { mode: 0o600, flush: true });
			await rename(tmp, this.#path);
			await fsyncDir(dir).catch(() => {});
		} catch (error) {
			await unlink(tmp).catch(() => {});
			throw error;
		}
	}
}

async function fsyncDir(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	);
}

export interface OAuthClientFactoryOptions {
	stateDir?: string;
	redirectUri: `http://127.0.0.1:${number}/callback`;
	scope?: string;
}

export function createActorResolver(): LocalActorResolver {
	return new LocalActorResolver({
		handleResolver: new CompositeHandleResolver({
			methods: {
				dns: new DohJsonHandleResolver({
					dohUrl: "https://cloudflare-dns.com/dns-query",
				}),
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
}

export function createCliOAuthClient(options: OAuthClientFactoryOptions): OAuthClient {
	const stateDir = options.stateDir ?? DEFAULT_OAUTH_DIR;

	const sessions = new FileStore<StoredSession>(join(stateDir, "sessions.json"));
	const states = new FileStore<StoredState>(join(stateDir, "states.json"));

	const actorResolver = createActorResolver();

	const metadata: LoopbackClientMetadata = {
		redirect_uris: [options.redirectUri],
		scope: options.scope ?? DEFAULT_CLI_SCOPE,
	};

	return new OAuthClient({
		metadata,
		stores: {
			sessions: sessions,
			states: states,
		},
		actorResolver,
	});
}

function renderCallbackPage(title: string, message: string): string {
	return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}h1{font-size:1.25rem}p{color:#666}</style>
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><small>You can close this tab.</small></p>`;
}

function escapeHtml(input: string): string {
	return input
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")
		.replaceAll("/", "&#x2F;");
}

export type CallbackOutcome =
	| { ok: true; title?: string; message?: string }
	| { ok: false; title?: string; message?: string };

export interface BindLoopbackServerResult {
	redirectUri: `http://127.0.0.1:${number}/callback`;
	awaitCallback(): Promise<URLSearchParams>;
	respond(outcome: CallbackOutcome): void;
	close(): Promise<void>;
}

export async function bindLoopbackServer(
	timeoutMs = 5 * 60 * 1000,
): Promise<BindLoopbackServerResult> {
	let resolveCallback: ((params: URLSearchParams) => void) | undefined;
	let rejectCallback: ((error: Error) => void) | undefined;
	let settled = false;

	const callbackPromise = new Promise<URLSearchParams>((resolve, reject) => {
		resolveCallback = (params) => {
			if (settled) return;
			settled = true;
			resolve(params);
		};
		rejectCallback = (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		};
	});

	let pendingResponse: ServerResponse | undefined;
	let responded = false;

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");
		if (req.method !== "GET") {
			res.statusCode = 405;
			res.setHeader("allow", "GET");
			res.end();
			return;
		}
		if (url.pathname !== "/callback") {
			res.statusCode = 404;
			res.end();
			return;
		}

		if (!url.searchParams.has("state")) {
			res.statusCode = 400;
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(
				renderCallbackPage(
					"EmDash plugin login",
					"Waiting for the actual login callback. (This request had no state parameter.)",
				),
			);
			return;
		}

		if (settled) {
			res.statusCode = 200;
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(
				renderCallbackPage(
					"EmDash plugin login",
					"Login already completed. You can close this tab.",
				),
			);
			return;
		}

		pendingResponse = res;
		resolveCallback?.(url.searchParams);
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("could not determine loopback server address");
	}
	const port = address.port;
	const redirectUri = `http://127.0.0.1:${port}/callback` as const;

	const timeout = setTimeout(() => {
		rejectCallback?.(new Error(`OAuth callback timed out after ${Math.round(timeoutMs / 1000)}s`));
	}, timeoutMs);
	timeout.unref();

	const respond = (outcome: CallbackOutcome): void => {
		if (responded) return;
		responded = true;
		const res = pendingResponse;
		if (!res) return;
		res.statusCode = outcome.ok ? 200 : 400;
		res.setHeader("content-type", "text/html; charset=utf-8");
		res.end(
			renderCallbackPage(
				outcome.title ?? (outcome.ok ? "EmDash plugin login" : "Login failed"),
				outcome.message ??
					(outcome.ok
						? "Login complete. Returning you to the CLI."
						: "The login callback could not be validated. Check the CLI for details."),
			),
		);
	};

	const close = async (): Promise<void> => {
		clearTimeout(timeout);
		if (!responded && pendingResponse) {
			responded = true;
			try {
				pendingResponse.end();
			} catch {}
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	};

	return {
		redirectUri,
		awaitCallback: () => callbackPromise,
		respond,
		close,
	};
}

export function tryOpenBrowser(url: string): void {
	void (async () => {
		try {
			const { execFile } = await import("node:child_process");
			if (process.platform === "darwin") {
				execFile("open", [url]);
			} else if (process.platform === "win32") {
				execFile("cmd", ["/c", "start", "", url]);
			} else {
				execFile("xdg-open", [url]);
			}
		} catch {}
	})();
}

function parseActorIdentifier(input: string): ActorIdentifier {
	const trimmed = input.trim();
	if (isDid(trimmed) || isHandle(trimmed)) {
		return trimmed;
	}
	throw new Error(
		`"${input}" is not a valid handle or DID. Expected a handle like "alice.example.com" or a DID like "did:plc:abc123..."`,
	);
}

export interface RunInteractiveLoginOptions {
	identifier: string;
	stateDir?: string;
	timeoutMs?: number;
	onUrl?: (url: URL) => void;
	onLegacyScopeFallback?: () => void;
}

export interface RunInteractiveLoginResult {
	session: OAuthSession;
	did: Did;
}

async function authorizeWithLegacyFallback(input: {
	stateDir: string | undefined;
	redirectUri: `http://127.0.0.1:${number}/callback`;
	identifier: ActorIdentifier;
	onLegacyScopeFallback: (() => void) | undefined;
}): Promise<{ client: OAuthClient; url: URL }> {
	const granular = createCliOAuthClient({
		stateDir: input.stateDir,
		redirectUri: input.redirectUri,
	});
	try {
		const { url } = await granular.authorize({
			target: { type: "account", identifier: input.identifier },
		});
		return { client: granular, url };
	} catch (error) {
		if (!(error instanceof OAuthResponseError) || error.error !== "invalid_scope") {
			throw error;
		}
		input.onLegacyScopeFallback?.();
		const legacy = createCliOAuthClient({
			stateDir: input.stateDir,
			redirectUri: input.redirectUri,
			scope: LEGACY_FALLBACK_SCOPE,
		});
		const { url } = await legacy.authorize({
			target: { type: "account", identifier: input.identifier },
		});
		return { client: legacy, url };
	}
}

export async function runInteractiveLogin(
	options: RunInteractiveLoginOptions,
): Promise<RunInteractiveLoginResult> {
	const server = await bindLoopbackServer(options.timeoutMs);
	try {
		const identifier = parseActorIdentifier(options.identifier);
		const { client, url } = await authorizeWithLegacyFallback({
			stateDir: options.stateDir,
			redirectUri: server.redirectUri,
			identifier,
			onLegacyScopeFallback: options.onLegacyScopeFallback,
		});

		options.onUrl?.(url);
		tryOpenBrowser(url.toString());

		const params = await server.awaitCallback();
		try {
			const result = await client.callback(params);
			server.respond({ ok: true });
			return { session: result.session, did: result.session.sub };
		} catch (error) {
			const message = error instanceof Error ? error.message : "Login could not be validated.";
			server.respond({ ok: false, message });
			throw error;
		}
	} finally {
		await server.close();
	}
}

export async function resumeSession(
	did: Did,
	options: { stateDir?: string } = {},
): Promise<OAuthSession> {
	const client = createCliOAuthClient({
		stateDir: options.stateDir,
		redirectUri: "http://127.0.0.1:0/callback",
	});
	return client.restore(did);
}

export async function revokeSession(did: Did, options: { stateDir?: string } = {}): Promise<void> {
	const client = createCliOAuthClient({
		stateDir: options.stateDir,
		redirectUri: "http://127.0.0.1:0/callback",
	});
	try {
		await client.revoke(did);
	} catch {
		const sessions = new FileStore<StoredSession>(
			join(options.stateDir ?? DEFAULT_OAUTH_DIR, "sessions.json"),
		);
		await sessions.delete(did);
	}
}
