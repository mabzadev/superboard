import type { UnifiedInboxItem } from "./inboxService";

export type InboxDeepLink = {
  sourceId: string;
  type: "all" | UnifiedInboxItem["source_type"];
  status: "" | UnifiedInboxItem["status"];
};

export function inboxDeepLink(search: string): InboxDeepLink {
  const params = new URLSearchParams(search);
  const requestedType = params.get("type") || "all";
  const requestedStatus = params.get("status") || "";
  return {
    sourceId: (params.get("id") || "").slice(0, 255),
    type: ["conversation", "store_review", "refund_case"].includes(requestedType)
      ? requestedType as UnifiedInboxItem["source_type"]
      : "all",
    status: ["open", "pending", "closed"].includes(requestedStatus)
      ? requestedStatus as UnifiedInboxItem["status"]
      : "",
  };
}
