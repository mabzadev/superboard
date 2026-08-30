import { SuperBoardSupportException, isRecord } from "./error.js";
import { SuperBoardSupportRealtime } from "./realtime.js";

export const SUPERBOARD_SUPPORT_WIDGET_PATH = "/api/v1/support-widget";
export const SUPERBOARD_SUPPORT_REALTIME_PATH = "/api/v1/support/realtime";

const MAX_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 512;
const MAX_IDENTIFIER_LENGTH = 255;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const TRANSIENT_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Client for the native SuperBoard Support widget API.
 *
 * The configured URL may be either an HTTP(S) origin or the complete
 * `/api/v1/support-widget` URL. The public Support prefix is applied exactly
 * once.
 */
export class SuperBoardSupportClient {
  constructor({
    baseUrl,
    projectId,
    identityToken = null,
    identityTokenProvider = null,
    widgetKey = null,
    widgetSignatureProvider = null,
    visitorId = null,
    allowedDomains = [],
    fetch: fetchImplementation = globalThis.fetch,
    webSocketFactory = null,
    requestTimeoutMs = 15_000,
    retryDelaysMs = [250, 1_000],
  } = {}) {
    this.baseUrl = normalizeSupportBaseUrl(baseUrl);
    this.projectId = boundedText(projectId, "project_id", MAX_IDENTIFIER_LENGTH);
    this.identityToken = optionalText(identityToken);
    this.identityTokenProvider = validateFunction(
      identityTokenProvider,
      "identityTokenProvider",
    );
    this.widgetKey = optionalBoundedText(widgetKey, "widget_key", MAX_IDENTIFIER_LENGTH);
    this.widgetSignatureProvider = validateFunction(
      widgetSignatureProvider,
      "widgetSignatureProvider",
    );
    this.visitorId = resolveWidgetVisitorId({
      visitorId,
      widgetKey: this.widgetKey,
      projectId: this.projectId,
      baseUrl: this.baseUrl,
    });
    this.allowedDomains = normalizeAllowedDomains(allowedDomains);
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A fetch implementation is required");
    }
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
      throw new RangeError("requestTimeoutMs must be a positive integer");
    }
    if (!Array.isArray(retryDelaysMs) || retryDelaysMs.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new TypeError("retryDelaysMs must contain non-negative numbers");
    }
    if (!this.identityToken && !this.identityTokenProvider && !this.widgetKey) {
      throw new SuperBoardSupportException(
        "identity_required",
        "A Support identity token or widget key is required",
      );
    }
    if (this.widgetSignatureProvider && !this.widgetKey) {
      throw new SuperBoardSupportException(
        "widget_key_required",
        "A widget key is required when a signature provider is configured",
      );
    }
    if (this.widgetKey && !this.widgetSignatureProvider) {
      throw new SuperBoardSupportException(
        "widget_signature_required",
        "A widget signature provider is required when a widget key is used",
      );
    }
    this.fetchImplementation = fetchImplementation;
    this.webSocketFactory = webSocketFactory;
    this.requestTimeoutMs = requestTimeoutMs;
    this.retryDelaysMs = Object.freeze([...retryDelaysMs]);
    this.refreshPromise = null;
    this.closed = false;
    this.assertAllowedDomain();
  }

  setIdentityToken(value) {
    this.identityToken = boundedText(value, "identity_token", 16 * 1024);
  }

  assertAllowedDomain() {
    if (this.allowedDomains.length === 0 || typeof globalThis.location === "undefined") {
      return;
    }
    const hostname = globalThis.location.hostname?.toLowerCase();
    if (!hostname || !this.allowedDomains.includes(hostname)) {
      throw new SuperBoardSupportException(
        "domain_not_allowed",
        "This domain is not allowed to use the Support widget",
        { details: { hostname: hostname || null } },
      );
    }
  }

  configuration() {
    return this.#dataObject("/configuration", { method: "GET" });
  }

  async createConversation({
    clientConversationId,
    subject,
    inboxId,
    customAttributes,
    idempotencyKey = clientConversationId,
  } = {}) {
    return this.#dataObject("/conversations", {
      method: "POST",
      idempotencyKey,
      body: {
        client_conversation_id: boundedText(
          clientConversationId,
          "client_conversation_id",
          128,
        ),
        ...(subject === undefined ? {} : { subject }),
        ...(inboxId === undefined ? {} : { inbox_id: inboxId }),
        ...(customAttributes === undefined
          ? {}
          : { custom_attributes: customAttributes }),
      },
    });
  }

  conversations({ cursor, limit = 50 } = {}) {
    return this.#dataList(
      appendQuery("/conversations", {
        cursor: optionalBoundedText(cursor, "cursor", MAX_CURSOR_LENGTH),
        limit: pageSize(limit),
      }),
      { method: "GET" },
    );
  }

  updateConversation(
    conversationId,
    { status, customAttributes, snoozedUntil, idempotencyKey } = {},
  ) {
    return this.#dataObject(`/conversations/${segment(conversationId)}`, {
      method: "PATCH",
      idempotencyKey,
      body: {
        ...(status === undefined ? {} : { status }),
        ...(customAttributes === undefined
          ? {}
          : { custom_attributes: customAttributes }),
        ...(snoozedUntil === undefined ? {} : { snoozed_until: snoozedUntil }),
      },
    });
  }

  messages(conversationId, { cursor, beforeSequence, limit = 50 } = {}) {
    return this.#dataList(
      appendQuery(`/conversations/${segment(conversationId)}/messages`, {
        cursor: optionalBoundedText(cursor, "cursor", MAX_CURSOR_LENGTH),
        before_sequence:
          beforeSequence === undefined || beforeSequence === null
            ? null
            : positiveInteger(beforeSequence, "before_sequence"),
        limit: pageSize(limit),
      }),
      { method: "GET" },
    );
  }

  sendMessage(
    conversationId,
    {
      body,
      clientMessageId,
      contentType = "text",
      replyToMessageId,
      metadata,
      attachments,
      idempotencyKey = clientMessageId,
    } = {},
  ) {
    const normalizedBody = body === undefined || body === null ? null : String(body);
    if (normalizedBody !== null && utf8Length(normalizedBody) > MAX_MESSAGE_BYTES) {
      throw new SuperBoardSupportException(
        "message_body_too_large",
        "Message body exceeds 64 KB",
      );
    }
    return this.#dataObject(`/conversations/${segment(conversationId)}/messages`, {
      method: "POST",
      idempotencyKey,
      body: {
        client_message_id: boundedText(clientMessageId, "client_message_id", 128),
        content_type: boundedText(contentType, "content_type", 64),
        ...(normalizedBody === null ? {} : { body: normalizedBody }),
        ...(replyToMessageId === undefined
          ? {}
          : { reply_to_message_id: replyToMessageId }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(attachments === undefined ? {} : { attachments }),
      },
    });
  }

  editMessage(
    conversationId,
    messageId,
    { body, metadata, idempotencyKey } = {},
  ) {
    const normalizedBody = body === undefined ? undefined : String(body);
    if (normalizedBody !== undefined && utf8Length(normalizedBody) > MAX_MESSAGE_BYTES) {
      throw new SuperBoardSupportException(
        "message_body_too_large",
        "Message body exceeds 64 KB",
      );
    }
    return this.#dataObject(
      `/conversations/${segment(conversationId)}/messages/${segment(messageId)}`,
      {
        method: "PATCH",
        idempotencyKey,
        body: {
          ...(normalizedBody === undefined ? {} : { body: normalizedBody }),
          ...(metadata === undefined ? {} : { metadata }),
        },
      },
    );
  }

  deleteMessage(conversationId, messageId, { idempotencyKey } = {}) {
    return this.#dataObject(
      `/conversations/${segment(conversationId)}/messages/${segment(messageId)}`,
      { method: "DELETE", idempotencyKey },
    );
  }

  async uploadAttachment(
    conversationId,
    { data, filename, contentType, idempotencyKey } = {},
  ) {
    const { body, byteLength } = attachmentBody(data);
    if (byteLength < 1 || byteLength > MAX_ATTACHMENT_BYTES) {
      throw new SuperBoardSupportException(
        "attachment_invalid",
        "Attachment must contain between 1 byte and 10 MB",
      );
    }
    const payload = await this.#request(
      `/conversations/${segment(conversationId)}/attachments`,
      {
        method: "POST",
        rawBody: body,
        idempotencyKey,
        headers: {
          "Content-Type": boundedText(contentType, "content_type", 255),
          "X-Filename": boundedText(filename, "filename", 255),
        },
      },
    );
    if (isRecord(payload.data)) return payload.data;
    if (typeof payload.key === "string" && typeof payload.filename === "string") {
      return payload;
    }
    throw new SuperBoardSupportException(
      "attachment_response_invalid",
      "Support returned an invalid attachment response",
      { requestId: requestIdFromPayload(payload) },
    );
  }

  async downloadAttachment(conversationId, messageId, { attachmentId } = {}) {
    const response = await this.#request(
      appendQuery(
        `/conversations/${segment(conversationId)}/attachments/${segment(messageId)}`,
        { attachment_id: optionalBoundedText(attachmentId, "attachment_id", 255) },
      ),
      { method: "GET", responseType: "response" },
    );
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new SuperBoardSupportException(
        "attachment_response_too_large",
        "Attachment response exceeds 10 MB",
        { statusCode: response.status, requestId: response.headers.get("x-request-id") },
      );
    }
    return bytes;
  }

  async markRead(conversationId, { idempotencyKey } = {}) {
    const payload = await this.#request(`/conversations/${segment(conversationId)}/read`, {
      method: "POST",
      body: {},
      idempotencyKey,
    });
    const source = isRecord(payload.data) ? payload.data : payload;
    return typeof source.read_at === "string" ? source.read_at : "";
  }

  async setTyping(conversationId, active, { idempotencyKey } = {}) {
    await this.#request(`/conversations/${segment(conversationId)}/typing`, {
      method: "POST",
      body: { active: active === true },
      idempotencyKey,
    });
  }

  contact() {
    return this.#dataObject("/contact", { method: "GET" });
  }

  updateContact({ name, email, phone, customAttributes, idempotencyKey } = {}) {
    return this.#dataObject("/contact", {
      method: "PATCH",
      idempotencyKey,
      body: {
        ...(name === undefined ? {} : { name }),
        ...(email === undefined ? {} : { email }),
        ...(phone === undefined ? {} : { phone }),
        ...(customAttributes === undefined
          ? {}
          : { custom_attributes: customAttributes }),
      },
    });
  }

  trackEvent({ name, properties = {}, idempotencyKey } = {}) {
    return this.#dataObject("/events", {
      method: "POST",
      idempotencyKey,
      body: {
        name: boundedText(name, "event_name", 128),
        properties,
      },
    });
  }

  inboxMembers(inboxId) {
    return this.#dataList(`/inboxes/${segment(inboxId)}/members`, { method: "GET" });
  }

  proactiveSupport({ cursor, limit = 50 } = {}) {
    return this.#dataList(
      appendQuery("/proactive-support", {
        cursor: optionalBoundedText(cursor, "cursor", MAX_CURSOR_LENGTH),
        limit: pageSize(limit),
      }),
      { method: "GET" },
    );
  }

  conversationLabels(conversationId) {
    return this.#dataList(`/conversations/${segment(conversationId)}/labels`, {
      method: "GET",
    });
  }

  requestTranscript(conversationId, { idempotencyKey } = {}) {
    return this.#dataObject(`/conversations/${segment(conversationId)}/transcript`, {
      method: "POST",
      body: {},
      idempotencyKey,
    });
  }

  submitCsat(conversationId, { rating, feedback, idempotencyKey } = {}) {
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new SuperBoardSupportException(
        "csat_rating_invalid",
        "CSAT rating must be between 1 and 5",
      );
    }
    return this.#dataObject(`/conversations/${segment(conversationId)}/csat`, {
      method: "POST",
      idempotencyKey,
      body: {
        rating,
        ...(feedback === undefined ? {} : { feedback: String(feedback).trim() }),
      },
    });
  }

  helpCenterCategories({ portalSlug, locale } = {}) {
    return this.#dataList(
      appendQuery(`/help-center/${segment(portalSlug)}/categories`, {
        locale: optionalBoundedText(locale, "locale", 32),
      }),
      { method: "GET" },
    );
  }

  searchHelpCenter({ portalSlug, query, locale, limit = 20 } = {}) {
    return this.#dataList(
      appendQuery(`/help-center/${segment(portalSlug)}/search`, {
        q: boundedText(query, "query", 500),
        locale: optionalBoundedText(locale, "locale", 32),
        limit: pageSize(limit),
      }),
      { method: "GET" },
    );
  }

  helpCenterArticle({ portalSlug, articleSlug, locale } = {}) {
    return this.#dataObject(
      appendQuery(
        `/help-center/${segment(portalSlug)}/articles/${segment(articleSlug)}`,
        { locale: optionalBoundedText(locale, "locale", 32) },
      ),
      { method: "GET" },
    );
  }

  recordHelpCenterView({ portalSlug, articleSlug, idempotencyKey } = {}) {
    return this.#dataObject(
      `/help-center/${segment(portalSlug)}/articles/${segment(articleSlug)}/views`,
      { method: "POST", body: {}, idempotencyKey },
    );
  }

  joinMeeting(conversationId, { meetingId, idempotencyKey } = {}) {
    return this.#dataObject(`/conversations/${segment(conversationId)}/meetings`, {
      method: "POST",
      idempotencyKey,
      body: meetingId === undefined ? {} : { meeting_id: meetingId },
    });
  }

  requestRealtimeTicket(conversationId, { idempotencyKey } = {}) {
    return this.#dataObject(
      `/conversations/${segment(conversationId)}/realtime-ticket`,
      { method: "POST", body: {}, idempotencyKey },
    );
  }

  realtime(options = {}) {
    return new SuperBoardSupportRealtime(this, options);
  }

  close() {
    this.closed = true;
  }

  async _openRealtimeSocket(conversationId) {
    const ticket = await this.requestRealtimeTicket(conversationId);
    const token = boundedText(ticket.ticket, "realtime_ticket", 8 * 1024);
    const target = new URL(
      `${SUPERBOARD_SUPPORT_REALTIME_PATH}/${encodeURIComponent(token)}`,
      this.baseUrl,
    );
    target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
    const factory = this.webSocketFactory || defaultWebSocketFactory;
    return factory(target.toString());
  }

  async #dataObject(path, options) {
    return dataObject(await this.#request(path, options), "support_response_invalid");
  }

  async #dataList(path, options) {
    const payload = await this.#request(path, options);
    if (!Array.isArray(payload.data) || payload.data.some((item) => !isRecord(item))) {
      throw new SuperBoardSupportException(
        "support_response_invalid",
        "Support returned an invalid response",
        { requestId: requestIdFromPayload(payload) },
      );
    }
    return payload.data;
  }

  async #request(
    path,
    {
      method = "GET",
      body,
      rawBody,
      headers = {},
      idempotencyKey,
      responseType = "json",
    } = {},
  ) {
    if (this.closed) {
      throw new SuperBoardSupportException("client_closed", "Support client is closed");
    }
    this.assertAllowedDomain();
    const normalizedMethod = String(method).toUpperCase();
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(normalizedMethod);
    const stableKey = mutation
      ? normalizeIdempotencyKey(idempotencyKey || createIdempotencyKey())
      : null;
    const serializedBody = rawBody === undefined
      ? body === undefined
        ? undefined
        : JSON.stringify(body)
      : rawBody;
    const maximumAttempts = this.retryDelaysMs.length + 1;
    let refreshedAfterUnauthorized = false;
    let lastError;

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      await this.#refreshIfExpiring();
      const requestHeaders = await this.#headers({
        method: normalizedMethod,
        path,
        body: serializedBody,
        idempotencyKey: stableKey,
        headers,
      });
      let response;
      try {
        response = await this.#fetchWithTimeout(new URL(stripLeadingSlash(path), `${this.baseUrl}/`), {
          method: normalizedMethod,
          headers: requestHeaders,
          body: ["GET", "HEAD"].includes(normalizedMethod) ? undefined : serializedBody,
        });
      } catch (error) {
        lastError = error instanceof SuperBoardSupportException
          ? error
          : new SuperBoardSupportException(
              "request_unavailable",
              "Support is temporarily unavailable",
              { retryable: true, cause: error },
            );
        if (!lastError.retryable || attempt + 1 >= maximumAttempts) throw lastError;
        await delay(this.retryDelaysMs[attempt]);
        continue;
      }

      if (
        response.status === 401 &&
        this.identityTokenProvider &&
        !refreshedAfterUnauthorized
      ) {
        refreshedAfterUnauthorized = true;
        await this.#refreshIdentityToken();
        attempt -= 1;
        continue;
      }
      if (response.ok && responseType === "response") return response;

      let payload;
      try {
        payload = await parseResponsePayload(response);
      } catch (error) {
        lastError = error;
        if (
          !(error instanceof SuperBoardSupportException) ||
          !error.retryable ||
          attempt + 1 >= maximumAttempts
        ) {
          throw error;
        }
        await delay(this.retryDelaysMs[attempt]);
        continue;
      }
      if (response.ok) return payload;
      lastError = supportErrorFrom(response, payload);
      if (
        attempt + 1 >= maximumAttempts ||
        !(lastError.retryable || TRANSIENT_STATUS_CODES.has(response.status))
      ) {
        throw lastError;
      }
      await delay(this.retryDelaysMs[attempt]);
    }
    throw lastError || new SuperBoardSupportException(
      "request_failed",
      "Support request failed",
    );
  }

  async #headers({ method, path, body, idempotencyKey, headers }) {
    const result = new Headers(headers);
    if (body !== undefined && !result.has("Content-Type")) {
      result.set("Content-Type", "application/json");
    }
    result.set("Accept", "application/json");
    result.set("X-SuperBoard-Project-Id", this.projectId);
    if (this.identityToken) result.set("Authorization", `Bearer ${this.identityToken}`);
    if (this.widgetKey) result.set("X-SuperBoard-Widget-Key", this.widgetKey);
    if (this.visitorId) {
      result.set("X-SuperBoard-Widget-Visitor", this.visitorId);
    }
    if (idempotencyKey) result.set("Idempotency-Key", idempotencyKey);
    if (this.widgetSignatureProvider) {
      const timestamp = `${Math.floor(Date.now() / 1_000)}`;
      const publicPath = new URL(stripLeadingSlash(path), `${this.baseUrl}/`).pathname;
      const bodySha256 = await sha256Hex(body);
      const canonicalInput = [
        timestamp,
        method,
        publicPath,
        this.projectId,
        this.visitorId,
        idempotencyKey || "",
        bodySha256,
      ].join("\n");
      const value = await this.widgetSignatureProvider({
        method,
        path: publicPath,
        bodySha256,
        canonicalInput,
        projectId: this.projectId,
        visitorId: this.visitorId,
        timestamp,
        idempotencyKey,
      });
      const signature = typeof value === "string" ? value : value?.signature;
      const signedAt = typeof value === "string" ? timestamp : value?.timestamp || timestamp;
      if (String(signedAt) !== timestamp) {
        throw new SuperBoardSupportException(
          "widget_signature_invalid",
          "Widget signature timestamp does not match the signed request",
        );
      }
      result.set(
        "X-SuperBoard-Widget-Signature",
        boundedText(signature, "widget_signature", 8 * 1024),
      );
      result.set(
        "X-SuperBoard-Widget-Timestamp",
        boundedText(signedAt, "widget_timestamp", 64),
      );
    }
    return result;
  }

  async #fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImplementation(url, {
        ...init,
        credentials: "omit",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SuperBoardSupportException(
          "request_timeout",
          "Support request timed out",
          { retryable: true, cause: error },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async #refreshIfExpiring() {
    if (!this.identityTokenProvider || !this.identityToken) return;
    const expiration = tokenExpiration(this.identityToken);
    if (expiration !== null && expiration <= Date.now() + 60_000) {
      await this.#refreshIdentityToken();
    }
  }

  async #refreshIdentityToken() {
    if (!this.identityTokenProvider) {
      throw new SuperBoardSupportException(
        "identity_refresh_unavailable",
        "Support identity refresh is not configured",
      );
    }
    this.refreshPromise ||= Promise.resolve().then(() => this.identityTokenProvider());
    const refresh = this.refreshPromise;
    try {
      const value = await refresh;
      this.setIdentityToken(typeof value === "string" ? value : value?.token);
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = null;
    }
  }
}

