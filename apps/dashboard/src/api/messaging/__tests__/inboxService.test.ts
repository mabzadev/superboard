import { describe, expect, it } from "vitest";
import { inboxDeepLink } from "../inboxDeepLink";

describe("Inbox deep links", () => {
  it("selects a supported source, status, and source identifier", () => {
    expect(inboxDeepLink("?type=conversation&status=pending&id=conversation%2F1")).toEqual({
      sourceId: "conversation/1",
      type: "conversation",
      status: "pending",
    });
  });

  it("ignores unsupported filters", () => {
    expect(inboxDeepLink("?type=billing&status=deleted&id=item-1")).toEqual({
      sourceId: "item-1",
      type: "all",
      status: "",
    });
  });
});
