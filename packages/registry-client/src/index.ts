export { ClientResponseError } from "@atcute/client";

export {
	type CredentialStore,
	type Did,
	type FileCredentialStoreOptions,
	type Handle,
	type PublisherSession,
	EnvCredentialStore,
	FileCredentialStore,
	MemoryCredentialStore,
	ReadOnlyCredentialStoreError,
	defaultCredentialStore,
} from "./credentials/index.js";

export { type PublishingClientFromHandlerOptions, PublishingClient } from "./publishing/index.js";

export { type DiscoveryClientOptions, DiscoveryClient } from "./discovery/index.js";

export {
	type ApprovedListing,
	type ListingStatusResult,
	type RegistryLabelerPolicy,
	type UnavailableListing,
	registryLabelerPolicy,
	registryLabelerPolicyKey,
} from "./listing-policy.js";

export {
	type RegistryReleaseWithdrawalOptions,
	type RegistryReleaseWithdrawalResult,
	evaluateRegistryReleaseWithdrawal,
} from "./withdrawal.js";

export {
	type EnvMismatch,
	type HostEnv,
	type SkippedEnvConstraint,
	checkEnvCompatibility,
	findSkippedEnvConstraints,
	hostEnvFromVersions,
	isValidVersionRange,
	parseRequires,
	satisfiesRange,
} from "./env/index.js";
