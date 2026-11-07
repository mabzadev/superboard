import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

import type { Env } from "./types";

export function mediaBucket(env: Pick<Env, "MEDIA">): R2Bucket {
	return scopedR2Bucket(env.MEDIA, R2_FOLDERS.marketing);
}
