import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPERBOARD_SUPPORT_REALTIME_PATH,
  SUPERBOARD_SUPPORT_WIDGET_PATH,
  SuperBoardSupportClient,
  SuperBoardSupportException,
  SuperBoardSupportRealtime,
  SuperBoardSupportWidget,
} from "../src/support/index.js";

function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers });
}

test("the widget URL is canonical and its version prefix is applied once", async () => {
  const requests = [];
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com/api/v1/support-widget/",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [],
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return json({ data: [] });
    },
  });

  await client.conversations({ cursor: "next", limit: 1_000 });

  const request = requests[0];
  const target = new URL(request.url);
  assert.equal(client.baseUrl, "https://api.example.com/api/v1/support-widget");
  assert.equal(target.pathname, "/api/v1/support-widget/conversations");
  assert.equal(target.searchParams.get("cursor"), "next");
  assert.equal(target.searchParams.get("limit"), "100");
  assert.equal(request.init.headers.get("Authorization"), "Bearer identity-token");
  assert.equal(request.init.headers.get("X-SuperBoard-Project-Id"), "42");
  assert.equal(SUPERBOARD_SUPPORT_WIDGET_PATH, "/api/v1/support-widget");
  assert.equal(SUPERBOARD_SUPPORT_REALTIME_PATH, "/api/v1/support/realtime");
});

test("an origin receives the widget prefix and unrelated URL paths are rejected", () => {
  const options = {
    projectId: "project-ref",
    identityToken: "identity-token",
    fetch: async () => json({ data: {} }),
  };
  assert.equal(
    new SuperBoardSupportClient({ ...options, baseUrl: "https://api.example.com" }).baseUrl,
    "https://api.example.com/api/v1/support-widget",
  );
  assert.throws(
    () => new SuperBoardSupportClient({ ...options, baseUrl: "https://api.example.com/v1" }),
    /baseUrl path/u,
  );
});

test("canonical nested errors preserve code, retryability, request ID, and details", async () => {
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [],
    fetch: async () =>
      json(
        {
          error: {
            code: "configuration_required",
            message: "Support configuration is required",
            retryable: false,
            request_id: "request-1",
            details: { provider: "email" },
          },
        },
        422,
      ),
  });

  await assert.rejects(
    client.configuration(),
    (error) => {
      assert.ok(error instanceof SuperBoardSupportException);
      assert.equal(error.code, "configuration_required");
      assert.equal(error.message, "Support configuration is required");
      assert.equal(error.retryable, false);
      assert.equal(error.statusCode, 422);
      assert.equal(error.requestId, "request-1");
      assert.deepEqual(error.details, { provider: "email" });
      return true;
    },
  );
});

test("a malformed transient response is retried and a flat error is read safely", async () => {
  let attempts = 0;
  const retrying = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [0],
    fetch: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("temporarily invalid", { status: 503 })
        : json({ data: { ready: true } });
    },
  });
  assert.deepEqual(await retrying.configuration(), { ready: true });
  assert.equal(attempts, 2);

  const failing = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [],
    fetch: async () =>
      json({ code: "request_rejected", message: "Request rejected", retryable: false }, 422),
  });
  await assert.rejects(
    failing.configuration(),
    (error) => error instanceof SuperBoardSupportException && error.code === "request_rejected",
  );
});

test("token refresh and transient retries reuse one mutation idempotency key", async () => {
  const requests = [];
  let refreshes = 0;
  const responses = [
    json({ error: { code: "identity_expired", message: "Expired", retryable: false } }, 401),
    json({ error: { code: "temporarily_unavailable", message: "Retry", retryable: true } }, 503),
    json({ data: { id: "conversation-1", status: "open" } }, 201),
  ];
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "old-token",
    identityTokenProvider: async () => {
      refreshes += 1;
      return "fresh-token";
    },
    retryDelaysMs: [0, 0],
    fetch: async (_url, init) => {
      requests.push({
        authorization: init.headers.get("Authorization"),
        idempotencyKey: init.headers.get("Idempotency-Key"),
      });
      return responses.shift();
    },
  });

  const conversation = await client.createConversation({
    clientConversationId: "client-conversation-1",
  });

  assert.equal(conversation.id, "conversation-1");
  assert.equal(refreshes, 1);
  assert.deepEqual(requests.map((request) => request.authorization), [
    "Bearer old-token",
    "Bearer fresh-token",
    "Bearer fresh-token",
  ]);
  assert.deepEqual(
    new Set(requests.map((request) => request.idempotencyKey)),
    new Set(["client-conversation-1"]),
  );
});

