import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  GET: vi.fn(),
  PATCH: vi.fn(),
  POST: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

vi.mock("@/lib/config", () => ({
  config: {
    apiUrl: "https://api.example.test",
    apiPath: "/api/v1",
    clientId: "dashboard-test",
  },
}));

import {
  createInboxRealtimeTicket,
  downloadInboxAttachment,
  getInboxMessages,
  getUnifiedInboxItems,
  inboxRealtimeUrl,
  parseInboxRealtimeEvent,
  sendInboxMessage,
  updateInboxConversation,
  uploadInboxAttachment,
} from "../inboxService";
import { inboxDeepLink } from "../inboxDeepLink";

beforeEach(() => vi.clearAllMocks());

describe("Inbox deep links", () => {
  it("selects a supported source, status, and source identifier", () => {
    expect(
      inboxDeepLink("?type=conversation&status=pending&id=conversation%2F1")
    ).toEqual({
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

describe("Inbox realtime", () => {
  it("builds a secure WebSocket URL on the API v2 route", () => {
    expect(
      inboxRealtimeUrl("project-1", "conversation 1", "ticket-value")
    ).toBe("wss://api.example.test/api/v1/support/realtime/ticket-value");
  });

  it("accepts bounded known events", () => {
    expect(
      parseInboxRealtimeEvent(
        JSON.stringify({
          type: "message.created",
          conversation_id: "conversation-1",
          message: {
            id: "message-1",
            conversation_id: "conversation-1",
            sender_kind: "user",
            sender_id: "customer-1",
            sequence: 3,
            created_at: "2026-08-04T12:00:00.000Z",
          },
        })
      )
    ).toMatchObject({
      type: "message.created",
      conversation_id: "conversation-1",
    });
    expect(
      parseInboxRealtimeEvent(
        JSON.stringify({
          type: "typing.changed",
          actor: { kind: "user", id: "customer-1" },
          active: true,
        })
      )
    ).toMatchObject({ type: "typing.changed", active: true });
  });

  it("rejects malformed, unknown, and oversized events", () => {
    expect(parseInboxRealtimeEvent("not-json")).toBeNull();
    expect(
      parseInboxRealtimeEvent(JSON.stringify({ type: "unexpected" }))
    ).toBeNull();
    expect(parseInboxRealtimeEvent("x".repeat(65_537))).toBeNull();
    expect(parseInboxRealtimeEvent(new Uint8Array())).toBeNull();
  });
});

describe("Support inbox dashboard service contracts", () => {
  it("loads the unified inbox and encoded conversation resources", async () => {
    api.GET.mockResolvedValue({ data: { data: [] } });

    await getUnifiedInboxItems("10-test", {
      type: "conversation",
      status: "pending",
    });
    await getInboxMessages("10-test", "conversation/1");

    expect(api.GET).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/10-test/items?type=conversation&status=pending"
    );
    expect(api.GET).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/messages"
    );
  });

  it("connects private notes, assignment updates, and realtime tickets", async () => {
    api.POST.mockResolvedValueOnce({
      data: { data: { id: "message-1" } },
    }).mockResolvedValueOnce({
      data: { data: { ticket: "signed", expires_at: "later" } },
    });
    api.PATCH.mockResolvedValue({ data: { data: { id: "conversation/1" } } });

    await sendInboxMessage(
      "10-test",
      "conversation/1",
      "Internal context",
      "client-message-1",
      true
    );
    await updateInboxConversation("10-test", "conversation/1", {
      assigned_team_id: "team-1",
      priority: "urgent",
      labels: ["vip"],
    });
    await expect(
      createInboxRealtimeTicket("10-test", "conversation/1")
    ).resolves.toEqual({ ticket: "signed", expires_at: "later" });

    expect(api.POST).toHaveBeenNthCalledWith(
      1,
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/messages",
      {
        body: "Internal context",
        client_message_id: "client-message-1",
        private: true,
      }
    );
    expect(api.PATCH).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/conversations/conversation%2F1",
      {
        assigned_team_id: "team-1",
        priority: "urgent",
        labels: ["vip"],
      }
    );
    expect(api.POST).toHaveBeenNthCalledWith(
      2,
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/realtime-ticket",
      {},
      { retry: false }
    );
  });

  it("uploads and downloads attachments through canonical Support routes", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const blob = new Blob(["hello"], { type: "text/plain" });
    api.POST.mockResolvedValue({
      data: {
        key: "attachment-1",
        filename: "hello.txt",
        content_type: "text/plain",
        size: 5,
      },
    });
    api.GET.mockResolvedValue({ data: blob });

    await uploadInboxAttachment("10-test", "conversation/1", file);
    await expect(
      downloadInboxAttachment("10-test", "conversation/1", "message/1")
    ).resolves.toBe(blob);

    expect(api.POST).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/attachments",
      file,
      {
        headers: {
          "Content-Type": "text/plain",
          "X-Filename": "hello.txt",
        },
        retry: false,
      }
    );
    expect(api.GET).toHaveBeenCalledWith(
      "/api/v1/support/projects/10-test/conversations/conversation%2F1/attachments/message%2F1",
      { responseType: "blob" }
    );
  });
});