function normalizeSupportBaseUrl(input) {
  let url;
  try {
    const fallback = typeof globalThis.location === "undefined"
      ? undefined
      : globalThis.location.origin;
    url = new URL(input || fallback);
  } catch {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password) {
    throw new TypeError("baseUrl must be an absolute HTTP(S) URL");
  }
  if (url.search || url.hash) {
    throw new TypeError("baseUrl must not include a query or fragment");
  }
  const normalizedPath = url.pathname.replace(/\/+$/u, "") || "/";
  if (normalizedPath === "/") {
    url.pathname = SUPERBOARD_SUPPORT_WIDGET_PATH;
  } else if (normalizedPath === SUPERBOARD_SUPPORT_WIDGET_PATH) {
    url.pathname = SUPERBOARD_SUPPORT_WIDGET_PATH;
  } else {
    throw new TypeError(
      `baseUrl path must be ${SUPERBOARD_SUPPORT_WIDGET_PATH}`,
    );
  }
  return url.toString().replace(/\/+$/u, "");
}

function supportErrorFrom(response, payload) {
  const source = isRecord(payload.error) ? payload.error : payload;
  return new SuperBoardSupportException(
    typeof source.code === "string" ? source.code : "request_failed",
    typeof source.message === "string" ? source.message : "Support request failed",
    {
      retryable: source.retryable === true || response.status >= 500,
      statusCode: response.status,
      requestId:
        (typeof source.request_id === "string" && source.request_id) ||
        response.headers.get("x-request-id"),
      details: isRecord(source.details) ? source.details : null,
    },
  );
}

