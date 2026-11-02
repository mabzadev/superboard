export {
	type BuildErrorCode,
	type BuildLogger,
	type BuildOptions,
	type BuildResult,
	BuildError,
	buildPlugin,
} from "./build/api.js";

export {
	type BundleErrorCode,
	type BundleLogger,
	type BundleOptions,
	type BundleResult,
	BundleError,
	bundlePlugin,
} from "./bundle/api.js";

export {
	type ProfileBootstrap,
	type ProfileInput,
	type PublishErrorCode,
	type PublishLogger,
	type PublishOptions,
	type PublishResult,
	PublishError,
	publishRelease,
} from "./publish/api.js";

export {
	deriveSlugFromId,
	isPluginSlug,
	isPluginVersion,
	PLUGIN_SLUG_RE,
	PLUGIN_VERSION_RE,
} from "@emdash-cms/plugin-types";

export {
	type CurrentPluginCapability,
	type DeprecatedPluginCapability,
	type ManifestHookEntry,
	type ManifestRouteEntry,
	type PluginAdminConfig,
	type PluginCapability,
	type PluginManifest,
	type PluginStorageConfig,
	type StorageCollectionConfig,
	CAPABILITY_RENAMES,
	isDeprecatedCapability,
	normalizeCapabilities,
	normalizeCapability,
} from "@emdash-cms/plugin-types";

export { sha256Multihash } from "./multihash.js";
