import {
	AtprotoWebDidDocumentResolver,
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
} from "@atcute/identity-resolver";
import { safeParse } from "@atcute/lexicons/validations";
import {
	NSID,
	PackageProfile,
	PackageRelease,
	PackageReleaseExtension,
	PublisherProfile,
	PublisherVerification,
} from "@emdash-cms/registry-lexicons";

import { createD1DidDocCache, DidResolver } from "./did-resolver.js";
import type { RecordsJob } from "./env.js";
import {
	fetchAndVerifyRecord,
	isTransient,
	PdsVerificationError,
	type VerificationFailureReason,
	type VerifiedPdsRecord,
} from "./pds-verify.js";
import { boundFetch, isPlainObject, parseSignatureMetadataCid } from "./utils.js";

export interface ConsumerDeps {
	db: D1Database;
	resolver: DidResolver;
	fetch?: typeof fetch;
	now?: () => Date;
	verify?: (opts: {
		pds: string;
		did: string;
		collection: string;
		rkey: string;
		publicKey: import("@atcute/crypto").PublicKey;
		fetch?: typeof fetch;
	}) => Promise<VerifiedPdsRecord>;
}

export interface MessageController {
	ack(): void;
	retry(): void;
}

export interface MessageBatchLike<T> {
	readonly messages: ReadonlyArray<MessageController & { body: T }>;
}

export type DeadLetterReason =
	| "RECORD_NOT_FOUND"
	| "RESPONSE_TOO_LARGE"
	| "INVALID_PROOF"
	| "PDS_HTTP_ERROR"
	| "LEXICON_VALIDATION_FAILED"
	| "RKEY_MISMATCH"
	| "CONTACT_VALIDATION_FAILED"
	| "INVALID_VERSION"
	| "UNKNOWN_COLLECTION"
	| "UNEXPECTED_ERROR";

export class MissingDependencyError extends Error {
	override readonly name = "MissingDependencyError";
}

export class IngestError extends Error {
	override readonly name = "IngestError";
	constructor(
		readonly reason: DeadLetterReason,
		message: string,
		readonly detail?: string,
	) {
		super(message);
	}
}

export async function processBatch(
	batch: MessageBatchLike<RecordsJob>,
	env: Env,
	depsOverride?: ConsumerDeps,
): Promise<void> {
	const deps = depsOverride ?? createProductionDeps(env);
	for (const message of batch.messages) {
		try {
			await processMessage(message.body, message, deps);
		} catch (err) {
			console.error("[aggregator] processMessage threw unexpectedly", {
				did: message.body.did,
				collection: message.body.collection,
				rkey: message.body.rkey,
				error: err instanceof Error ? err.message : String(err),
			});
			message.retry();
		}
	}
}

export async function drainDeadLetterBatch(
	batch: MessageBatchLike<RecordsJob>,
	env: Env,
): Promise<void> {
	const now = new Date();
	for (const message of batch.messages) {
		const job = message.body;
		console.warn("[aggregator] DLQ drain: acking job", {
			did: job.did,
			collection: job.collection,
			rkey: job.rkey,
			operation: job.operation,
		});
		try {
			await writeDeadLetter(env.DB, job, "UNEXPECTED_ERROR", "drained from DLQ", now);
			message.ack();
		} catch (err) {
			console.error("[aggregator] DLQ drain: failed to write forensics row, retrying", {
				did: job.did,
				rkey: job.rkey,
				error: err instanceof Error ? err.message : String(err),
			});
			message.retry();
		}
	}
}

