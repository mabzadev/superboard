import { SuperBoardSupportException } from "./error.js";

/**
 * Accessible, dependency-free Support widget rendered inside a closed Shadow
 * DOM. All user content is assigned through `textContent`.
 */
export class SuperBoardSupportWidget {
  constructor({
    client,
    title = "Support",
    launcherLabel = "Open support",
    closeLabel = "Close support",
    emptyMessage = "How can we help?",
    inputLabel = "Message",
    sendLabel = "Send",
    locale = "en",
  } = {}) {
    if (!client || typeof client.conversations !== "function") {
      throw new TypeError("A SuperBoardSupportClient is required");
    }
    this.client = client;
    this.labels = Object.freeze({
      title: label(title, "title"),
      launcher: label(launcherLabel, "launcherLabel"),
      close: label(closeLabel, "closeLabel"),
      empty: label(emptyMessage, "emptyMessage"),
      input: label(inputLabel, "inputLabel"),
      send: label(sendLabel, "sendLabel"),
    });
    this.locale = validLocale(locale);
    this.host = null;
    this.root = null;
    this.elements = null;
    this.conversation = null;
    this.realtime = null;
    this.unsubscribeRealtime = null;
    this.loadingPromise = null;
    this.destroyed = false;
    this.wasFocused = null;
    this.onLauncherClick = () => void this.open();
    this.onCloseClick = () => this.close();
    this.onSubmit = (event) => void this.#submit(event);
    this.onKeyDown = (event) => {
      if (event.key === "Escape") this.close();
    };
  }

  mount(target) {
    if (this.destroyed) {
      throw new SuperBoardSupportException("widget_destroyed", "Support widget is destroyed");
    }
    if (this.host) return this;
    const documentValue = globalThis.document;
    if (!documentValue) {
      throw new SuperBoardSupportException(
        "widget_dom_unavailable",
        "Support widget requires a browser document",
      );
    }
    const host = typeof target === "string" ? documentValue.querySelector(target) : target;
    if (!host || typeof host.attachShadow !== "function") {
      throw new TypeError("Widget target must be a DOM element");
    }
    const root = host.attachShadow({ mode: "closed" });
    const elements = createWidgetElements(documentValue, this.labels, this.locale);
    root.append(elements.style, elements.shell);
    elements.launcher.addEventListener("click", this.onLauncherClick);
    elements.close.addEventListener("click", this.onCloseClick);
    elements.form.addEventListener("submit", this.onSubmit);
    elements.panel.addEventListener("keydown", this.onKeyDown);
    this.host = host;
    this.root = root;
    this.elements = elements;
    return this;
  }

