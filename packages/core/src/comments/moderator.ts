import type { CommentModerateEvent, ModerationDecision, PluginContext } from "../plugins/types.js";

export const DEFAULT_COMMENT_MODERATOR_PLUGIN_ID = "emdash-default-comment-moderator";

export async function defaultCommentModerate(
	event: CommentModerateEvent,
	_ctx: PluginContext,
): Promise<ModerationDecision> {
	const { comment, collectionSettings, priorApprovedCount } = event;

	if (collectionSettings.commentsAutoApproveUsers && comment.authorUserId) {
		return { status: "approved", reason: "Authenticated CMS user" };
	}

	if (collectionSettings.commentsModeration === "none") {
		return { status: "approved", reason: "Moderation disabled" };
	}

	if (collectionSettings.commentsModeration === "first_time" && priorApprovedCount > 0) {
		return { status: "approved", reason: "Returning commenter" };
	}

	return { status: "pending", reason: "Held for review" };
}