export async function processMessage(
	job: RecordsJob,
	controller: MessageController,
	deps: ConsumerDeps,
): Promise<void> {
	const now = deps.now ?? (() => new Date());

	if (job.operation === "delete") {
		try {
			await applyDelete(deps.db, job, now());
			controller.ack();
		} catch (err) {
			if (err instanceof IngestError) {
				await writeDeadLetter(deps.db, job, err.reason, err.detail ?? err.message, now());
				controller.ack();
				return;
			}
			console.error("[aggregator] delete failed", {
				did: job.did,
				collection: job.collection,
				rkey: job.rkey,
				error: err instanceof Error ? err.message : String(err),
			});
			controller.retry();
		}
		return;
	}

	try {
		await verifyAndIngest(job, deps);
		controller.ack();
		return;
	} catch (err) {
		if (err instanceof PdsVerificationError) {
			if (isTransient(err.reason, err.status)) {
				controller.retry();
				return;
			}
			let mapped: DeadLetterReason;
			try {
				mapped = mapPdsReason(err.reason);
			} catch (mapErr) {
				console.error("[aggregator] mapPdsReason failed; falling back", {
					reason: err.reason,
					error: mapErr instanceof Error ? mapErr.message : String(mapErr),
				});
				mapped = "UNEXPECTED_ERROR";
			}
			await writeDeadLetter(deps.db, job, mapped, err.message, now());
			controller.ack();
			return;
		}
		if (err instanceof IngestError) {
			await writeDeadLetter(deps.db, job, err.reason, err.detail ?? err.message, now());
			controller.ack();
			return;
		}
		if (err instanceof MissingDependencyError) {
			console.warn("[aggregator] missing dependency, retrying", {
				did: job.did,
				collection: job.collection,
				rkey: job.rkey,
				reason: err.message,
			});
			controller.retry();
			return;
		}
		console.error("[aggregator] unexpected consumer error", {
			did: job.did,
			collection: job.collection,
			rkey: job.rkey,
			error: err instanceof Error ? (err.stack ?? err.message) : String(err),
		});
		await writeDeadLetter(
			deps.db,
			job,
			"UNEXPECTED_ERROR",
			err instanceof Error ? err.message : String(err),
			now(),
		);
		controller.ack();
	}
}

async function verifyAndIngest(job: RecordsJob, deps: ConsumerDeps): Promise<void> {
	const resolved = await deps.resolver.resolve(job.did);
	const verifyFn = deps.verify ?? fetchAndVerifyRecord;
	const verified = await verifyFn({
		pds: resolved.pds,
		did: job.did,
		collection: job.collection,
		rkey: job.rkey,
		publicKey: resolved.publicKey,
		fetch: deps.fetch,
	});

	const now = (deps.now ?? (() => new Date()))();

	switch (job.collection) {
		case NSID.packageProfile:
			return ingestPackageProfile(deps.db, job, verified, now);
		case NSID.packageRelease:
			return ingestPackageRelease(deps.db, job, verified, now);
		case NSID.publisherProfile:
			return ingestPublisherProfile(deps.db, job, verified, now);
		case NSID.publisherVerification:
			return ingestPublisherVerification(deps.db, job, verified, now);
		default:
			throw new IngestError(
				"UNKNOWN_COLLECTION",
				`unsupported collection: ${job.collection}`,
				job.collection,
			);
	}
}

