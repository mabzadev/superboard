import type { Kysely } from "kysely";

import type { Database } from "../database/types.js";
import { createStorageAccess } from "../plugins/context.js";
import type { StorageCollection, StorageCollectionConfig } from "../plugins/types.js";

export function getAuthProviderStorage(
	db: Kysely<Database>,
	providerId: string,
	storageConfig: Record<string, StorageCollectionConfig>,
): Record<string, StorageCollection> {
	return createStorageAccess(db, `auth:${providerId}`, storageConfig);
}
