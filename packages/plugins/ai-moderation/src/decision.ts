import type { CollectionCommentSettings, ModerationDecision } from "emdash";

import type { Category } from "./categories.js";
import type { GuardResult } from "./guard.js";
export function computeDecision(
	guard: GuardResult | undefined,
	guardError: string | undefined,
	categories: Category[],
	settings: { autoApproveClean: boolean },
	collectionSettings: CollectionCommentSettings,
	priorApprovedCount: number,
	isAuthenticatedUser: boolean,
): ModerationDecision {
	if (isAuthenticatedUser) {
		return { status: "approved", reason: "Authenticated CMS user" };
	}

	const categoryActions = new Map(categories.map((c) => [c.id, c.action]));

	let aiRanClean = guard?.safe === true;

	if (guard && !guard.safe) {
		let shouldBlock = false;
		let shouldHold = false;
		const flaggedCategories: string[] = [];

		for (const catId of guard.categories) {
			const action = categoryActions.get(catId);
			if (action === "block") {
				shouldBlock = true;
				flaggedCategories.push(catId);
			} else if (action === "hold" || action === undefined) {
				shouldHold = true;
				flaggedCategories.push(catId);
			}
		}

		if (shouldBlock) {
			return {
				status: "spam",
				reason: `AI flagged: ${flaggedCategories.join(", ")}`,
			};
		}

		if (shouldHold) {
			return {
				status: "pending",
				reason: `AI flagged for review: ${flaggedCategories.join(", ")}`,
			};
		}

		aiRanClean = true;
	}

	if (guardError) {
		return {
			status: "pending",
			reason: `AI error: ${guardError}`,
		};
	}

	if (settings.autoApproveClean && aiRanClean) {
		return { status: "approved", reason: "AI verified clean" };
	}

	if (collectionSettings.commentsModeration === "none") {
		return { status: "approved", reason: "Moderation disabled" };
	}

	if (collectionSettings.commentsModeration === "first_time" && priorApprovedCount > 0) {
		return { status: "approved", reason: "Returning commenter" };
	}

	return { status: "pending", reason: "Held for review" };
}