export async function ingestPackageProfile(
	db: D1Database,
	job: RecordsJob,
	verified: VerifiedPdsRecord,
	now: Date,
): Promise<void> {
	const validation = safeParse(PackageProfile.mainSchema, verified.record);
	if (!validation.ok) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			"package.profile failed lexicon validation",
			formatValidationIssues(validation.issues),
		);
	}
	const record = validation.value;
	const expectedId = `at://${job.did}/${NSID.packageProfile}/${job.rkey}`;
	if (record.id !== expectedId) {
		throw new IngestError(
			"RKEY_MISMATCH",
			`package.profile record.id '${record.id}' does not match AT URI '${expectedId}'`,
		);
	}
	if (record.slug !== undefined && record.slug !== job.rkey) {
		throw new IngestError(
			"RKEY_MISMATCH",
			`package.profile rkey '${job.rkey}' does not match record.slug '${record.slug}'`,
		);
	}
	for (const c of record.security) {
		if (!c.url && !c.email) {
			throw new IngestError(
				"CONTACT_VALIDATION_FAILED",
				"package.profile security entry must include at least one of `url` or `email`",
			);
		}
	}
	const slug = record.slug ?? job.rkey;
	const sigMeta = JSON.stringify({ cid: verified.cid });
	const nowIso = now.toISOString();
	const retainRevision = db
		.prepare(
			`INSERT INTO package_profile_revisions
			   (did, slug, cid, type, name, description, license, authors, security,
			    keywords, sections, last_updated, record_blob, signature_metadata,
			    observed_at, last_verified_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(did, slug, cid) DO UPDATE SET
			   record_blob = excluded.record_blob,
			   signature_metadata = excluded.signature_metadata,
			   last_verified_at = excluded.last_verified_at`,
		)
		.bind(
			job.did,
			slug,
			verified.cid,
			record.type,
			record.name ?? null,
			record.description ?? null,
			record.license,
			JSON.stringify(record.authors),
			JSON.stringify(record.security),
			record.keywords ? JSON.stringify(record.keywords) : null,
			record.sections ? JSON.stringify(record.sections) : null,
			record.lastUpdated ?? null,
			verified.carBytes,
			sigMeta,
			nowIso,
			nowIso,
		);
	const updateCurrentPackage = db
		.prepare(
			`INSERT INTO packages
			   (did, slug, type, name, description, license, authors, security, keywords, sections,
			    last_updated, latest_version, capabilities, record_blob, signature_metadata, verified_at, indexed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(did, slug) DO UPDATE SET
			   type = excluded.type,
			   name = excluded.name,
			   description = excluded.description,
			   license = excluded.license,
			   authors = excluded.authors,
			   security = excluded.security,
			   keywords = excluded.keywords,
			   sections = excluded.sections,
			   last_updated = excluded.last_updated,
			   record_blob = excluded.record_blob,
			   signature_metadata = excluded.signature_metadata,
			   verified_at = excluded.verified_at`,
		)
		.bind(
			job.did,
			slug,
			record.type,
			record.name ?? null,
			record.description ?? null,
			record.license,
			JSON.stringify(record.authors),
			JSON.stringify(record.security),
			record.keywords ? JSON.stringify(record.keywords) : null,
			record.sections ? JSON.stringify(record.sections) : null,
			record.lastUpdated ?? null,
			null,
			null,
			verified.carBytes,
			sigMeta,
			nowIso,
			nowIso,
		);
	const moveCurrentPointer = db
		.prepare(
			`INSERT INTO package_profile_heads
			   (did, slug, current_cid, deleted_at, updated_at)
			 VALUES (?, ?, ?, NULL, ?)
			 ON CONFLICT(did, slug) DO UPDATE SET
			   current_cid = excluded.current_cid,
			   deleted_at = NULL,
			   updated_at = excluded.updated_at`,
		)
		.bind(job.did, slug, verified.cid, nowIso);

	await db.batch([retainRevision, updateCurrentPackage, moveCurrentPointer]);
}