async function parseResponsePayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    const payload = JSON.parse(text);
    if (isRecord(payload)) return payload;
  } catch {
    // A stable SDK error is emitted below.
  }
  throw new SuperBoardSupportException(
    "response_invalid",
    "Support returned an invalid response",
    {
      retryable: response.status >= 500,
      statusCode: response.status,
      requestId: response.headers.get("x-request-id"),
    },
  );
}

function dataObject(payload, errorCode) {
  if (isRecord(payload.data)) return payload.data;
  throw new SuperBoardSupportException(
    errorCode,
    "Support returned an invalid response",
    { requestId: requestIdFromPayload(payload) },
  );
}

function requestIdFromPayload(payload) {
  return isRecord(payload.meta) && typeof payload.meta.request_id === "string"
    ? payload.meta.request_id
    : null;
}

function attachmentBody(value) {
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { body: value, byteLength: value.size };
  }
  if (value instanceof ArrayBuffer) {
    return { body: value, byteLength: value.byteLength };
  }
  if (ArrayBuffer.isView(value)) {
    const body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return { body, byteLength: value.byteLength };
  }
  throw new TypeError("Attachment data must be a Blob, ArrayBuffer, or typed array");
}

function normalizeAllowedDomains(input) {
  if (!Array.isArray(input)) throw new TypeError("allowedDomains must be an array");
  return Object.freeze(
    [...new Set(input.map((value) => {
      const domain = boundedText(value, "allowed_domain", 253).toLowerCase();
      if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(domain)) {
        throw new TypeError("allowedDomains contains an invalid hostname");
      }
      return domain;
    }))],
  );
}

