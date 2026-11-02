import type { Did, Handle } from "@atcute/lexicons";

export type { Did, Handle };

export interface PublisherSession {
	did: Did;

	handle: string | null;

	pds: string;

	updatedAt: number;
}

export interface CredentialStore {
	current(): Promise<PublisherSession | null>;

	get(did: Did): Promise<PublisherSession | null>;

	list(): Promise<PublisherSession[]>;

	put(session: PublisherSession): Promise<void>;

	setCurrent(did: Did): Promise<void>;

	remove(did: Did): Promise<void>;
}

export class ReadOnlyCredentialStoreError extends Error {
	constructor(message = "credential store is read-only") {
		super(message);
		this.name = "ReadOnlyCredentialStoreError";
	}
}
