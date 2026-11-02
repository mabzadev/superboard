import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";
import { getDb } from "../loader.js";
import { cachedQuery, CacheNamespace } from "../object-cache/index.js";
import { requestCached } from "../request-cache.js";
import { SchemaRegistry } from "./registry.js";
import type { Collection } from "./types.js";

export async function getCollectionInfo(slug: string): Promise<Collection | null> {
	return requestCached(`collection-info:${slug}`, () =>
		cachedQuery({
			namespace: CacheNamespace.SCHEMA,
			key: `collection-info:${slug}`,
			load: async () => {
				const db = await getDb();
				return getCollectionInfoWithDb(db, slug);
			},
		}),
	);
}

export async function getCollectionInfoWithDb(
	db: Kysely<Database>,
	slug: string,
): Promise<Collection | null> {
	const registry = new SchemaRegistry(db);
	return registry.getCollection(slug);
}
