import type { CreateObjectCacheBackendFn, ObjectCacheBackend } from "./types.js";

interface Entry {
	value: string;
	expiresAt: number | null;
}

interface MemoryStore {
	map: Map<string, Entry>;
	maxEntries: number;
}

const STORE_KEY = Symbol.for("emdash:object-cache:memory");
const g = globalThis as Record<symbol, unknown>;

function getStore(maxEntries: number): MemoryStore {
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	const existing = g[STORE_KEY] as MemoryStore | undefined;
	if (existing) {
		return existing;
	}
	const store: MemoryStore = { map: new Map(), maxEntries };
	g[STORE_KEY] = store;
	return store;
}

export const createObjectCache: CreateObjectCacheBackendFn = (config): ObjectCacheBackend => {
	const maxEntries = typeof config.maxEntries === "number" ? config.maxEntries : 1000;
	const store = getStore(maxEntries);

	return {
		get(key: string): Promise<string | null> {
			const entry = store.map.get(key);
			if (!entry) return Promise.resolve(null);
			if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
				store.map.delete(key);
				return Promise.resolve(null);
			}
			return Promise.resolve(entry.value);
		},
		set(key: string, value: string, ttlSeconds?: number): Promise<void> {
			store.map.delete(key);
			store.map.set(key, {
				value,
				expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
			});
			while (store.map.size > store.maxEntries) {
				const oldest = store.map.keys().next().value;
				if (oldest === undefined) break;
				store.map.delete(oldest);
			}
			return Promise.resolve();
		},
		delete(key: string): Promise<void> {
			store.map.delete(key);
			return Promise.resolve();
		},
	};
};
