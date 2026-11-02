import type { Store } from "@atcute/oauth-node-client";

interface StorageCollection<T = unknown> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	deleteMany(ids: string[]): Promise<number>;
	query(options?: { limit?: number }): Promise<{ items: Array<{ id: string; data: T }> }>;
}

interface StoredEntry<V> {
	value: V;
	expiresAt: number | null;
}

export function createDbStore<K extends string, V>(
	getCollection: () => StorageCollection<StoredEntry<V>>,
): Store<K, V> {
	return {
		async get(key: K): Promise<V | undefined> {
			const entry = await getCollection().get(key);
			if (!entry) return undefined;

			if (entry.expiresAt && Date.now() > entry.expiresAt * 1000) {
				await getCollection().delete(key);
				return undefined;
			}
			return entry.value;
		},

		async set(key: K, value: V): Promise<void> {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowing to check optional expiresAt on opaque Store value type
			const expiresAt = (value as { expiresAt?: number }).expiresAt ?? null;
			await getCollection().put(key, { value, expiresAt });
		},

		async delete(key: K): Promise<void> {
			await getCollection().delete(key);
		},

		async clear(): Promise<void> {
			const result = await getCollection().query({ limit: 10000 });
			if (result.items.length > 0) {
				await getCollection().deleteMany(result.items.map((i) => i.id));
			}
		},
	};
}
