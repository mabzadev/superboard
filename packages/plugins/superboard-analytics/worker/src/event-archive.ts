import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

import type { Env } from "./types";

export function eventArchiveBucket(env: Pick<Env, "EVENT_ARCHIVE">): R2Bucket {
	return scopedR2Bucket(env.EVENT_ARCHIVE, R2_FOLDERS.analytics);
}