export async function ingestPackageRelease(
	db: D1Database,
	job: RecordsJob,
	verified: VerifiedPdsRecord,
	now: Date,
): Promise<void> {
	const validation = safeParse(PackageRelease.mainSchema, verified.record);
	if (!validation.ok) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			"package.release failed lexicon validation",
			formatValidationIssues(validation.issues),
		);
	}
	const record = validation.value;
	if (!PACKAGE_SLUG_RE.test(record.package)) {
		throw new IngestError(
			"RKEY_MISMATCH",
			`package.release record.package '${record.package}' must match ${PACKAGE_SLUG_RE}`,
		);
	}
	const expectedRkey = `${record.package}:${encodeRkeyVersion(record.version)}`;
	if (job.rkey !== expectedRkey) {
		throw new IngestError(
			"RKEY_MISMATCH",
			`package.release rkey '${job.rkey}' does not match expected '${expectedRkey}'`,
		);
	}

	const versionSort = computeVersionSort(record.version);
	if (!versionSort) {
		throw new IngestError(
			"INVALID_VERSION",
			`package.release version '${record.version}' is not parseable as semver`,
		);
	}

	if (!isPlainObject(record.extensions)) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			`package.release extensions field must be an object, got ${typeof record.extensions}`,
		);
	}
	const extension = record.extensions[NSID.packageReleaseExtension];
	if (!extension) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			`package.release missing required extensions['${NSID.packageReleaseExtension}']`,
		);
	}
	const extValidation = safeParse(PackageReleaseExtension.mainSchema, extension);
	if (!extValidation.ok) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			"package.release releaseExtension failed lexicon validation",
			formatValidationIssues(extValidation.issues),
		);
	}

	const parent = await db
		.prepare(
			`SELECT 1
			 FROM packages p
			 JOIN package_profile_heads h ON h.did = p.did AND h.slug = p.slug
			 WHERE p.did = ? AND p.slug = ? AND h.deleted_at IS NULL`,
		)
		.bind(job.did, record.package)
		.first();
	if (!parent) {
		throw new MissingDependencyError(
			`package.release ${job.rkey} requires profile ${record.package} which is not yet ingested`,
		);
	}

	const sigMeta = JSON.stringify({ cid: verified.cid });
	const nowIso = now.toISOString();
	const insertStmt = db
		.prepare(
			`INSERT INTO releases
			   (did, package, version, rkey, version_sort, artifacts, requires, suggests,
			    emdash_extension, repo_url, cts, record_blob, signature_metadata, verified_at, indexed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(did, package, version) DO NOTHING`,
		)
		.bind(
			job.did,
			record.package,
			record.version,
			job.rkey,
			versionSort,
			JSON.stringify(record.artifacts),
			record.requires ? JSON.stringify(record.requires) : null,
			record.suggests ? JSON.stringify(record.suggests) : null,
			JSON.stringify(extValidation.value),
			record.repo ?? null,
			nowIso,
			verified.carBytes,
			sigMeta,
			nowIso,
			nowIso,
		);

	const batchResults = await db.batch([
		insertStmt,
		refreshPackageLatestStmt(db, job.did, record.package),
	]);
	const insertResult = batchResults[0];
	if (!insertResult) {
		throw new Error("D1 batch returned no result for INSERT statement");
	}

	if (insertResult.meta.changes === 0) {
		const existing = await db
			.prepare(
				`SELECT signature_metadata, tombstoned_at
				 FROM releases WHERE did = ? AND package = ? AND version = ?`,
			)
			.bind(job.did, record.package, record.version)
			.first<{ signature_metadata: string; tombstoned_at: string | null }>();
		if (existing) {
			const existingCid = parseSignatureMetadataCid(existing.signature_metadata);
			const sameContent = existingCid === verified.cid;
			if (sameContent && existing.tombstoned_at !== null) {
				await db.batch([
					db
						.prepare(
							`UPDATE releases SET tombstoned_at = NULL
							 WHERE did = ? AND package = ? AND version = ?`,
						)
						.bind(job.did, record.package, record.version),
					refreshPackageLatestStmt(db, job.did, record.package),
				]);
			} else if (!sameContent) {
				await db
					.prepare(
						`INSERT INTO release_duplicate_attempts
						   (did, package, version, attempted_cid, rejected_at, reason, attempted_record_blob)
						 VALUES (?, ?, ?, ?, ?, ?, ?)
						 ON CONFLICT(did, package, version, attempted_cid)
						   DO UPDATE SET
						     rejected_at = excluded.rejected_at,
						     attempted_record_blob = excluded.attempted_record_blob`,
					)
					.bind(
						job.did,
						record.package,
						record.version,
						verified.cid,
						now.toISOString(),
						"IMMUTABLE_VERSION",
						verified.carBytes,
					)
					.run();
			}
		}
	}
}

