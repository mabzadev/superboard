import type { Kysely } from "kysely";

import { CommentRepository } from "../database/repositories/comment.js";
import type { Comment, CommentStatus } from "../database/repositories/comment.js";
import type { Database } from "../database/types.js";
import type {
	CollectionCommentSettings,
	CommentAfterCreateEvent,
	CommentAfterModerateEvent,
	CommentBeforeCreateEvent,
	CommentModerateEvent,
	ModerationDecision,
	StoredComment,
} from "../plugins/types.js";

export interface CommentCreateInput {
	collection: string;
	contentId: string;
	parentId?: string | null;
	authorName: string;
	authorEmail: string;
	authorUserId?: string | null;
	body: string;
	ipHash?: string | null;
	userAgent?: string | null;
}

export interface CommentCreateResult {
	comment: Comment;
	decision: ModerationDecision;
}

export interface CommentHookRunner {
	runBeforeCreate(event: CommentBeforeCreateEvent): Promise<CommentBeforeCreateEvent | false>;

	runModerate(event: CommentModerateEvent): Promise<ModerationDecision>;

	fireAfterCreate(event: CommentAfterCreateEvent): void;

	fireAfterModerate(event: CommentAfterModerateEvent): void;
}

export async function createComment(
	db: Kysely<Database>,
	input: CommentCreateInput,
	collectionSettings: CollectionCommentSettings,
	hooks: CommentHookRunner,
	contentInfo?: {
		id: string;
		collection: string;
		slug: string;
		title?: string;
		author?: { id: string; name: string | null; email: string };
	},
): Promise<CommentCreateResult | null> {
	const repo = new CommentRepository(db);

	const beforeCreateEvent: CommentBeforeCreateEvent = {
		comment: {
			collection: input.collection,
			contentId: input.contentId,
			parentId: input.parentId ?? null,
			authorName: input.authorName,
			authorEmail: input.authorEmail,
			authorUserId: input.authorUserId ?? null,
			body: input.body,
			ipHash: input.ipHash ?? null,
			userAgent: input.userAgent ?? null,
		},
		metadata: {},
	};

	const result = await hooks.runBeforeCreate(beforeCreateEvent);
	if (result === false) {
		return null;
	}

	const event = result;

	const priorApprovedCount = await repo.countApprovedByEmail(event.comment.authorEmail);

	const moderateEvent: CommentModerateEvent = {
		comment: event.comment,
		metadata: event.metadata,
		collectionSettings,
		priorApprovedCount,
	};

	const decision = await hooks.runModerate(moderateEvent);

	const comment = await repo.create({
		collection: event.comment.collection,
		contentId: event.comment.contentId,
		parentId: event.comment.parentId,
		authorName: event.comment.authorName,
		authorEmail: event.comment.authorEmail,
		authorUserId: event.comment.authorUserId,
		body: event.comment.body,
		status: decision.status,
		ipHash: event.comment.ipHash,
		userAgent: event.comment.userAgent,
		moderationMetadata: Object.keys(event.metadata).length > 0 ? event.metadata : null,
	});

	if (contentInfo) {
		const afterEvent: CommentAfterCreateEvent = {
			comment: commentToStored(comment),
			metadata: event.metadata,
			content: {
				id: contentInfo.id,
				collection: contentInfo.collection,
				slug: contentInfo.slug,
				title: contentInfo.title,
			},
			contentAuthor: contentInfo.author,
		};
		hooks.fireAfterCreate(afterEvent);
	}

	return { comment, decision };
}

export async function moderateComment(
	db: Kysely<Database>,
	id: string,
	newStatus: CommentStatus,
	moderator: { id: string; name: string | null },
	hooks: CommentHookRunner,
): Promise<Comment | null> {
	const repo = new CommentRepository(db);
	const existing = await repo.findById(id);
	if (!existing) return null;

	const previousStatus = existing.status;
	const updated = await repo.updateStatus(id, newStatus);
	if (!updated) return null;

	const afterEvent: CommentAfterModerateEvent = {
		comment: commentToStored(updated),
		previousStatus,
		newStatus,
		moderator,
	};
	hooks.fireAfterModerate(afterEvent);

	return updated;
}

function commentToStored(comment: Comment): StoredComment {
	return {
		id: comment.id,
		collection: comment.collection,
		contentId: comment.contentId,
		parentId: comment.parentId,
		authorName: comment.authorName,
		authorEmail: comment.authorEmail,
		authorUserId: comment.authorUserId,
		body: comment.body,
		status: comment.status,
		moderationMetadata: comment.moderationMetadata,
		createdAt: comment.createdAt,
		updatedAt: comment.updatedAt,
	};
}
