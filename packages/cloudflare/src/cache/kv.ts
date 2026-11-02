import { env } from "cloudflare:workers";
import type { CreateObjectCacheBackendFn, ObjectCacheBackend } from "emdash";

const KV_MIN_TTL_SECONDS = 60;

const DEFAULT_KV_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	if (!(ms > 0)) return promise;
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`KV ${label} timed out after ${ms}ms`)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const createObjectCache: CreateObjectCacheBackendFn = (config): ObjectCacheBackend => {
	const binding = typeof config.binding === "string" ? config.binding : "";
	if (!binding) {
		throw new Error("KV object-cache requires a `binding` name in its config.");
	}

	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- KVNamespace binding accessed from untyped env object
	const kv = (env as Record<string, unknown>)[binding] as KVNamespace | undefined;
	if (!kv) {
		throw new Error(
			`KV binding "${binding}" not found. Add it to wrangler.jsonc:\n\n` +
				`{\n  "kv_namespaces": [{ "binding": "${binding}", "id": "<namespace-id>" }]\n}\n\n` +
				`and ensure you're running on Cloudflare Workers.`,
		);
	}

	const timeout =
		typeof config.timeout === "number" && config.timeout >= 0
			? config.timeout
			: DEFAULT_KV_TIMEOUT_MS;

	return {
		async get(key: string): Promise<string | null> {
			return (await withTimeout(kv.get(key, "text"), timeout, "get")) ?? null;
		},
		async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
			const put =
				ttlSeconds && ttlSeconds > 0
					? kv.put(key, value, {
							expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.floor(ttlSeconds)),
						})
					: kv.put(key, value);
			await withTimeout(put, timeout, "put");
		},
		async delete(key: string): Promise<void> {
			await withTimeout(kv.delete(key), timeout, "delete");
		},
	};
};