const REFRESH_PACKAGE_LATEST_SQL = `
	UPDATE packages SET
		latest_version = (
			SELECT version FROM releases
			WHERE did = packages.did AND package = packages.slug AND tombstoned_at IS NULL
			ORDER BY version_sort DESC LIMIT 1
		),
		capabilities = (
			SELECT json_group_array(key) FROM (
				SELECT key FROM json_each(
					(SELECT json_extract(emdash_extension, '$.declaredAccess')
					 FROM releases
					 WHERE did = packages.did AND package = packages.slug AND tombstoned_at IS NULL
					 ORDER BY version_sort DESC LIMIT 1)
				) ORDER BY key
			)
		)
	WHERE did = ? AND slug = ?
		AND (
			latest_version IS NOT (
				SELECT version FROM releases
				WHERE did = packages.did AND package = packages.slug AND tombstoned_at IS NULL
				ORDER BY version_sort DESC LIMIT 1
			)
			OR capabilities IS NOT (
				SELECT json_group_array(key) FROM (
					SELECT key FROM json_each(
						(SELECT json_extract(emdash_extension, '$.declaredAccess')
						 FROM releases
						 WHERE did = packages.did AND package = packages.slug AND tombstoned_at IS NULL
						 ORDER BY version_sort DESC LIMIT 1)
					) ORDER BY key
				)
			)
		)
`;

function refreshPackageLatestStmt(db: D1Database, did: string, pkg: string): D1PreparedStatement {
	return db.prepare(REFRESH_PACKAGE_LATEST_SQL).bind(did, pkg);
}

const REFRESH_PUBLIC_PACKAGE_LATEST_SQL = `
	UPDATE public_packages SET
		latest_version = (
			SELECT version FROM public_releases
			WHERE generation = public_packages.generation
			  AND did = public_packages.did
			  AND package = public_packages.slug
			ORDER BY version_sort DESC, version DESC, rkey DESC LIMIT 1
		),
		capabilities = (
			SELECT json_group_array(key) FROM (
				SELECT key FROM json_each(
					(SELECT json_extract(emdash_extension, '$.declaredAccess')
					 FROM public_releases
					 WHERE generation = public_packages.generation
					   AND did = public_packages.did
					   AND package = public_packages.slug
					 ORDER BY version_sort DESC, version DESC, rkey DESC LIMIT 1)
				) ORDER BY key
			)
		)
	WHERE did = ? AND slug = ?
`;

function refreshPublicPackageLatestStmt(
	db: D1Database,
	did: string,
	pkg: string,
): D1PreparedStatement {
	return db.prepare(REFRESH_PUBLIC_PACKAGE_LATEST_SQL).bind(did, pkg);
}

export async function ingestPublisherProfile(
	db: D1Database,
	job: RecordsJob,
	verified: VerifiedPdsRecord,
	now: Date,
): Promise<void> {
	const validation = safeParse(PublisherProfile.mainSchema, verified.record);
	if (!validation.ok) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			"publisher.profile failed lexicon validation",
			formatValidationIssues(validation.issues),
		);
	}
	const record = validation.value;
	if (job.rkey !== "self") {
		throw new IngestError(
			"RKEY_MISMATCH",
			`publisher.profile rkey must be 'self', got '${job.rkey}'`,
		);
	}
	for (const c of record.contact ?? []) {
		if (!c.url && !c.email) {
			throw new IngestError(
				"CONTACT_VALIDATION_FAILED",
				"publisher.profile contact entry must include at least one of `url` or `email`",
			);
		}
	}
	const sigMeta = JSON.stringify({ cid: verified.cid });
	const nowIso = now.toISOString();
	await db
		.prepare(
			`INSERT INTO publishers
			   (did, display_name, description, url, contact, updated_at,
			    record_blob, signature_metadata, verified_at, indexed_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(did) DO UPDATE SET
			   display_name = excluded.display_name,
			   description = excluded.description,
			   url = excluded.url,
			   contact = excluded.contact,
			   updated_at = excluded.updated_at,
			   record_blob = excluded.record_blob,
			   signature_metadata = excluded.signature_metadata,
			   verified_at = excluded.verified_at`,
		)
		.bind(
			job.did,
			record.displayName,
			record.description ?? null,
			record.url ?? null,
			record.contact ? JSON.stringify(record.contact) : null,
			record.updatedAt ?? null,
			verified.carBytes,
			sigMeta,
			nowIso,
			nowIso,
		)
		.run();
}

