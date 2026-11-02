import { isDid, isHandle } from "@atcute/lexicons/syntax";

import {
	type CredentialStore,
	type Did,
	type PublisherSession,
	ReadOnlyCredentialStoreError,
} from "./types.js";

export interface EnvCredentialStoreOptions {
	env?: Record<string, string | undefined>;
}

const ENV_DID = "EMDASH_PUBLISHER_DID";
const ENV_HANDLE = "EMDASH_PUBLISHER_HANDLE";
const ENV_PDS = "EMDASH_PUBLISHER_PDS";

export class EnvCredentialStore implements CredentialStore {
	readonly #env: Record<string, string | undefined>;
	readonly #createdAt = Date.now();

	constructor(options: EnvCredentialStoreOptions = {}) {
		this.#env = options.env ?? process.env;
	}

	async current(): Promise<PublisherSession | null> {
		return this.#read();
	}

	async get(did: Did): Promise<PublisherSession | null> {
		const session = this.#read();
		return session && session.did === did ? session : null;
	}

	async list(): Promise<PublisherSession[]> {
		const session = this.#read();
		return session ? [session] : [];
	}

	async put(): Promise<void> {
		throw new ReadOnlyCredentialStoreError(
			"EnvCredentialStore is read-only; CI must provision credentials via env vars, not via login",
		);
	}

	async setCurrent(): Promise<void> {
		throw new ReadOnlyCredentialStoreError(
			"EnvCredentialStore has at most one session; setCurrent is not meaningful",
		);
	}

	async remove(): Promise<void> {
		throw new ReadOnlyCredentialStoreError(
			"EnvCredentialStore is read-only; rotate credentials by updating env vars instead",
		);
	}

	#read(): PublisherSession | null {
		const did = this.#env[ENV_DID];
		const handle = this.#env[ENV_HANDLE];
		const pds = this.#env[ENV_PDS];
		if (!did || !handle || !pds) return null;
		if (!isDid(did)) {
			throw new Error(`${ENV_DID} is not a valid DID; expected the form "did:method:identifier"`);
		}
		if (!isHandle(handle)) {
			throw new Error(
				`${ENV_HANDLE} is not a valid handle; expected a domain-like form, e.g. "alice.example.com"`,
			);
		}
		return { did, handle, pds, updatedAt: this.#createdAt };
	}
}