test("widget signatures are requested without exposing a signing secret", async () => {
  const signed = [];
  let captured;
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: "project-ref",
    widgetKey: "widget-public-key",
    visitorId: "visitor-test",
    widgetSignatureProvider: async (request) => {
      signed.push(request);
      return { signature: "server-issued-signature", timestamp: request.timestamp };
    },
    retryDelaysMs: [],
    fetch: async (_url, init) => {
      captured = init.headers;
      return json({ data: { id: "event-1" } }, 201);
    },
  });

  await client.trackEvent({ name: "page.viewed", idempotencyKey: "event-1" });

  assert.equal(signed.length, 1);
  assert.equal(signed[0].method, "POST");
  assert.equal(signed[0].path, "/api/v1/support-widget/events");
  assert.match(signed[0].bodySha256, /^[a-f0-9]{64}$/u);
  assert.equal(signed[0].visitorId, "visitor-test");
  assert.equal(signed[0].idempotencyKey, "event-1");
  assert.equal(
    signed[0].canonicalInput,
    [
      signed[0].timestamp,
      "POST",
      "/api/v1/support-widget/events",
      "project-ref",
      "visitor-test",
      "event-1",
      signed[0].bodySha256,
    ].join("\n"),
  );
  assert.equal(captured.get("X-SuperBoard-Widget-Key"), "widget-public-key");
  assert.equal(captured.get("X-SuperBoard-Widget-Visitor"), "visitor-test");
  assert.equal(captured.get("X-SuperBoard-Widget-Signature"), "server-issued-signature");
  assert.equal(captured.get("X-SuperBoard-Widget-Timestamp"), signed[0].timestamp);
});

test("the browser hostname is checked against configured widget domains", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { origin: "https://app.example.com", hostname: "app.example.com" },
  });
  try {
    assert.doesNotThrow(
      () => new SuperBoardSupportClient({
        baseUrl: "https://api.example.com",
        projectId: 42,
        widgetKey: "widget-public-key",
        widgetSignatureProvider: async () => "signature",
        allowedDomains: ["app.example.com"],
        fetch: async () => json({ data: {} }),
      }),
    );
    assert.throws(
      () => new SuperBoardSupportClient({
        baseUrl: "https://api.example.com",
        projectId: 42,
        widgetKey: "widget-public-key",
        widgetSignatureProvider: async () => "signature",
        allowedDomains: ["other.example.com"],
        fetch: async () => json({ data: {} }),
      }),
      (error) => error instanceof SuperBoardSupportException && error.code === "domain_not_allowed",
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "location", descriptor);
    else delete globalThis.location;
  }
});

test("an opaque visitor ID is persisted per widget and can be supplied explicitly", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key) {
          return values.get(key) || null;
        },
        setItem(key, value) {
          values.set(key, value);
        },
        removeItem(key) {
          values.delete(key);
        },
      },
    },
  });
  const options = {
    baseUrl: "https://api.example.com",
    projectId: "project-ref",
    widgetKey: "widget-public-key",
    widgetSignatureProvider: async () => "signature",
    fetch: async () => json({ data: {} }),
  };
  try {
    const first = new SuperBoardSupportClient(options);
    const second = new SuperBoardSupportClient(options);
    const explicit = new SuperBoardSupportClient({ ...options, visitorId: "visitor-explicit" });
    assert.match(first.visitorId, /^visitor-[a-f0-9-]+$/u);
    assert.equal(second.visitorId, first.visitorId);
    assert.equal(explicit.visitorId, "visitor-explicit");
    assert.equal(values.size, 1);
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
  }
});

