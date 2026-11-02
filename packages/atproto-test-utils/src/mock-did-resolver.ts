import type { AtprotoDid } from "./types.js";

export interface DidDocument {
	id: AtprotoDid;
	alsoKnownAs?: string[];
	verificationMethod: Array<{
		id: string;
		type: string;
		controller: string;
		publicKeyMultibase: string;
	}>;
	service: Array<{
		id: string;
		type: string;
		serviceEndpoint: string;
	}>;
}

export interface BuildDidDocumentOptions {
	did: AtprotoDid;
	signingKeyMultibase: string;
	pdsEndpoint: string;
	handle?: string;
}

export function buildDidDocument(opts: BuildDidDocumentOptions): DidDocument {
	return {
		id: opts.did,
		alsoKnownAs: opts.handle ? [`at://${opts.handle}`] : [],
		verificationMethod: [
			{
				id: `${opts.did}#atproto`,
				type: "Multikey",
				controller: opts.did,
				publicKeyMultibase: opts.signingKeyMultibase,
			},
		],
		service: [
			{
				id: "#atproto_pds",
				type: "AtprotoPersonalDataServer",
				serviceEndpoint: opts.pdsEndpoint,
			},
		],
	};
}

export class MockDidResolver {
	private docs = new Map<AtprotoDid, DidDocument>();

	register(did: AtprotoDid, doc: DidDocument): void {
		this.docs.set(did, doc);
	}

	resolve(did: AtprotoDid): DidDocument | null {
		return this.docs.get(did) ?? null;
	}

	pdsFor(did: AtprotoDid): string | null {
		const doc = this.docs.get(did);
		if (!doc) return null;
		const pds = doc.service.find(
			(s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer",
		);
		return pds?.serviceEndpoint ?? null;
	}

	signingKeyFor(did: AtprotoDid): string | null {
		const doc = this.docs.get(did);
		if (!doc) return null;
		const vm = doc.verificationMethod.find(
			(v) => v.id === `${did}#atproto` || v.id.endsWith("#atproto"),
		);
		return vm?.publicKeyMultibase ?? null;
	}

	clear(): void {
		this.docs.clear();
	}
}