  async open() {
    this.#assertMounted();
    this.client.assertAllowedDomain();
    this.wasFocused = globalThis.document?.activeElement || null;
    this.elements.panel.hidden = false;
    this.elements.panel.setAttribute("aria-hidden", "false");
    this.elements.launcher.setAttribute("aria-expanded", "true");
    this.elements.launcher.hidden = true;
    this.elements.close.focus();
    this.loadingPromise ||= this.#load().finally(() => {
      this.loadingPromise = null;
    });
    return this.loadingPromise;
  }

  close() {
    if (!this.elements || this.elements.panel.hidden) return;
    this.elements.panel.hidden = true;
    this.elements.panel.setAttribute("aria-hidden", "true");
    this.elements.launcher.hidden = false;
    this.elements.launcher.setAttribute("aria-expanded", "false");
    if (this.wasFocused && typeof this.wasFocused.focus === "function") {
      this.wasFocused.focus();
    } else {
      this.elements.launcher.focus();
    }
  }

  setIdentityToken(value) {
    this.client.setIdentityToken(value);
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeRealtime?.();
    this.unsubscribeRealtime = null;
    await this.realtime?.dispose();
    this.realtime = null;
    if (this.elements) {
      this.elements.launcher.removeEventListener("click", this.onLauncherClick);
      this.elements.close.removeEventListener("click", this.onCloseClick);
      this.elements.form.removeEventListener("submit", this.onSubmit);
      this.elements.panel.removeEventListener("keydown", this.onKeyDown);
    }
    this.root?.replaceChildren();
    this.host = null;
    this.root = null;
    this.elements = null;
  }

  async #load() {
    this.#setBusy(true);
    this.elements.error.textContent = "";
    this.#setStatus("Loading support…");
    try {
      const conversations = await this.client.conversations({ limit: 1 });
      this.conversation = conversations[0] || await this.client.createConversation({
        clientConversationId: widgetIdentifier("conversation"),
      });
      await this.#refreshMessages();
      await this.#connectRealtime();
      this.#setStatus("");
      this.elements.input.focus();
    } catch (error) {
      this.#showError(error);
      throw error;
    } finally {
      this.#setBusy(false);
    }
  }

  async #refreshMessages() {
    const messages = await this.client.messages(this.conversation.id, { limit: 100 });
    this.elements.messages.replaceChildren();
    if (messages.length === 0) {
      const empty = this.elements.messages.ownerDocument.createElement("p");
      empty.className = "empty";
      empty.textContent = this.labels.empty;
      this.elements.messages.append(empty);
    } else {
      for (const message of messages) this.#appendMessage(message);
    }
    this.#scrollMessages();
  }

  async #connectRealtime() {
    this.unsubscribeRealtime?.();
    await this.realtime?.dispose();
    this.realtime = this.client.realtime();
    this.unsubscribeRealtime = this.realtime.subscribe((event) => {
      if (event.type === "message.created" && event.message) {
        this.#removeEmptyState();
        this.#replaceMessage(event.message, true);
        this.#scrollMessages();
      } else if (event.type === "message.updated" && event.message) {
        this.#replaceMessage(event.message);
      } else if (event.type === "message.deleted" && event.message_id) {
        this.#removeMessage(event.message_id);
      } else if (event.type === "error" && event.error?.retryable === false) {
        this.#setStatus(event.error.message || "A realtime update could not be displayed");
      }
    });
    try {
      await this.realtime.connect(this.conversation.id);
    } catch (error) {
      if (!(error instanceof SuperBoardSupportException) || !error.retryable) throw error;
      this.#setStatus("Messages remain available while realtime reconnects.");
    }
  }

  async #submit(event) {
    event.preventDefault();
    if (!this.conversation || this.elements.send.disabled) return;
    const body = this.elements.input.value.trim();
    if (!body) return;
    this.elements.send.disabled = true;
    this.elements.input.disabled = true;
    this.elements.error.textContent = "";
    this.#setStatus("Sending…");
    try {
      const message = await this.client.sendMessage(this.conversation.id, {
        body,
        clientMessageId: widgetIdentifier("message"),
      });
      this.elements.input.value = "";
      this.#removeEmptyState();
      this.#replaceMessage(message, true);
      this.#scrollMessages();
      this.#setStatus("Message sent");
    } catch (error) {
      this.#showError(error);
    } finally {
      this.elements.send.disabled = false;
      this.elements.input.disabled = false;
      this.elements.input.focus();
    }
  }

  #appendMessage(message) {
    const item = this.elements.messages.ownerDocument.createElement("article");
    item.className = message.sender_kind === "user" ? "message user" : "message support";
    item.dataset.messageId = String(message.id || "");
    const body = this.elements.messages.ownerDocument.createElement("p");
    body.textContent = typeof message.body === "string" ? message.body : "Attachment";
    item.append(body);
    if (message.created_at) {
      const time = this.elements.messages.ownerDocument.createElement("time");
      time.dateTime = String(message.created_at);
      const date = new Date(message.created_at);
      time.textContent = Number.isNaN(date.valueOf())
        ? ""
        : new Intl.DateTimeFormat(this.locale, {
            hour: "2-digit",
            minute: "2-digit",
          }).format(date);
      item.append(time);
    }
    this.elements.messages.append(item);
  }

  #replaceMessage(message, appendWhenMissing = false) {
    const identifier = String(message.id || "");
    const existing = [...this.elements.messages.querySelectorAll("[data-message-id]")]
      .find((element) => element.dataset.messageId === identifier);
    if (!existing) {
      if (appendWhenMissing) this.#appendMessage(message);
      return;
    }
    const body = existing.querySelector("p");
    if (body) body.textContent = typeof message.body === "string" ? message.body : "Attachment";
  }

  #removeMessage(messageId) {
    const identifier = String(messageId);
    for (const item of this.elements.messages.querySelectorAll("[data-message-id]")) {
      if (item.dataset.messageId === identifier) item.remove();
    }
  }

  #removeEmptyState() {
    this.elements.messages.querySelector(".empty")?.remove();
  }

  #scrollMessages() {
    this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
  }

  #setBusy(busy) {
    this.elements.panel.setAttribute("aria-busy", busy ? "true" : "false");
    this.elements.input.disabled = busy;
    this.elements.send.disabled = busy;
  }

  #setStatus(message) {
    this.elements.status.textContent = message;
  }

  #showError(error) {
    const message = error instanceof SuperBoardSupportException
      ? error.message
      : "Support is temporarily unavailable";
    this.elements.error.textContent = message;
    this.#setStatus(message);
  }

  #assertMounted() {
    if (this.destroyed) {
      throw new SuperBoardSupportException("widget_destroyed", "Support widget is destroyed");
    }
    if (!this.elements) {
      throw new SuperBoardSupportException(
        "widget_not_mounted",
        "Support widget must be mounted before it is opened",
      );
    }
  }
}

