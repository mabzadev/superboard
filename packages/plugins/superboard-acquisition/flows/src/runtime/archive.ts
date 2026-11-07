import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

import type { Env } from "../types";

export function archiveBucket(env: Pick<Env, "ARCHIVE">): R2Bucket {
	return scopedR2Bucket(env.ARCHIVE, R2_FOLDERS.flows);
}
