import type { Kysely } from "kysely";

import { after } from "../after.js";
import type { Database } from "../database/types.js";
import { requestCached } from "../request-cache.js";
import { getRequestContext } from "../request-context.js";
import { BylineSchemaRegistry } from "../schema/byline-registry.js";
import type { BylineFieldDefinition } from "../schema/types.js";
import { createInitLock, type InitLock, initWithLock } from "../utils/init-lock.js";

interface FieldDefsHolder {
	value: BylineFieldDefinition[] | null;
	hasValue: boolean;
	cachedVersion: number;
	lock: InitLock;
}

const HOLDER_KEY = Symbol.for("emdash:byline-field-defs");
const g = globalThis as Record<symbol, unknown>;
const holder: FieldDefsHolder =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-cache.ts)
	(g[HOLDER_KEY] as FieldDefsHolder | undefined) ??
	(() => {
		const h: FieldDefsHolder = {
			value: null,
			hasValue: false,
			cachedVersion: -1,
			lock: createInitLock(),
		};
		g[HOLDER_KEY] = h;
		return h;
	})();

const REQUEST_CACHE_KEY_VERSION = "byline-fields-version";
const REQUEST_CACHE_KEY_DEFS_PREFIX = "byline-field-defs:";

let reclaimDeadlineMs = 10_000;

async function getBylineFieldsVersion(db: Kysely<Database>): Promise<number> {
	return requestCached(REQUEST_CACHE_KEY_VERSION, () => new BylineSchemaRegistry(db).getVersion());
}

export async function getBylineFieldDefs(db: Kysely<Database>): Promise<BylineFieldDefinition[]> {
	const isolated = getRequestContext()?.dbIsIsolated === true;
	const version = await getBylineFieldsVersion(db);
	const dirty = version % 2 !== 0;
	return requestCached(`${REQUEST_CACHE_KEY_DEFS_PREFIX}${version}`, async () => {
		if (isolated || dirty) {
			return new BylineSchemaRegistry(db).listFields();
		}
		return initWithLock<BylineFieldDefinition[]>(
			holder.lock,
			() => (holder.hasValue && holder.cachedVersion === version ? holder.value : null),
			(isCurrentClaim) =>
				(async () => {
					const defs = await new BylineSchemaRegistry(db).listFields();
					if (isCurrentClaim() && version >= holder.cachedVersion) {
						holder.value = defs;
						holder.hasValue = true;
						holder.cachedVersion = version;
					}
					return defs;
				})(),
			{ deadlineMs: reclaimDeadlineMs, anchor: (promise) => after(() => promise) },
		);
	});
}

export function resetBylineFieldDefsCacheForTests(): void {
	holder.value = null;
	holder.hasValue = false;
	holder.cachedVersion = -1;
	holder.lock.ownerStartedAt = null;
	holder.lock.generation = 0;
	reclaimDeadlineMs = 10_000;
}

export function setBylineFieldDefsReclaimDeadlineForTests(ms: number): void {
	reclaimDeadlineMs = ms;
}