function createWidgetElements(documentValue, labels, locale) {
  const instanceId = widgetIdentifier("panel");
  const style = documentValue.createElement("style");
  style.textContent = WIDGET_CSS;

  const shell = documentValue.createElement("div");
  shell.className = "shell";
  shell.lang = locale;

  const launcher = button(documentValue, labels.launcher, "launcher");
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", instanceId);

  const panel = documentValue.createElement("section");
  panel.className = "panel";
  panel.id = instanceId;
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-labelledby", `${instanceId}-title`);

  const header = documentValue.createElement("header");
  const title = documentValue.createElement("h2");
  title.id = `${instanceId}-title`;
  title.textContent = labels.title;
  const close = button(documentValue, "×", "close");
  close.type = "button";
  close.setAttribute("aria-label", labels.close);
  header.append(title, close);

  const error = documentValue.createElement("p");
  error.className = "error";
  error.setAttribute("role", "alert");

  const messages = documentValue.createElement("div");
  messages.className = "messages";
  messages.setAttribute("role", "log");
  messages.setAttribute("aria-live", "polite");
  messages.setAttribute("aria-relevant", "additions text");

  const form = documentValue.createElement("form");
  const inputLabel = documentValue.createElement("label");
  inputLabel.className = "visually-hidden";
  inputLabel.htmlFor = `${instanceId}-message`;
  inputLabel.textContent = labels.input;
  const input = documentValue.createElement("textarea");
  input.id = `${instanceId}-message`;
  input.name = "message";
  input.rows = 2;
  input.maxLength = 65_536;
  input.required = true;
  input.placeholder = labels.input;
  const send = button(documentValue, labels.send, "send");
  send.type = "submit";
  form.append(inputLabel, input, send);

  const status = documentValue.createElement("p");
  status.className = "visually-hidden";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  panel.append(header, error, messages, form, status);
  shell.append(launcher, panel);
  return { style, shell, launcher, panel, close, error, messages, form, input, send, status };
}

function button(documentValue, text, className) {
  const element = documentValue.createElement("button");
  element.className = className;
  element.textContent = text;
  return element;
}

function label(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 255) {
    throw new TypeError(`${field} must contain between 1 and 255 characters`);
  }
  return normalized;
}

