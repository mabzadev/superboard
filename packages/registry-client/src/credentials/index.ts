import { EnvCredentialStore } from "./env.js";
import { FileCredentialStore } from "./file.js";
import type { CredentialStore } from "./types.js";

export {
	type CredentialStore,
	type Did,
	type Handle,
	type PublisherSession,
	ReadOnlyCredentialStoreError,
} from "./types.js";

export { EnvCredentialStore } from "./env.js";
export { FileCredentialStore, type FileCredentialStoreOptions } from "./file.js";
export { MemoryCredentialStore } from "./memory.js";

export function defaultCredentialStore(
	env: Record<string, string | undefined> = process.env,
): CredentialStore {
	if (
		env["EMDASH_PUBLISHER_DID"] &&
		env["EMDASH_PUBLISHER_HANDLE"] &&
		env["EMDASH_PUBLISHER_PDS"]
	) {
		return new EnvCredentialStore({ env });
	}
	return new FileCredentialStore();
}
