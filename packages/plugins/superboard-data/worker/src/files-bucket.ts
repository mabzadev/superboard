import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

import type { FilesEnv } from "./index.js";

export function filesBucket(env: Pick<FilesEnv, "FILES">): R2Bucket {
	return scopedR2Bucket(env.FILES, R2_FOLDERS.files);
}
