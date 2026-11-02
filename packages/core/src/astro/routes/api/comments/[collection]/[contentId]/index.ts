import type { APIRoute } from "astro";

import { apiError, apiSuccess, handleError, requireDb, unwrapResult } from "#api/error.js";
import { handleCommentList, checkRateLimit, hashIp } from "#api/handlers/comments.js";
import { isParseError, parseBody } from "#api/parse.js";
import { createCommentBody } from "#api/schemas.js";
import { getSiteBaseUrl } from "#api/site-url.js";
import { sendCommentNotification } from "#comments/notifications.js";
import { createComment, type CommentHookRunner } from "#comments/service.js";
import { getTurnstileSecretKey, verifyTurnstileToken } from "#comments/turnstile.js";
import { resolveSecretsCached } from "#config/secrets.js";
import { CommentRepository } from "#db/repositories/comment.js";
import { validateIdentifier } from "#db/validate.js";
import { extractRequestMeta } from "#plugins/request-meta.js";
import type { CollectionCommentSettings, ModerationDecision } from "#plugins/types.js";

export const prerender = false;

export const GET: APIRoute = async ({ params, url, locals }) => {
	const { emdash } = locals;
	const { collection, contentId } = params;

	if (!collection || !contentId) {
		return apiError("VALIDATION_ERROR", "Collection and content ID required", 400);
	}

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	try {
		const limit = Math.min(Number(url.searchParams.get("limit") || 50), 100);
		const cursor = url.searchParams.get("cursor") ?? undefined;
		const threaded = url.searchParams.get("threaded") === "true";

		const collectionRow = await emdash.db
			.selectFrom("_emdash_collections")
			.select(["comments_enabled"])
			.where("slug", "=", collection)
			.executeTakeFirst();

		if (!collectionRow) {
			return apiError("NOT_FOUND", `Collection '${collection}' not found`, 404);
		}

		if (!collectionRow.comments_enabled) {
			return apiError("COMMENTS_DISABLED", "Comments are not enabled for this collection", 403);
		}

		const result = await handleCommentList(emdash.db, collection, contentId, {
			limit,
			cursor,
			threaded,
		});

		return unwrapResult(result);
	} catch (error) {
		return handleError(error, "Failed to list comments", "COMMENT_LIST_ERROR");
	}
};

