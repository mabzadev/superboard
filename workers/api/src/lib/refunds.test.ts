import { describe, expect, it, vi } from "vitest";
import type { Env } from "../types";
import { createFakeD1 } from "../test/fake-d1";
import type { VerifiedPurchase } from "./billing";
import {
  recordRefundCaseForPurchase,
  refundProjectionVersion,
} from "./refunds";

function purchase(overrides: Partial<VerifiedPurchase> = {}): VerifiedPurchase {
  return {
    projectId: "project-1",
    customerId: "customer-1",
    store: "apple",
    environment: "production",
    storeProductId: "vocostar_weekly_999",
    productType: "subscription",
    storeTransactionId: "transaction-provider-1",
    originalTransactionId: "original-1",
    eventType: "REFUND",
    status: "refunded",
    rawPayload: { notificationUUID: "notification-1" },
    ...overrides,
  };
}

describe("Refund Center projection", () => {
  it("orders projections by provider time and terminal-event priority", () => {
    const eventOccurredAt = "2026-08-04T00:00:00.000Z";
    const evidenceRequest = refundProjectionVersion(
      purchase({
        eventType: "CONSUMPTION_REQUEST",
        status: "active",
        eventOccurredAt,
      }),
    );
    const refund = refundProjectionVersion(
      purchase({
        eventType: "REFUND",
        status: "refunded",
        eventOccurredAt,
      }),
    );
    const reversal = refundProjectionVersion(
      purchase({
        eventType: "REFUND_REVERSED",
        status: "active",
        eventOccurredAt,
      }),
    );

    expect(refund > evidenceRequest).toBe(true);
    expect(reversal > refund).toBe(true);
    expect(
      refundProjectionVersion(
        purchase({
          eventType: "CONSUMPTION_REQUEST",
          status: "active",
          eventOccurredAt: "2026-08-04T00:00:01.000Z",
        }),
      ) > reversal,
    ).toBe(true);
  });

  it("creates a lost refund case and immutable provider audit event", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === "run") {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (
        call.sql.startsWith(
          "SELECT id, status, projection_version FROM billing_refund_cases",
        )
      )
        return { id: "refund-case-1" };
      return undefined;
    });
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase(),
      "transaction-1",
    );

    expect(result).toEqual({ caseId: "refund-case-1", status: "lost" });
    const insert = writes.find((write) =>
      write.sql.startsWith("INSERT INTO billing_refund_cases"),
    );
    expect(insert?.args[6]).toBe("original-1");
    expect(
      writes.some((write) =>
        write.sql.startsWith(
          "INSERT OR IGNORE INTO billing_refund_audit_events",
        ),
      ),
    ).toBe(true);
  });

  it("ignores normal renewal events", async () => {
    const db = createFakeD1(() => undefined);
    await expect(
      recordRefundCaseForPurchase(
        { DB: db } as unknown as Env,
        purchase({ eventType: "DID_RENEW", status: "active" }),
        "transaction-1",
      ),
    ).resolves.toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it("prepares Apple consumption information for human approval", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const db = createFakeD1((call) => {
      if (call.op === "run") {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (
        call.sql.startsWith(
          "SELECT id, status, projection_version FROM billing_refund_cases",
        )
      )
        return { id: "refund-case-2" };
      return undefined;
    });
    const eventOccurredAt = "2026-08-04T08:00:00.000Z";
    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({
        eventType: "CONSUMPTION_REQUEST",
        status: "active",
        eventOccurredAt,
      }),
      "transaction-2",
    );
    expect(result?.status).toBe("evidence_required");
    expect(
      writes.some(({ sql }) =>
        sql.startsWith("INSERT OR IGNORE INTO billing_refund_provider_actions"),
      ),
    ).toBe(true);
    const deadline = writes.find(({ sql }) =>
      sql.startsWith("INSERT INTO billing_refund_cases"),
    )?.args[12];
    expect(deadline).toBe("2026-08-04T20:00:00.000Z");
  });

  it("does not extend an Apple consumption deadline when the provider event is replayed later", async () => {
    vi.useFakeTimers();
    try {
      const deadlines: unknown[] = [];
      const db = createFakeD1((call) => {
        if (call.op === "run") {
          if (call.sql.startsWith("INSERT INTO billing_refund_cases")) {
            deadlines.push(call.args[12]);
          }
          return true;
        }
        if (
          call.sql.startsWith(
            "SELECT id, status, projection_version FROM billing_refund_cases",
          )
        ) {
          return { id: "refund-case-replay" };
        }
        return undefined;
      });
      const providerEvent = purchase({
        eventType: "CONSUMPTION_REQUEST",
        status: "active",
        eventOccurredAt: "2026-08-04T08:00:00.000Z",
      });

      vi.setSystemTime(new Date("2026-08-04T08:01:00.000Z"));
      await recordRefundCaseForPurchase(
        { DB: db } as unknown as Env,
        providerEvent,
        "transaction-replay",
      );
      vi.setSystemTime(new Date("2026-08-04T14:00:00.000Z"));
      await recordRefundCaseForPurchase(
        { DB: db } as unknown as Env,
        providerEvent,
        "transaction-replay",
      );

      expect(deadlines).toEqual([
        "2026-08-04T20:00:00.000Z",
        "2026-08-04T20:00:00.000Z",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a Google chargeback review with a 24-hour deadline and a human-approved draft", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const eventOccurredAt = "2026-08-04T08:00:00.000Z";
    const db = createFakeD1((call) => {
      if (call.op === "run") {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (
        call.sql.includes("FROM billing_transactions t") &&
        call.sql.includes("t.store = 'google'")
      )
        return null;
      if (
        call.sql.startsWith(
          "SELECT id, status, projection_version FROM billing_refund_cases",
        )
      ) {
        return { id: "refund-case-google-review", status: "evidence_required" };
      }
      return undefined;
    });
    const { recordGooglePendingRefundReview } = await import("./refunds");
    const result = await recordGooglePendingRefundReview(
      { DB: db } as unknown as Env,
      {
        projectId: "project-1",
        environment: "production",
        eventOccurredAt,
        payload: {
          packageName: "com.example.app",
          pendingRefundReviewNotification: {
            pendingRefundToken: "pending-refund-token",
            orderId: "GPA.1234-5678",
            refundReason: 7,
          },
        },
      },
    );

    expect(result).toEqual({
      caseId: "refund-case-google-review",
      status: "evidence_required",
    });
    const caseInsert = writes.find(({ sql }) =>
      sql.startsWith("INSERT INTO billing_refund_cases"),
    );
    expect(caseInsert?.args[6]).toBe("pending-refund-token");
    expect(caseInsert?.args[12]).toBe("2026-08-05T08:00:00.000Z");
    const action = writes.find(({ sql }) =>
      sql.startsWith("INSERT OR IGNORE INTO billing_refund_provider_actions"),
    );
    expect(action?.sql).toContain("'review_google_refund'");
    expect(action?.sql).toContain("'draft'");
    expect(JSON.parse(String(action?.args[2]))).toMatchObject({
      pendingRefundToken: "pending-refund-token",
      refundPreference: "NEUTRAL",
    });
  });

  it("does not reopen a terminal case from an older provider event", async () => {
    const writes: Array<{ sql: string; args: unknown[] }> = [];
    const terminalPurchase = purchase({
      eventType: "REFUND",
      status: "refunded",
      eventOccurredAt: "2026-08-04T00:00:02.000Z",
    });
    const db = createFakeD1((call) => {
      if (call.op === "run") {
        writes.push({ sql: call.sql, args: call.args });
        return true;
      }
      if (
        call.sql.startsWith(
          "SELECT id, status, projection_version FROM billing_refund_cases",
        )
      ) {
        return {
          id: "refund-case-terminal",
          status: "lost",
          projection_version: refundProjectionVersion(terminalPurchase),
        };
      }
      return undefined;
    });

    const result = await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      purchase({
        eventType: "CONSUMPTION_REQUEST",
        status: "active",
        eventOccurredAt: "2026-08-04T00:00:01.000Z",
      }),
      "transaction-stale",
    );

    expect(result).toEqual({ caseId: "refund-case-terminal", status: "lost" });
    expect(
      writes.some(({ sql }) =>
        sql.startsWith("INSERT INTO billing_refund_deadlines"),
      ),
    ).toBe(false);
    expect(
      writes.some(({ sql }) =>
        sql.startsWith("INSERT OR IGNORE INTO billing_refund_provider_actions"),
      ),
    ).toBe(false);
    expect(
      writes.some(({ sql }) =>
        sql.startsWith("INSERT OR IGNORE INTO billing_refund_audit_events"),
      ),
    ).toBe(true);
  });

  it("closes open deadlines and unsent actions after a terminal provider outcome", async () => {
    const writes: string[] = [];
    const terminalPurchase = purchase({
      eventType: "REFUND_REVERSED",
      status: "active",
      eventOccurredAt: "2026-08-04T00:00:02.000Z",
    });
    const db = createFakeD1((call) => {
      if (call.op === "run") {
        writes.push(call.sql);
        return true;
      }
      if (
        call.sql.startsWith(
          "SELECT id, status, projection_version FROM billing_refund_cases",
        )
      ) {
        return {
          id: "refund-case-won",
          status: "won",
          projection_version: refundProjectionVersion(terminalPurchase),
        };
      }
      return undefined;
    }) as D1Database & {
      batch: (statements: D1PreparedStatement[]) => Promise<unknown>;
    };
    db.batch = async (statements) =>
      Promise.all(statements.map((statement) => statement.run()));

    await recordRefundCaseForPurchase(
      { DB: db } as unknown as Env,
      terminalPurchase,
      "transaction-terminal",
    );

    expect(
      writes.some((sql) => sql.startsWith("UPDATE billing_refund_deadlines")),
    ).toBe(true);
    expect(
      writes.some((sql) =>
        sql.startsWith("UPDATE billing_refund_provider_actions"),
      ),
    ).toBe(true);
  });
});
