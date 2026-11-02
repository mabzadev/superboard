export type {
	EmDashHandlers,
	EmDashManifest,
	MediaItem,
	ContentItem,
	ManifestCollection,
} from "./types.js";

export { local, s3 } from "./storage/index.js";
export type { StorageDescriptor, LocalStorageConfig, S3StorageConfig } from "./storage/index.js";

export { memoryCache } from "./object-cache/adapters.js";
export type { MemoryCacheOptions } from "./object-cache/adapters.js";
export type { ObjectCacheDescriptor, ObjectCacheRuntimeConfig } from "../object-cache/types.js";

export { default } from "./integration/index.js";
export { getStoredConfig } from "./integration/runtime.js";
export type { EmDashConfig, ResolvedPlugin } from "./integration/runtime.js";