function resolveWidgetVisitorId({ visitorId, widgetKey, projectId, baseUrl }) {
  if (!widgetKey) {
    if (visitorId !== undefined && visitorId !== null && String(visitorId).trim()) {
      throw new SuperBoardSupportException(
        "widget_key_required",
        "A widget key is required when a visitor ID is configured",
      );
    }
    return null;
  }
  if (visitorId !== undefined && visitorId !== null && String(visitorId).trim()) {
    return validateVisitorId(visitorId);
  }
  const storageKey = [
    "superboard.support.visitor.v1",
    encodeURIComponent(new URL(baseUrl).origin),
    encodeURIComponent(projectId),
    encodeURIComponent(widgetKey),
  ].join(".");
  let storage = null;
  try {
    storage = globalThis.window?.localStorage || null;
    const stored = storage?.getItem(storageKey);
    if (stored) {
      try {
        return validateVisitorId(stored);
      } catch {
        storage?.removeItem(storageKey);
      }
    }
  } catch {
    storage = null;
  }
  const generated = createVisitorId();
  try {
    storage?.setItem(storageKey, generated);
  } catch {
    // Privacy modes may disable storage; the generated identity remains stable
    // for this client instance without weakening request authentication.
  }
  return generated;
}

function validateVisitorId(value) {
  const normalized = boundedText(value, "widget_visitor", MAX_IDENTIFIER_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)) {
    throw new SuperBoardSupportException(
      "widget_visitor_invalid",
      "Widget visitor ID contains unsupported characters",
    );
  }
  return normalized;
}