export async function ingestPublisherVerification(
	db: D1Database,
	job: RecordsJob,
	verified: VerifiedPdsRecord,
	now: Date,
): Promise<void> {
	const validation = safeParse(PublisherVerification.mainSchema, verified.record);
	if (!validation.ok) {
		throw new IngestError(
			"LEXICON_VALIDATION_FAILED",
			"publisher.verification failed lexicon validation",
			formatValidationIssues(validation.issues),
		);
	}
	const record = validation.value;
	const sigMeta = JSON.stringify({ cid: verified.cid });
	const nowIso = now.toISOString();
	await db
		.prepare(
			`INSERT INTO publisher_verifications
			   (issuer_did, rkey, subject_did, subject_handle, subject_display_name,
			    created_at, expires_at, record_blob, signature_metadata, verified_at, indexed_at, tombstoned_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
			 ON CONFLICT(issuer_did, rkey) DO UPDATE SET
			   subject_did = excluded.subject_did,
			   subject_handle = excluded.subject_handle,
			   subject_display_name = excluded.subject_display_name,
			   created_at = excluded.created_at,
			   expires_at = excluded.expires_at,
			   record_blob = excluded.record_blob,
			   signature_metadata = excluded.signature_metadata,
			   verified_at = excluded.verified_at,
			   tombstoned_at = NULL`,
		)
		.bind(
			job.did,
			job.rkey,
			record.subject,
			record.handle,
			record.displayName,
			record.createdAt,
			record.expiresAt ?? null,
			verified.carBytes,
			sigMeta,
			nowIso,
			nowIso,
		)
		.run();
}

export async function applyDelete(db: D1Database, job: RecordsJob, now: Date): Promise<void> {
	switch (job.collection) {
		case NSID.packageProfile:
			await db.batch([
				db
					.prepare(
						`INSERT INTO package_profile_heads
						   (did, slug, current_cid, deleted_at, updated_at)
						 VALUES (?, ?, NULL, ?, ?)
						 ON CONFLICT(did, slug) DO UPDATE SET
						   deleted_at = excluded.deleted_at,
						   updated_at = excluded.updated_at`,
					)
					.bind(job.did, job.rkey, now.toISOString(), now.toISOString()),
				db
					.prepare(
						`UPDATE releases SET tombstoned_at = ?
						 WHERE did = ? AND package = ? AND tombstoned_at IS NULL`,
					)
					.bind(now.toISOString(), job.did, job.rkey),
				refreshPackageLatestStmt(db, job.did, job.rkey),
				db
					.prepare(`DELETE FROM public_releases WHERE did = ? AND package = ?`)
					.bind(job.did, job.rkey),
				db
					.prepare(`DELETE FROM public_packages WHERE did = ? AND slug = ?`)
					.bind(job.did, job.rkey),
			]);
			return;
		case NSID.packageRelease: {
			const parsed = parseReleaseRkey(job.rkey);
			if (!parsed) {
				throw new IngestError(
					"RKEY_MISMATCH",
					`package.release delete with malformed rkey: '${job.rkey}'`,
				);
			}
			await db.batch([
				db
					.prepare(
						`UPDATE releases SET tombstoned_at = ?
						 WHERE did = ? AND package = ? AND version = ? AND tombstoned_at IS NULL`,
					)
					.bind(now.toISOString(), job.did, parsed.pkg, parsed.version),
				refreshPackageLatestStmt(db, job.did, parsed.pkg),
				db
					.prepare(
						`DELETE FROM public_releases
						 WHERE did = ? AND package = ? AND version = ?`,
					)
					.bind(job.did, parsed.pkg, parsed.version),
				refreshPublicPackageLatestStmt(db, job.did, parsed.pkg),
				db
					.prepare(
						`DELETE FROM public_packages
						 WHERE did = ? AND slug = ?
						   AND NOT EXISTS (
						     SELECT 1 FROM public_releases
						     WHERE generation = public_packages.generation
						       AND did = public_packages.did
						       AND package = public_packages.slug
						   )`,
					)
					.bind(job.did, parsed.pkg),
			]);
			return;
		}
		case NSID.publisherProfile:
			await db.prepare(`DELETE FROM publishers WHERE did = ?`).bind(job.did).run();
			return;
		case NSID.publisherVerification:
			await db
				.prepare(
					`UPDATE publisher_verifications SET tombstoned_at = ?
					 WHERE issuer_did = ? AND rkey = ? AND tombstoned_at IS NULL`,
				)
				.bind(now.toISOString(), job.did, job.rkey)
				.run();
			return;
		default:
			throw new IngestError(
				"UNKNOWN_COLLECTION",
				`delete for unhandled collection: ${job.collection}`,
				job.collection,
			);
	}
}