export const POST: APIRoute = async ({ params, request, locals }) => {
	const { emdash, user } = locals;
	const { collection, contentId } = params;

	if (!collection || !contentId) {
		return apiError("VALIDATION_ERROR", "Collection and content ID required", 400);
	}

	const dbErr = requireDb(emdash?.db);
	if (dbErr) return dbErr;

	try {
		const body = await parseBody(request, createCommentBody);
		if (isParseError(body)) return body;

		const collectionRow = await emdash.db
			.selectFrom("_emdash_collections")
			.select([
				"comments_enabled",
				"comments_moderation",
				"comments_closed_after_days",
				"comments_auto_approve_users",
			])
			.where("slug", "=", collection)
			.executeTakeFirst();

		if (!collectionRow) {
			return apiError("NOT_FOUND", `Collection '${collection}' not found`, 404);
		}

		if (!collectionRow.comments_enabled) {
			return apiError("COMMENTS_DISABLED", "Comments are not enabled for this collection", 403);
		}

		validateIdentifier(collection, "collection");
		const contentRow = await emdash.db
			.selectFrom(`ec_${collection}` as never)
			.select(["id" as never, "slug" as never, "author_id" as never, "published_at" as never])
			.where("id" as never, "=", contentId as never)
			.where("status" as never, "=", "published" as never)
			.where("deleted_at" as never, "is", null as never)
			.executeTakeFirst();

		if (!contentRow) {
			return apiError("NOT_FOUND", "Content not found", 404);
		}

		if (collectionRow.comments_closed_after_days > 0) {
			const publishedAt = (contentRow as { published_at: string | null }).published_at;
			if (publishedAt) {
				const closedDate = new Date(publishedAt);
				closedDate.setDate(closedDate.getDate() + collectionRow.comments_closed_after_days);
				if (new Date() > closedDate) {
					return apiError("COMMENTS_CLOSED", "Comments are closed for this content", 403);
				}
			}
		}

		if (body.website_url) {
			return apiSuccess({ status: "pending", message: "Comment submitted for review" });
		}

		const meta = extractRequestMeta(request, emdash.config);
		const { ipSalt } = await resolveSecretsCached(emdash.db);
		let ipHash: string;
		if (meta.ip) {
			ipHash = await hashIp(meta.ip, ipSalt);
		} else {
			ipHash = "unknown";
		}
		const unknownBucketLimit = ipHash === "unknown" ? 20 : undefined;
		const rateLimited = await checkRateLimit(emdash.db, ipHash, unknownBucketLimit);
		if (rateLimited) {
			return apiError("RATE_LIMITED", "Too many comments. Please try again later.", 429);
		}

		const turnstileSecretKey = getTurnstileSecretKey();
		if (turnstileSecretKey) {
			const verified = await verifyTurnstileToken(body.turnstileToken, turnstileSecretKey, meta.ip);
			if (!verified) {
				return apiError("TURNSTILE_FAILED", "CAPTCHA verification failed", 403);
			}
		}

		const collectionSettings: CollectionCommentSettings = {
			commentsEnabled: collectionRow.comments_enabled === 1,
			commentsModeration:
				collectionRow.comments_moderation as CollectionCommentSettings["commentsModeration"],
			commentsClosedAfterDays: collectionRow.comments_closed_after_days,
			commentsAutoApproveUsers: collectionRow.comments_auto_approve_users === 1,
		};

		let authorName = body.authorName;
		let authorEmail = body.authorEmail;
		let authorUserId: string | null = null;

		if (user) {
			authorName = user.name || authorName;
			authorEmail = user.email;
			authorUserId = user.id;
		}

		let resolvedParentId = body.parentId ?? null;
		if (body.parentId) {
			const repo = new CommentRepository(emdash.db);
			const parent = await repo.findById(body.parentId);
			if (!parent) {
				return apiError("VALIDATION_ERROR", "Parent comment not found", 400);
			}
			if (parent.collection !== collection || parent.contentId !== contentId) {
				return apiError("VALIDATION_ERROR", "Parent comment belongs to different content", 400);
			}
			resolvedParentId = parent.parentId ?? parent.id;
		}

		const hookRunner: CommentHookRunner = {
			async runBeforeCreate(event) {
				return emdash.hooks.runCommentBeforeCreate(event);
			},
			async runModerate(event) {
				const result = await emdash.hooks.invokeExclusiveHook("comment:moderate", event);
				if (!result) return { status: "pending" as const, reason: "No moderator configured" };
				if (result.error) {
					console.error(`[comments] Moderation error (${result.pluginId}):`, result.error.message);
					return { status: "pending" as const, reason: "Moderation error" };
				}
				return result.result as ModerationDecision;
			},
			fireAfterCreate(event) {
				emdash.hooks
					.runCommentAfterCreate(event)
					.catch((err) =>
						console.error(
							"[comments] afterCreate error:",
							err instanceof Error ? err.message : err,
						),
					);
			},
			fireAfterModerate(event) {
				emdash.hooks
					.runCommentAfterModerate(event)
					.catch((err) =>
						console.error(
							"[comments] afterModerate error:",
							err instanceof Error ? err.message : err,
						),
					);
			},
		};

		const typedContent = contentRow as {
			id: string;
			slug: string;
			author_id: string | null;
		};
		let contentAuthor: { id: string; name: string | null; email: string } | undefined;
		if (typedContent.author_id) {
			const authorRow = await emdash.db
				.selectFrom("users")
				.select(["id", "name", "email", "email_verified"])
				.where("id", "=", typedContent.author_id)
				.executeTakeFirst();
			if (authorRow && authorRow.email_verified) {
				contentAuthor = {
					id: authorRow.id,
					name: authorRow.name,
					email: authorRow.email,
				};
			}
		}

		const result = await createComment(
			emdash.db,
			{
				collection,
				contentId,
				parentId: resolvedParentId,
				authorName,
				authorEmail,
				authorUserId,
				body: body.body,
				ipHash,
				userAgent: meta.userAgent,
			},
			collectionSettings,
			hookRunner,
			{
				id: typedContent.id,
				collection,
				slug: typedContent.slug,
				author: contentAuthor,
			},
		);

		if (!result) {
			return apiError("COMMENT_REJECTED", "Comment was rejected", 403);
		}

		if (result.comment.status === "approved" && emdash.email && contentAuthor) {
			try {
				const adminBaseUrl = await getSiteBaseUrl(emdash.db, request, emdash.config);
				await sendCommentNotification({
					email: emdash.email,
					comment: result.comment,
					contentAuthor,
					adminBaseUrl,
				});
			} catch (err) {
				console.error("[comments] notification error:", err instanceof Error ? err.message : err);
			}
		}

		return apiSuccess(
			{
				id: result.comment.id,
				status: result.comment.status,
				message:
					result.comment.status === "approved"
						? "Comment published"
						: "Comment submitted for review",
			},
			201,
		);
	} catch (error) {
		return handleError(error, "Failed to submit comment", "COMMENT_CREATE_ERROR");
	}
};
