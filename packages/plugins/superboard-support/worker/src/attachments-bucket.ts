import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

import type { Env } from "./types";

export function attachmentsBucket(env: Pick<Env, "ATTACHMENTS">): R2Bucket {
	return scopedR2Bucket(env.ATTACHMENTS, R2_FOLDERS.support);
}
