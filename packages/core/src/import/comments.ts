import type { Kysely } from "kysely";
import { ulid } from "ulidx";

import type { Database } from "../database/types.js";
import { invalidateCommentObjectCache } from "../object-cache/index.js";

export interface PluginComment {
	id: number;
	post_id: number;
	parent_id: number | null;
	author_name: string;
	author_email: string;
	body: string;
	date_gmt: string;
	status: "approved" | "pending";
}

export interface CommentsImportResult {
	imported: number;
	skipped: number;
	errors: Array<{ comment: string; error: string }>;
}

export async function importCommentsFromPlugin(
	comments: PluginComment[],
	db: Kysely<Database>,
	contentIdMap: Map<number, string>,
	collectionMap: Map<number, string>,
	rootIds?: Map<number, string>,
): Promise<CommentsImportResult> {
	const result: CommentsImportResult = {
		imported: 0,
		skipped: 0,
		errors: [],
	};

	const commentIdMap = new Map<number, string>();

	const rootIdMap = rootIds ?? new Map<number, string>();

	const sorted = comments.toSorted((a, b) => a.id - b.id);

	for (const comment of sorted) {
		const label = `${comment.author_name || "Anonymous"} (${comment.date_gmt})`;
		try {
			const contentId = contentIdMap.get(comment.post_id);
			const collection = collectionMap.get(comment.post_id);
			if (!contentId || !collection) {
				result.skipped++;
				continue;
			}

			const parsed = new Date(comment.date_gmt);
			const createdAt = Number.isNaN(parsed.getTime())
				? new Date().toISOString()
				: parsed.toISOString();

			const existing = await db
				.selectFrom("_emdash_comments")
				.select("id")
				.where("content_id", "=", contentId)
				.where("author_email", "=", comment.author_email)
				.where("created_at", "=", createdAt)
				.where("body", "=", comment.body)
				.executeTakeFirst();
			const parentId =
				comment.parent_id !== null ? (rootIdMap.get(comment.parent_id) ?? null) : null;

			if (existing) {
				commentIdMap.set(comment.id, existing.id);
				rootIdMap.set(comment.id, parentId ?? existing.id);
				result.skipped++;
				continue;
			}

			const id = ulid();

			await db
				.insertInto("_emdash_comments")
				.values({
					id,
					collection,
					content_id: contentId,
					parent_id: parentId,
					author_name: comment.author_name || "Anonymous",
					author_email: comment.author_email,
					author_user_id: null,
					body: comment.body,
					status: comment.status,
					ip_hash: null,
					user_agent: null,
					moderation_metadata: null,
					created_at: createdAt,
					updated_at: createdAt,
				})
				.execute();

			commentIdMap.set(comment.id, id);
			rootIdMap.set(comment.id, parentId ?? id);
			result.imported++;
		} catch (error) {
			result.errors.push({
				comment: label,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (result.imported > 0) {
		invalidateCommentObjectCache();
	}

	return result;
}