function createVisitorId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `visitor-${globalThis.crypto.randomUUID()}`;
  }
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return `visitor-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  throw new SuperBoardSupportException(
    "widget_identity_unavailable",
    "Secure visitor identity generation is unavailable",
  );
}

function normalizeIdempotencyKey(value) {
  const key = boundedText(value, "idempotency_key", MAX_IDEMPOTENCY_KEY_LENGTH);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(key)) {
    throw new SuperBoardSupportException(
      "idempotency_key_invalid",
      "Idempotency key contains unsupported characters",
    );
  }
  return key;
}

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `support-${globalThis.crypto.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2);
  return `support-${Date.now().toString(36)}-${random}`;
}

function pageSize(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return 1;
  return Math.min(number, MAX_PAGE_SIZE);
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new SuperBoardSupportException(`${field}_invalid`, `${field} must be positive`);
  }
  return number;
}

function segment(value) {
  return encodeURIComponent(boundedText(value, "identifier", MAX_IDENTIFIER_LENGTH));
}

function appendQuery(path, values) {
  const url = new URL(path, "https://support.invalid");
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

function stripLeadingSlash(value) {
  return String(value).replace(/^\/+/, "");
}

function boundedText(value, field, maximum) {
  const normalized = value === undefined || value === null ? "" : String(value).trim();
  if (!normalized || normalized.length > maximum) {
    throw new SuperBoardSupportException(
      `${field}_invalid`,
      `${field} must contain between 1 and ${maximum} characters`,
    );
  }
  return normalized;
}

function optionalText(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return String(value).trim();
}

function optionalBoundedText(value, field, maximum) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return boundedText(value, field, maximum);
}