test("messages, uploads, proactive support, CSAT, Help Center, and meetings use native routes", async () => {
  const paths = [];
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [],
    fetch: async (url) => {
      const path = `${new URL(url).pathname}${new URL(url).search}`;
      paths.push(path);
      if (path.includes("/messages?") || path.includes("/proactive-support") || path.includes("/search")) {
        return json({ data: [] });
      }
      if (path.endsWith("/attachments")) {
        return json({ key: "attachment-key", filename: "evidence.png" }, 201);
      }
      return json({ data: { id: "resource-1", ticket: "ticket-1" } }, 201);
    },
  });

  await client.messages("conversation-1");
  await client.sendMessage("conversation-1", {
    body: "Hello",
    clientMessageId: "message-1",
  });
  await client.uploadAttachment("conversation-1", {
    data: new Uint8Array([1, 2, 3]),
    filename: "evidence.png",
    contentType: "image/png",
    idempotencyKey: "upload-1",
  });
  await client.proactiveSupport();
  await client.submitCsat("conversation-1", { rating: 5, idempotencyKey: "csat-1" });
  await client.searchHelpCenter({ portalSlug: "docs", query: "setup" });
  await client.joinMeeting("conversation-1", { idempotencyKey: "meeting-1" });

  assert.deepEqual(paths, [
    "/api/v1/support-widget/conversations/conversation-1/messages?limit=50",
    "/api/v1/support-widget/conversations/conversation-1/messages",
    "/api/v1/support-widget/conversations/conversation-1/attachments",
    "/api/v1/support-widget/proactive-support?limit=50",
    "/api/v1/support-widget/conversations/conversation-1/csat",
    "/api/v1/support-widget/help-center/docs/search?q=setup&limit=20",
    "/api/v1/support-widget/conversations/conversation-1/meetings",
  ]);
});

test("realtime obtains a new one-use ticket when reconnecting", async () => {
  const sockets = [];
  const ticketPaths = [];
  let ticket = 0;
  const client = new SuperBoardSupportClient({
    baseUrl: "https://api.example.com",
    projectId: 42,
    identityToken: "identity-token",
    retryDelaysMs: [],
    fetch: async (url) => {
      ticketPaths.push(new URL(url).pathname);
      ticket += 1;
      return json({ data: { ticket: `ticket-${ticket}` } }, 201);
    },
    webSocketFactory: (url) => {
      const socket = new MockSocket(url);
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    },
  });
  const realtime = new SuperBoardSupportRealtime(client, { retryDelaysMs: [0] });
  const events = [];
  realtime.subscribe((event) => events.push(event));

  await realtime.connect("conversation-1");
  sockets[0].message(JSON.stringify({
    schema_version: 1,
    type: "connected",
    event_id: "server-connected",
    conversation_id: "conversation-1",
    occurred_at: "2026-08-13T12:00:00.000Z",
  }));
  sockets[0].message(JSON.stringify({
    type: "message.created",
    message: { id: "message-1" },
  }));
  sockets[0].serverClose();
  await eventually(() => sockets.length === 2);

  assert.deepEqual(ticketPaths, [
    "/api/v1/support-widget/conversations/conversation-1/realtime-ticket",
    "/api/v1/support-widget/conversations/conversation-1/realtime-ticket",
  ]);
  assert.equal(new URL(sockets[0].url).pathname, "/api/v1/support/realtime/ticket-1");
  assert.equal(new URL(sockets[1].url).pathname, "/api/v1/support/realtime/ticket-2");
  assert.equal(events.some((event) => event.type === "message.created"), true);
  assert.equal(events.filter((event) => event.type === "connected").length, 2);
  assert.equal(events.some((event) => event.type === "error" && event.error.retryable), true);
  await realtime.dispose();
});

test("the isolated widget fails safely outside a browser document", () => {
  const documentValue = globalThis.document;
  delete globalThis.document;
  try {
    const widget = new SuperBoardSupportWidget({
      client: { conversations() {} },
    });
    assert.throws(
      () => widget.mount({}),
      (error) => error instanceof SuperBoardSupportException && error.code === "widget_dom_unavailable",
    );
  } finally {
    if (documentValue !== undefined) globalThis.document = documentValue;
  }
});

class MockSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
  }

  open() {
    this.readyState = 1;
    this.onopen?.({ type: "open" });
  }

  message(data) {
    this.onmessage?.({ data });
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

async function eventually(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail("condition was not reached");
}
