import { parseDidKey } from "@atproto/crypto";

import { FakeRepo, type FakeRepoOptions } from "./fake-repo.js";

const DID_KEY_PREFIX_RE = /^did:key:/;
import { MockDidResolver, buildDidDocument } from "./mock-did-resolver.js";
import { MockJetstream } from "./mock-jetstream.js";
import { MockPds } from "./mock-pds.js";
import { PROFILE_NSID, RELEASE_NSID } from "./nsid.js";
import type { AtprotoDid } from "./types.js";

export { PROFILE_NSID, RELEASE_NSID } from "./nsid.js";

export interface FakePublisherOptions extends FakeRepoOptions {
	handle?: string;
	pdsBaseUrl?: string;
}

export interface PublishProfileOptions {
	slug: string;
	license: string;
	authors?: Array<{ name: string; url?: string; email?: string }>;
	securityEmail?: string;
	securityUrl?: string;
}

export interface PublishReleaseOptions {
	slug: string;
	version: string;
	checksum: string;
	url: string;
	declaredAccess?: Record<string, unknown>;
}

export class FakePublisher {
	readonly repo: FakeRepo;
	readonly handle?: string;

	private constructor(repo: FakeRepo, handle?: string) {
		this.repo = repo;
		this.handle = handle;
	}

	static async create(repo: FakeRepo, handle?: string): Promise<FakePublisher> {
		return new FakePublisher(repo, handle);
	}

	get did(): AtprotoDid {
		return this.repo.did;
	}

	async publishProfile(opts: PublishProfileOptions): Promise<{ rkey: string }> {
		const security: Array<Record<string, string>> = [];
		if (opts.securityEmail) security.push({ email: opts.securityEmail });
		if (opts.securityUrl) security.push({ url: opts.securityUrl });
		if (security.length === 0) {
			throw new Error(
				"publishProfile: pass at least one of securityEmail or securityUrl. " +
					"The profile lexicon requires `security` minLength: 1.",
			);
		}
		const authors = opts.authors ?? [{ name: this.handle ?? "Test Publisher" }];
		if (authors.length === 0) {
			throw new Error(
				"publishProfile: `authors` cannot be empty. The profile lexicon requires minLength: 1.",
			);
		}
		const value: Record<string, unknown> = {
			$type: PROFILE_NSID,
			id: `at://${this.repo.did}/${PROFILE_NSID}/${opts.slug}`,
			slug: opts.slug,
			type: "emdash-plugin",
			license: opts.license,
			authors,
			security,
			lastUpdated: new Date().toISOString(),
		};
		await this.repo.putRecord(PROFILE_NSID, opts.slug, value);
		return { rkey: opts.slug };
	}

	async publishRelease(opts: PublishReleaseOptions): Promise<{ rkey: string }> {
		const rkey = `${opts.slug}:${opts.version}`;
		const value: Record<string, unknown> = {
			$type: RELEASE_NSID,
			package: opts.slug,
			version: opts.version,
			artifacts: {
				package: {
					url: opts.url,
					checksum: opts.checksum,
					contentType: "application/gzip",
				},
			},
			extensions: {
				"com.emdashcms.experimental.package.releaseExtension": {
					$type: "com.emdashcms.experimental.package.releaseExtension",
					declaredAccess: opts.declaredAccess ?? {},
				},
			},
		};
		await this.repo.putRecord(RELEASE_NSID, rkey, value);
		return { rkey };
	}
}

export interface FakePublisherFixture {
	pds: MockPds;
	didResolver: MockDidResolver;
	jetstream: MockJetstream;
	pdsBaseUrl: string;
	createPublisher(opts: FakePublisherOptions): Promise<FakePublisher>;
}

export interface CreateFakePublisherFixtureOptions {
	pdsBaseUrl?: string;
}

export function createFakePublisherFixture(
	opts: CreateFakePublisherFixtureOptions = {},
): FakePublisherFixture {
	const pds = new MockPds();
	const didResolver = new MockDidResolver();
	const jetstream = new MockJetstream();
	const pdsBaseUrl = opts.pdsBaseUrl ?? "https://pds.mock.test";

	return {
		pds,
		didResolver,
		jetstream,
		pdsBaseUrl,
		async createPublisher(publisherOpts): Promise<FakePublisher> {
			const repo = await FakeRepo.create(publisherOpts);
			pds.mount(repo);
			const didKey = repo.didKey();
			const signingKeyMultibase = didKey.replace(DID_KEY_PREFIX_RE, "");
			const doc = buildDidDocument({
				did: repo.did,
				signingKeyMultibase,
				pdsEndpoint: publisherOpts.pdsBaseUrl ?? pdsBaseUrl,
				handle: publisherOpts.handle,
			});
			didResolver.register(repo.did, doc);
			return FakePublisher.create(repo, publisherOpts.handle);
		},
	};
}

export function publisherDidKey(repo: FakeRepo): string {
	return repo.didKey();
}

export { parseDidKey };