async function writeDeadLetter(
	db: D1Database,
	job: RecordsJob,
	reason: DeadLetterReason,
	detail: string | null,
	now: Date,
): Promise<void> {
	const payload = JSON.stringify(job.jetstreamRecord ?? { operation: job.operation, cid: job.cid });
	const payloadBytes = new TextEncoder().encode(payload);
	await db
		.prepare(
			`INSERT INTO dead_letters
			   (did, collection, rkey, reason, detail, payload, received_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(job.did, job.collection, job.rkey, reason, detail, payloadBytes, now.toISOString())
		.run();
}

function createProductionDeps(env: Env): ConsumerDeps {
	const composite = new CompositeDidDocumentResolver({
		methods: {
			plc: new PlcDidDocumentResolver({ fetch: boundFetch }),
			web: new AtprotoWebDidDocumentResolver({ fetch: boundFetch }),
		},
	});
	return {
		db: env.DB,
		resolver: new DidResolver({
			cache: createD1DidDocCache(env.DB),
			resolver: composite,
		}),
		fetch: boundFetch,
	};
}

function mapPdsReason(reason: VerificationFailureReason): DeadLetterReason {
	switch (reason) {
		case "RECORD_NOT_FOUND":
		case "RESPONSE_TOO_LARGE":
		case "INVALID_PROOF":
		case "PDS_HTTP_ERROR":
			return reason;
		case "PDS_NETWORK_ERROR":
			throw new Error(
				"unreachable: PDS_NETWORK_ERROR should have been retried by isTransient before reaching mapPdsReason",
			);
		default: {
			const exhaustive: never = reason;
			throw new Error(`unhandled PdsVerificationError reason: ${String(exhaustive)}`);
		}
	}
}

const PACKAGE_SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const PLUS_RE = /\+/g;
function encodeRkeyVersion(version: string): string {
	return version.replace(PLUS_RE, "%2B");
}

function parseReleaseRkey(rkey: string): { pkg: string; version: string } | null {
	const idx = rkey.indexOf(":");
	if (idx <= 0 || idx === rkey.length - 1) return null;
	const pkg = rkey.slice(0, idx);
	if (!PACKAGE_SLUG_RE.test(pkg)) return null;
	const encodedVersion = rkey.slice(idx + 1);
	let version: string;
	try {
		version = decodeURIComponent(encodedVersion);
	} catch {
		return null;
	}
	if (!SEMVER_RE.test(version)) return null;
	return { pkg, version };
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const NUMERIC_RE = /^\d+$/;
const pad = (s: string) => s.padStart(10, "0");

const FINAL_VERSION_SENTINEL = "~";
function computeVersionSort(version: string): string | null {
	const m = SEMVER_RE.exec(version);
	if (!m) return null;
	const major = m[1] ?? "0";
	const minor = m[2] ?? "0";
	const patch = m[3] ?? "0";
	const pre = m[4];
	if (major.length > 10 || minor.length > 10 || patch.length > 10) {
		return null;
	}
	if (pre) {
		const parts = pre.split(".");
		const padded: string[] = [];
		for (const p of parts) {
			if (NUMERIC_RE.test(p)) {
				if (p.length > 10) return null;
				padded.push(pad(p));
			} else {
				padded.push(p);
			}
		}
		return `${pad(major)}.${pad(minor)}.${pad(patch)}.${padded.join(".")}`;
	}
	return `${pad(major)}.${pad(minor)}.${pad(patch)}.${FINAL_VERSION_SENTINEL}`;
}

function formatValidationIssues(issues: unknown): string {
	try {
		return JSON.stringify(issues);
	} catch {
		return String(issues);
	}
}
