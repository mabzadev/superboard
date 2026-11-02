import type { Kysely } from "kysely";

import { CommentReactionRepository } from "../database/repositories/comment-reaction.js";
import { CommentRepository } from "../database/repositories/comment.js";
import type { PublicComment } from "../database/repositories/comment.js";
import type { Database } from "../database/types.js";
import { getDb } from "../loader.js";
import { cachedQuery, CacheNamespace } from "../object-cache/index.js";
import { reactionScore } from "./ranking.js";

export interface GetCommentsOptions {
	collection: string;
	contentId: string;
	threaded?: boolean;
	reactions?: boolean;
	sort?: "oldest" | "best";
}

export interface GetCommentsResult {
	items: PublicComment[];
	total: number;
}

export async function getComments(options: GetCommentsOptions): Promise<GetCommentsResult> {
	const sort = options.sort ?? "oldest";
	const withReactions = options.reactions || sort === "best";
	const threaded = options.threaded ? "t" : "f";
	return cachedQuery({
		namespace: CacheNamespace.COMMENTS,
		key: `comments:${options.collection}:${options.contentId}:${threaded}:${withReactions ? "r" : "n"}:${sort}`,
		load: async () => {
			const db = await getDb();
			return getCommentsWithDb(db, options);
		},
	});
}

export async function getCommentsWithDb(
	db: Kysely<Database>,
	options: GetCommentsOptions,
): Promise<GetCommentsResult> {
	const repo = new CommentRepository(db);

	const total = await repo.countByContent(options.collection, options.contentId, "approved");

	const MAX_COMMENTS = 500;

	const result = await repo.findByContent(options.collection, options.contentId, {
		status: "approved",
		limit: MAX_COMMENTS,
	});

	const items: PublicComment[] = options.threaded
		? CommentRepository.assembleThreads(result.items).map((c) =>
				CommentRepository.toPublicComment(c),
			)
		: result.items.map((c) => CommentRepository.toPublicComment(c));

	if (options.reactions || options.sort === "best") {
		await attachReactions(db, items);
		if (options.sort === "best") {
			sortByBest(items);
		}
	}

	return { items, total };
}

async function attachReactions(db: Kysely<Database>, items: PublicComment[]): Promise<void> {
	const ids: string[] = [];
	for (const comment of items) {
		ids.push(comment.id);
		if (comment.replies) {
			for (const reply of comment.replies) ids.push(reply.id);
		}
	}
	if (ids.length === 0) return;

	const counts = await new CommentReactionRepository(db).countsForComments(ids);

	const assign = (comment: PublicComment) => {
		const reactions = counts.get(comment.id);
		if (reactions) comment.reactions = reactions;
	};
	for (const comment of items) {
		assign(comment);
		comment.replies?.forEach(assign);
	}
}

function sortByBest(items: PublicComment[]): void {
	items.sort((a, b) => {
		const scoreDelta = reactionScore(b.reactions ?? {}) - reactionScore(a.reactions ?? {});
		if (scoreDelta !== 0) return scoreDelta;
		if (a.createdAt < b.createdAt) return -1;
		if (a.createdAt > b.createdAt) return 1;
		return 0;
	});
}

export async function getCommentCount(collection: string, contentId: string): Promise<number> {
	const db = await getDb();
	return getCommentCountWithDb(db, collection, contentId);
}

export async function getCommentCountWithDb(
	db: Kysely<Database>,
	collection: string,
	contentId: string,
): Promise<number> {
	const repo = new CommentRepository(db);
	return repo.countByContent(collection, contentId, "approved");
}
