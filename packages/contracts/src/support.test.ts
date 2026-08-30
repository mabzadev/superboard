import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SUPPORT_LIMITS,
  SUPPORT_ROUTE_PREFIXES,
  SupportContractError,
  parseSupportApiError,
  parseSupportConversationDto,
  parseSupportCursorPagination,
  parseSupportIdempotencyKey,
  parseSupportMessageDto,
  parseSupportQueueEvent,
  parseSupportRealtimeEvent,
} from "./support";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/support/v1.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

describe("support contracts", () => {
  it("exposes only canonical SuperBoard Support route prefixes", () => {
    expect(SUPPORT_ROUTE_PREFIXES).toEqual({
      client: "/api/v1/support-client",
      widget: "/api/v1/support-widget",
      dashboard: "/api/v1/support/projects",
      providers: "/api/v1/support/providers",
      realtime: "/api/v1/support/realtime",
      helpCenter: "/api/v1/support/help-center",
    });
    expect(JSON.stringify(SUPPORT_ROUTE_PREFIXES).toLowerCase()).not.toMatch(
      /chatwoot|openchat|actioncable|activestorage/u,
    );
  });

  it("parses canonical and legacy error envelopes", () => {
    expect(parseSupportApiError(fixtures.error)).toEqual({
      code: "configuration_required",
      message: "This channel is not configured",
      retryable: false,
      request_id: "request-2",
      details: { provider: "email" },
    });
    expect(
      parseSupportApiError({
        code: "request_failed",
        message: "Try again",
        retryable: true,
      }),
    ).toEqual({
      code: "request_failed",
      message: "Try again",
      retryable: true,
    });
  });

  it("normalizes bounded pagination", () => {
    expect(
      parseSupportCursorPagination({ limit: "25", cursor: "next_1" }),
    ).toEqual({ limit: 25, cursor: "next_1" });
    expect(parseSupportCursorPagination(undefined)).toEqual({ limit: 50 });
    expect(() =>
      parseSupportCursorPagination({
        limit: SUPPORT_LIMITS.pageSizeMaximum + 1,
      }),
    ).toThrowError(SupportContractError);
  });

  it("accepts existing bounded idempotency keys and rejects invalid ones", () => {
    expect(parseSupportIdempotencyKey("message:client-123")).toBe(
      "message:client-123",
    );
    expect(parseSupportIdempotencyKey("short")).toBe("short");
    expect(() => parseSupportIdempotencyKey(" ")).toThrow(/idempotency_key/u);
    expect(() => parseSupportIdempotencyKey("x".repeat(201))).toThrow(
      /idempotency_key/u,
    );
  });

  it("validates versioned realtime and queue fixtures", () => {
    expect(
      parseSupportConversationDto((fixtures.success as { data: unknown }).data),
    ).toMatchObject({
      id: "conversation-1",
      status: "open",
      priority: "normal",
      unread_count: 1,
      custom_attributes: { plan: "plus" },
    });
    expect(
      parseSupportMessageDto(
        (fixtures.realtime as { message: unknown }).message,
      ),
    ).toMatchObject({
      id: "message-1",
      conversation_id: "conversation-1",
      content_type: "text",
    });
    expect(parseSupportRealtimeEvent(fixtures.realtime)).toMatchObject({
      schema_version: 1,
      type: "message.created",
      conversation_id: "conversation-1",
    });
    expect(parseSupportQueueEvent(fixtures.queue)).toMatchObject({
      schema_version: 1,
      type: "support.message.created.v1",
      project_id: 11,
      attempt: 0,
    });
  });

  it("rejects unsupported event names and oversized queue payloads", () => {
    expect(() =>
      parseSupportRealtimeEvent({
        ...(fixtures.realtime as Record<string, unknown>),
        type: "migration.progress",
      }),
    ).toThrow(/event type/u);
    expect(() =>
      parseSupportQueueEvent({
        ...(fixtures.queue as Record<string, unknown>),
        payload: { body: "x".repeat(SUPPORT_LIMITS.queuePayloadBytesMaximum) },
      }),
    ).toThrow(/exceeds/u);
  });
});