function validLocale(value) {
  const normalized = label(value, "locale");
  try {
    new Intl.DateTimeFormat(normalized);
  } catch {
    throw new TypeError("locale must be a valid language tag");
  }
  return normalized;
}

function widgetIdentifier(prefix) {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const WIDGET_CSS = `
:host { all: initial; color-scheme: light dark; }
*, *::before, *::after { box-sizing: border-box; }
.shell { --sb-accent: #4f46e5; --sb-surface: #fff; --sb-text: #171717; --sb-muted: #737373; --sb-border: #e5e5e5; position: fixed; z-index: 2147483000; right: 1rem; bottom: 1rem; font: 400 15px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--sb-text); }
button, textarea { font: inherit; }
button { cursor: pointer; }
.launcher { min-height: 3rem; padding: .75rem 1.1rem; border: 0; border-radius: 999px; color: #fff; background: var(--sb-accent); box-shadow: 0 12px 30px rgb(0 0 0 / .22); font-weight: 700; }
.launcher:focus-visible, .close:focus-visible, .send:focus-visible, textarea:focus-visible { outline: 3px solid #a5b4fc; outline-offset: 2px; }
.panel { width: min(24rem, calc(100vw - 2rem)); height: min(38rem, calc(100vh - 2rem)); overflow: hidden; border: 1px solid var(--sb-border); border-radius: 1rem; background: var(--sb-surface); box-shadow: 0 20px 55px rgb(0 0 0 / .25); }
.panel[hidden] { display: none; }
header { min-height: 4rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 1rem; border-bottom: 1px solid var(--sb-border); }
h2 { margin: 0; font-size: 1.05rem; }
.close { width: 2.5rem; height: 2.5rem; border: 0; border-radius: 50%; color: inherit; background: transparent; font-size: 1.5rem; }
.close:hover { background: color-mix(in srgb, var(--sb-text) 8%, transparent); }
.messages { height: calc(100% - 9.5rem); overflow: auto; padding: 1rem; background: color-mix(in srgb, var(--sb-surface) 96%, var(--sb-text)); }
.empty { margin: 2rem auto; color: var(--sb-muted); text-align: center; }
.message { width: fit-content; max-width: 85%; margin: .5rem 0; padding: .65rem .8rem; border-radius: .85rem; background: color-mix(in srgb, var(--sb-text) 8%, var(--sb-surface)); overflow-wrap: anywhere; }
.message.user { margin-left: auto; color: #fff; background: var(--sb-accent); }
.message p { margin: 0; white-space: pre-wrap; }
.message time { display: block; margin-top: .25rem; color: inherit; opacity: .7; font-size: .72rem; }
form { min-height: 5.5rem; display: grid; grid-template-columns: 1fr auto; gap: .5rem; padding: .75rem; border-top: 1px solid var(--sb-border); }
textarea { resize: none; min-width: 0; padding: .65rem; border: 1px solid var(--sb-border); border-radius: .65rem; color: inherit; background: var(--sb-surface); }
.send { align-self: end; min-height: 2.6rem; padding: .55rem .85rem; border: 0; border-radius: .65rem; color: #fff; background: var(--sb-accent); font-weight: 700; }
button:disabled, textarea:disabled { cursor: wait; opacity: .6; }
.error:empty { display: none; }
.error { margin: 0; padding: .55rem .8rem; color: #991b1b; background: #fef2f2; font-size: .85rem; }
.visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
@media (prefers-color-scheme: dark) { .shell { --sb-surface: #171717; --sb-text: #fafafa; --sb-muted: #a3a3a3; --sb-border: #404040; } .error { color: #fecaca; background: #450a0a; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
@media (max-width: 30rem) { .shell { inset: .5rem; } .launcher { position: absolute; right: .5rem; bottom: .5rem; } .panel { width: 100%; height: 100%; border-radius: .75rem; } }
`;
