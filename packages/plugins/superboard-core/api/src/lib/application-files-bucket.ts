import { R2_FOLDERS, scopedR2Bucket } from "@superboard/contracts/r2";

export function applicationFilesBucket(bucket: R2Bucket): R2Bucket {
	return scopedR2Bucket(bucket, R2_FOLDERS.files);
}
