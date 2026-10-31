import type { UnifiedInboxItem } from "./inboxService.js";

// Support deep links intentionally contain only SuperBoard-native parameters.

export type InboxDeepLink = {
	sourceId: string;
	type: "all" | UnifiedInboxItem["source_type"];
	status: "" | UnifiedInboxItem["status"];
	/** `?q=`: a customer email, user id or conversation id that narrows the conversation list. */
	query: string;
};

export function inboxDeepLink(search: string): InboxDeepLink {
	const params = new URLSearchParams(search);
	const requestedType = params.get("type") || "all";
	const requestedStatus = params.get("status") || "";
	return {
		sourceId: (params.get("id") || "").slice(0, 255),
		type: ["conversation", "refund_case"].includes(requestedType)
			? (requestedType as UnifiedInboxItem["source_type"])
			: "all",
		status: ["open", "pending", "closed"].includes(requestedStatus)
			? (requestedStatus as UnifiedInboxItem["status"])
			: "",
		query: (params.get("q") || "").trim().slice(0, 255),
	};
}

/**
 * True when an Inbox item belongs to the searched customer: its customer reference is one of the
 * matching contacts' user ids, or the query appears in its ids, customer reference, subject,
 * preview or one of its plain-text source fields.
 */
export function inboxItemMatchesQuery(
	item: UnifiedInboxItem,
	query: string,
	customerReferences: ReadonlySet<string> = new Set(),
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	if (item.customer_reference && customerReferences.has(item.customer_reference)) return true;
	const fields = [
		item.id,
		item.source_id,
		item.customer_reference,
		item.title,
		item.preview,
		...Object.values(item.source ?? {}),
	];
	return fields.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}
