import { createKyselyAdapter, type AuthTables } from "@emdash-cms/auth/adapters/kysely";
import type { Kysely } from "kysely";

import { cleanupExpiredChallenges } from "./auth/challenge-store.js";
import { MediaRepository } from "./database/repositories/media.js";
import { RevisionRepository } from "./database/repositories/revision.js";
import type { Database } from "./database/types.js";
import { removeUploadAttempt } from "./media/upload-attempts.js";
import { cleanupMediaUsage } from "./media/usage/cleanup.js";
import type { Storage } from "./storage/types.js";

export interface CleanupResult {
	challenges: number;
	expiredTokens: number;
	pendingUploads: number;
	pendingUploadFiles: number;
	uploadAttempts: number;
	revisionsPruned: number;
	mediaUsage: number;
}

const REVISION_KEEP_COUNT = 50;
const REVISION_PRUNE_BATCH_SIZE = 10;

export async function runSystemCleanup(
	db: Kysely<Database>,
	storage?: Storage,
): Promise<CleanupResult> {
	const result: CleanupResult = {
		challenges: -1,
		expiredTokens: -1,
		pendingUploads: -1,
		pendingUploadFiles: -1,
		uploadAttempts: -1,
		revisionsPruned: -1,
		mediaUsage: -1,
	};

	try {
		result.challenges = await cleanupExpiredChallenges(db);
	} catch (error) {
		console.error("[cleanup] Failed to clean expired challenges:", error);
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Database uses Generated<> wrappers incompatible with AuthTables structurally; safe at runtime
		const authAdapter = createKyselyAdapter(db as unknown as Kysely<AuthTables>);
		await authAdapter.deleteExpiredTokens();
		result.expiredTokens = 0;
	} catch (error) {
		console.error("[cleanup] Failed to clean expired tokens:", error);
	}

	try {
		const mediaRepo = new MediaRepository(db);
		const orphanedKeys = await mediaRepo.cleanupPendingUploads();
		result.pendingUploads = orphanedKeys.length;

		if (storage && orphanedKeys.length > 0) {
			let filesDeleted = 0;
			for (const key of orphanedKeys) {
				try {
					await storage.delete(key);
					filesDeleted++;
				} catch (error) {
					console.error(`[cleanup] Failed to delete storage file ${key}:`, error);
				}
			}
			result.pendingUploadFiles = filesDeleted;
		} else {
			result.pendingUploadFiles = 0;
		}
	} catch (error) {
		console.error("[cleanup] Failed to clean pending uploads:", error);
	}

	try {
		const mediaRepo = new MediaRepository(db);
		const completedAttemptsDeleted = await mediaRepo.deleteCompletedUploadAttempts();
		if (!storage) {
			result.uploadAttempts = completedAttemptsDeleted;
		} else {
			const storageKeys = await mediaRepo.findUploadAttemptsForCleanup();
			let attemptsDeleted = completedAttemptsDeleted;
			for (const storageKey of storageKeys) {
				if (await removeUploadAttempt(storage, mediaRepo, storageKey)) {
					attemptsDeleted++;
				}
			}
			result.uploadAttempts = attemptsDeleted;
		}
	} catch (error) {
		console.error("[cleanup] Failed to clean media upload attempts:", error);
	}

	try {
		result.revisionsPruned = await pruneQueuedRevisions(db);
	} catch (error) {
		console.error("[cleanup] Failed to prune revisions:", error);
	}

	try {
		const mediaUsage = await cleanupMediaUsage(db);
		result.mediaUsage = mediaUsage.status === "failed" ? -1 : mediaUsage.deletedRows;
	} catch (error) {
		console.error("[cleanup] Failed to clean media usage:", error);
	}

	return result;
}

async function pruneQueuedRevisions(db: Kysely<Database>): Promise<number> {
	const queued = await db
		.selectFrom("_emdash_revision_prune_queue")
		.selectAll()
		.orderBy("revision_id")
		.limit(REVISION_PRUNE_BATCH_SIZE)
		.execute();
	const revisionRepo = new RevisionRepository(db);
	let totalPruned = 0;

	for (const row of queued) {
		try {
			totalPruned += await revisionRepo.pruneQueuedEntry(
				row.collection,
				row.entry_id,
				row.revision_id,
				REVISION_KEEP_COUNT,
			);
		} catch (error) {
			console.error(
				`[cleanup] Failed to prune revisions for ${row.collection}/${row.entry_id}:`,
				error,
			);
		}
	}

	return totalPruned;
}
