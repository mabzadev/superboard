import type { Storage } from "../../index.js";

export interface StorageDescriptor {
	entrypoint: string;
	config: unknown;
}

export type CreateStorageFn = (config: Record<string, unknown>) => Storage;

export interface S3StorageConfig {
	endpoint: string;
	bucket: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	region?: string;
	publicUrl?: string;
}

export interface LocalStorageConfig {
	directory: string;
	baseUrl: string;
}
