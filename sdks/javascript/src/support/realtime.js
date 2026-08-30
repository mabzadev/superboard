import { SuperBoardSupportException, isRecord } from "./error.js";

const ALLOWED_EVENT_TYPES = new Set([
  "connected",
  "message.created",
  "message.updated",
  "message.deleted",
  "conversation.updated",
  "typing.started",
  "typing.stopped",
  "conversation.read",
  "delivery.updated",
  "presence.updated",
  "assignment.updated",
  "error",
]);

/**
 * Reconnecting browser realtime connection backed by one-use Support tickets.
 */
export class SuperBoardSupportRealtime {
  constructor(client, { retryDelaysMs = [1_000, 2_000, 5_000, 10_000, 30_000] } = {}) {
    if (!client || typeof client._openRealtimeSocket !== "function") {
      throw new TypeError("A SuperBoardSupportClient is required");
    }
    if (!Array.isArray(retryDelaysMs) || retryDelaysMs.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new TypeError("retryDelaysMs must contain non-negative numbers");
    }
    this.client = client;
    this.retryDelaysMs = Object.freeze([...retryDelaysMs]);
    this.listeners = new Set();
    this.socket = null;
    this.timer = null;
    this.conversationId = null;
    this.requested = false;
    this.disposed = false;
    this.generation = 0;
    this.attempt = 0;
    this.localSequence = 0;
  }

  get connected() {
    return this.socket !== null && this.socket.readyState === 1;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    if (this.disposed) {
      throw new SuperBoardSupportException(
        "realtime_disposed",
        "Support realtime has been disposed",
      );
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(conversationId) {
    const normalized = String(conversationId || "").trim();
    if (!normalized || normalized.length > 255) {
      throw new SuperBoardSupportException(
        "conversation_id_invalid",
        "A valid conversation ID is required",
      );
    }
    if (this.disposed) {
      throw new SuperBoardSupportException(
        "realtime_disposed",
        "Support realtime has been disposed",
      );
    }
    await this.disconnect();
    this.requested = true;
    this.conversationId = normalized;
    this.attempt = 0;
    const generation = ++this.generation;
    await this.#open(generation, true);
  }

  async disconnect() {
    this.requested = false;
    this.conversationId = null;
    this.attempt = 0;
    this.generation += 1;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      removeSocketHandlers(socket);
      if (socket.readyState === 0 || socket.readyState === 1) socket.close(1000, "Client closed");
    }
  }

  async dispose() {
    if (this.disposed) return;
    await this.disconnect();
    this.disposed = true;
    this.listeners.clear();
  }

  async #open(generation, surfaceFailure) {
    const conversationId = this.conversationId;
    if (!this.#active(generation, conversationId)) return;
    try {
      const socket = await this.client._openRealtimeSocket(conversationId);
      if (!this.#active(generation, conversationId)) {
        socket.close(1000, "Connection superseded");
        return;
      }
      this.socket = socket;
      await waitForSocketOpen(socket);
      if (!this.#active(generation, conversationId) || this.socket !== socket) {
        socket.close(1000, "Connection superseded");
        return;
      }
      this.attempt = 0;
      this.#emit(this.#event("connected", conversationId));
      socket.onmessage = (event) => this.#serverEvent(event?.data, conversationId);
      socket.onerror = () => {
        // The close handler owns reconnecting and reports one stable event.
      };
      socket.onclose = () => this.#ended(socket, generation, conversationId);
    } catch (error) {
      if (!this.#active(generation, conversationId)) return;
      this.#schedule(generation, conversationId);
      if (surfaceFailure) {
        throw new SuperBoardSupportException(
          "realtime_connection_failed",
          "Unable to connect to Support realtime",
          { retryable: true, cause: error },
        );
      }
    }
  }

  #ended(socket, generation, conversationId) {
    if (this.socket !== socket) return;
    removeSocketHandlers(socket);
    this.socket = null;
    this.#schedule(generation, conversationId);
  }

  #schedule(generation, conversationId) {
    if (!this.#active(generation, conversationId) || this.timer !== null) return;
    const index = Math.min(this.attempt, Math.max(0, this.retryDelaysMs.length - 1));
    const wait = this.retryDelaysMs.length === 0 ? 0 : this.retryDelaysMs[index];
    this.attempt += 1;
    this.#emit(
      this.#event("error", conversationId, {
        error: {
          code: "realtime_connection_lost",
          message: "Support realtime connection was interrupted",
          retryable: true,
          details: { retry_in_ms: wait, attempt: this.attempt },
        },
      }),
    );
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.#open(generation, false);
    }, wait);
  }

  #serverEvent(raw, conversationId) {
    try {
      const value = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!isRecord(value) || !ALLOWED_EVENT_TYPES.has(value.type)) throw new TypeError();
      // Opening the socket already emitted the canonical lifecycle event. The
      // server acknowledgement carries no additional public state, so do not
      // surface a duplicate `connected` event to application listeners.
      if (value.type === "connected") return;
      this.#emit({
        ...value,
        schema_version: 1,
        type: value.type,
        event_id:
          typeof value.event_id === "string" ? value.event_id : this.#localEventId(),
        conversation_id:
          typeof value.conversation_id === "string"
            ? value.conversation_id
            : conversationId,
        occurred_at:
          typeof value.occurred_at === "string"
            ? value.occurred_at
            : new Date().toISOString(),
      });
    } catch {
      this.#emit(
        this.#event("error", conversationId, {
          error: {
            code: "realtime_event_invalid",
            message: "Support realtime returned an invalid event",
            retryable: false,
          },
        }),
      );
    }
  }

  #event(type, conversationId, fields = {}) {
    return {
      schema_version: 1,
      type,
      event_id: this.#localEventId(),
      conversation_id: conversationId,
      occurred_at: new Date().toISOString(),
      ...fields,
    };
  }

  #localEventId() {
    this.localSequence += 1;
    return `sdk-${Date.now()}-${this.localSequence}`;
  }

  #emit(event) {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // One consumer cannot break delivery to the others.
      }
    }
  }

  #active(generation, conversationId) {
    return (
      !this.disposed &&
      this.requested &&
      this.generation === generation &&
      conversationId !== null &&
      this.conversationId === conversationId
    );
  }
}

function waitForSocketOpen(socket) {
  if (socket.readyState === 1) return Promise.resolve();
  if (socket.readyState !== 0) return Promise.reject(new Error("Socket is not open"));
  return new Promise((resolve, reject) => {
    const previousOpen = socket.onopen;
    const previousError = socket.onerror;
    const previousClose = socket.onclose;
    socket.onopen = (event) => {
      socket.onopen = previousOpen || null;
      socket.onerror = previousError || null;
      socket.onclose = previousClose || null;
      previousOpen?.call(socket, event);
      resolve();
    };
    const fail = (event) => {
      socket.onopen = previousOpen || null;
      socket.onerror = previousError || null;
      socket.onclose = previousClose || null;
      reject(event instanceof Error ? event : new Error("Socket failed to open"));
    };
    socket.onerror = fail;
    socket.onclose = fail;
  });
}

function removeSocketHandlers(socket) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
}