function validateFunction(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
}

function tokenExpiration(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const segmentValue = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = segmentValue.padEnd(Math.ceil(segmentValue.length / 4) * 4, "=");
    const decoded = typeof globalThis.atob === "function"
      ? globalThis.atob(padded)
      : globalThis.Buffer?.from(padded, "base64").toString("utf8");
    const value = JSON.parse(decoded);
    return typeof value.exp === "number" ? value.exp * 1_000 : null;
  } catch {
    return null;
  }
}

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

async function sha256Hex(value) {
  if (typeof globalThis.crypto?.subtle?.digest !== "function") {
    throw new SuperBoardSupportException(
      "widget_signature_unavailable",
      "Secure widget request signing is unavailable",
    );
  }
  let bytes;
  if (value === undefined || value === null) {
    bytes = new Uint8Array();
  } else if (typeof value === "string") {
    bytes = new TextEncoder().encode(value);
  } else if (typeof Blob !== "undefined" && value instanceof Blob) {
    bytes = new Uint8Array(await value.arrayBuffer());
  } else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw new SuperBoardSupportException(
      "widget_signature_body_invalid",
      "Widget request body cannot be signed",
    );
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function delay(milliseconds) {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function defaultWebSocketFactory(url) {
  if (typeof globalThis.WebSocket !== "function") {
    throw new SuperBoardSupportException(
      "realtime_unavailable",
      "WebSocket is unavailable in this runtime",
    );
  }
  return new globalThis.WebSocket(url);
}
