import type { StorageDescriptor, S3StorageConfig, LocalStorageConfig } from "./types.js";

export function s3(config: Partial<S3StorageConfig> = {}): StorageDescriptor {
	return {
		entrypoint: "emdash/storage/s3",
		config,
	};
}

export function local(config: LocalStorageConfig): StorageDescriptor {
	return {
		entrypoint: "emdash/storage/local",
		config,
	};
}
