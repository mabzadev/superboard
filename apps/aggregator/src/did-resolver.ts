import {
	getPublicKeyFromDidController,
	P256PublicKey,
	Secp256k1PublicKey,
	type PublicKey,
} from "@atcute/crypto";
import { type DidDocument, getAtprotoVerificationMaterial, getPdsEndpoint } from "@atcute/identity";
import { type Did, isDid } from "@atcute/lexicons/syntax";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedDidDoc {
	pds: string;
	signingKey: string;
	signingKeyId: string;
	resolvedAt: Date;
}

export interface DidDocCache {
	read(did: string): Promise<CachedDidDoc | null>;
	upsert(did: string, doc: Omit<CachedDidDoc, "resolvedAt">, now: Date): Promise<void>;
	expire(did: string): Promise<void>;
}

export interface DidDocumentResolverLike {
	resolve(did: Did): Promise<DidDocument>;
}

export interface DidResolverOptions {
	cache: DidDocCache;
	resolver: DidDocumentResolverLike;
	ttlMs?: number;
	now?: () => Date;
}

export interface ResolvedDidDoc {
	pds: string;
	publicKey: PublicKey;
	signingKeyId: string;
}

export class DidResolver {
	private readonly cache: DidDocCache;
	private readonly resolver: DidDocumentResolverLike;
	private readonly ttlMs: number;
	private readonly now: () => Date;

	constructor(opts: DidResolverOptions) {
		this.cache = opts.cache;
		this.resolver = opts.resolver;
		this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
		this.now = opts.now ?? (() => new Date());
	}

	async resolve(did: string): Promise<ResolvedDidDoc> {
		const did_ = asDid(did);
		const now = this.now();
		const cached = await this.cache.read(did_);
		if (cached && now.getTime() - cached.resolvedAt.getTime() < this.ttlMs) {
			return materialise(cached);
		}
		const doc = await this.resolver.resolve(did_);
		const fresh = extractCacheable(doc);
		await this.cache.upsert(did_, fresh, now);
		return materialise({ ...fresh, resolvedAt: now });
	}

	async invalidate(did: string): Promise<void> {
		await this.cache.expire(asDid(did));
	}
}

function asDid(did: string): Did {
	if (!isDid(did)) {
		throw new Error(`invalid DID: ${did}`);
	}
	return did;
}

function extractCacheable(doc: DidDocument): Omit<CachedDidDoc, "resolvedAt"> {
	const pds = getPdsEndpoint(doc);
	if (!pds) {
		throw new Error(`DID document has no atproto PDS service entry: ${doc.id}`);
	}
	const material = getAtprotoVerificationMaterial(doc);
	if (!material) {
		throw new Error(`DID document has no #atproto verification method: ${doc.id}`);
	}
	return {
		pds,
		signingKey: material.publicKeyMultibase,
		signingKeyId: `${doc.id}#atproto`,
	};
}

async function materialise(cached: CachedDidDoc): Promise<ResolvedDidDoc> {
	const found = getPublicKeyFromDidController({
		type: "Multikey",
		publicKeyMultibase: cached.signingKey,
	});
	let publicKey: PublicKey;
	if (found.type === "p256") {
		publicKey = await P256PublicKey.importRaw(found.publicKeyBytes);
	} else if (found.type === "secp256k1") {
		publicKey = await Secp256k1PublicKey.importRaw(found.publicKeyBytes);
	} else {
		const _exhaustive: never = found;
		throw new Error(`unsupported atproto signing key type`);
	}
	return {
		pds: cached.pds,
		publicKey,
		signingKeyId: cached.signingKeyId,
	};
}

export function createD1DidDocCache(db: D1Database): DidDocCache {
	return {
		async read(did: string): Promise<CachedDidDoc | null> {
			const row = await db
				.prepare(
					`SELECT pds, signing_key, signing_key_id, pds_resolved_at
					 FROM known_publishers
					 WHERE did = ?`,
				)
				.bind(did)
				.first<{
					pds: string | null;
					signing_key: string | null;
					signing_key_id: string | null;
					pds_resolved_at: string | null;
				}>();
			if (
				!row ||
				row.pds === null ||
				row.signing_key === null ||
				row.signing_key_id === null ||
				row.pds_resolved_at === null
			) {
				return null;
			}
			return {
				pds: row.pds,
				signingKey: row.signing_key,
				signingKeyId: row.signing_key_id,
				resolvedAt: new Date(row.pds_resolved_at),
			};
		},
		async upsert(did, doc, now): Promise<void> {
			const nowIso = now.toISOString();
			await db
				.prepare(
					`INSERT INTO known_publishers
					   (did, pds, signing_key, signing_key_id, pds_resolved_at, first_seen_at, last_seen_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(did) DO UPDATE SET
					   pds = excluded.pds,
					   signing_key = excluded.signing_key,
					   signing_key_id = excluded.signing_key_id,
					   pds_resolved_at = excluded.pds_resolved_at,
					   last_seen_at = excluded.last_seen_at`,
				)
				.bind(did, doc.pds, doc.signingKey, doc.signingKeyId, nowIso, nowIso, nowIso)
				.run();
		},
		async expire(did): Promise<void> {
			await db
				.prepare(
					`UPDATE known_publishers SET pds_resolved_at = '1970-01-01T00:00:00.000Z'
					 WHERE did = ?`,
				)
				.bind(did)
				.run();
		},
	};
}
