import { describe, expect, it } from "vitest";
import { isBillingQueueJob } from "./billing-dispatch";

describe("billing queue routing", () => {
  it("recognizes financial jobs and excludes unrelated queues", () => {
    expect(
      isBillingQueueJob({
        type: "billing.google.voided.reconcile",
        projectId: "11",
      }),
    ).toBe(true);
    expect(
      isBillingQueueJob({
        type: "billing.refund.action.execute",
        actionId: "action",
      }),
    ).toBe(true);
    expect(
      isBillingQueueJob({
        type: "billing.legacy.inventory.page",
        runId: "run-1",
      }),
    ).toBe(true);
    expect(isBillingQueueJob({ type: "billing.reconcile" })).toBe(true);
    expect(
      isBillingQueueJob({
        type: "billing.apple.notification",
        eventId: "event",
        projectId: "11",
      }),
    ).toBe(false);
    expect(
      isBillingQueueJob({
        type: "billing.google.notification",
        environment: "invalid",
      }),
    ).toBe(false);
    expect(
      isBillingQueueJob({ type: "billing.legacy.inventory.page", runId: "" }),
    ).toBe(false);
    expect(isBillingQueueJob({ type: "billing.unknown" })).toBe(false);
    expect(isBillingQueueJob({ type: "messaging.message.send" })).toBe(false);
    expect(isBillingQueueJob(null)).toBe(false);
  });
});
