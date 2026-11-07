import { SuperBoardError } from "./errors.js";

const DEFAULT_HEARTBEAT_MS = 25_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const CHANGE_EVENTS = new Set(["INSERT", "UPDATE", "DELETE", "*"]);
const DELIVER = Symbol("deliver");
const JOINED = Symbol("joined");
const FAILED = Symbol("failed");
const DISCONNECTED = Symbol("disconnected");

function defaultReconnectDelay(attempt) {
	const base = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
	return base + Math.floor(Math.random() * 250);
}

function unref(timer) {
	if (timer && typeof timer === "object" && typeof timer.unref === "function") timer.unref();
	return timer;
}

function notify(callback, ...args) {
	try {
		callback(...args);
	} catch (error) {
		queueMicrotask(() => {
			throw error;
		});
	}
}

function sameState(left, right) {
	return JSON.stringify(left) === JSON.stringify(right);
}

export class RealtimeClient {
	#transport;
	#WebSocket;
	#heartbeatMs;
	#reconnectDelay;
	#socket = null;
	#open = false;
	#connecting = false;
	#generation = 0;
	#attempt = 0;
	#refs = 0;
	#topics = new Map();
	#pending = new Map();
	#heartbeat = null;
	#awaitingPong = null;
	#reconnectTimer = null;
	#hub;

	constructor(transport, options = {}) {
		this.#transport = transport;
		this.#WebSocket = options.WebSocket ?? globalThis.WebSocket;
		this.#heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
		this.#reconnectDelay = options.reconnectDelayMs ?? defaultReconnectDelay;
		this.#hub = {
			join: (topic, channel, config) => this.#attach(topic, channel, config),
			leave: (topic, channel) => this.#detach(topic, channel),
			send: (message) => this.#send(message),
			request: (message) => this.#request(message),
			joined: (topic) => this.#topics.get(topic)?.joined === true,
		};
	}

	get state() {
		if (this.#open) return "open";
		return this.#socket || this.#connecting || this.#reconnectTimer ? "connecting" : "closed";
	}

	channel(name, options = {}) {
		return new RealtimeChannel(this.#hub, name, options);
	}

	reconnect() {
		this.#generation += 1;
		this.#attempt = 0;
		this.#dropSocket();
		if (this.#topics.size > 0) this.#schedule(0);
	}

	disconnect() {
		for (const { channels } of this.#topics.values())
			for (const channel of channels) void channel.unsubscribe();
		this.#topics.clear();
		this.#generation += 1;
		this.#dropSocket();
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = null;
	}

	#attach(topic, channel, config) {
		let state = this.#topics.get(topic);
		if (!state) {
			state = { channels: new Set(), config, joined: false, joinRef: null };
			this.#topics.set(topic, state);
		}
		state.channels.add(channel);
		if (state.joined) queueMicrotask(() => channel[JOINED](topic));
		else if (this.#open && !state.joinRef) this.#join(topic, state);
		else if (!this.#open) this.#ensureConnection();
	}

	#detach(topic, channel) {
		const state = this.#topics.get(topic);
		if (!state) return;
		state.channels.delete(channel);
		if (state.channels.size > 0) return;
		this.#topics.delete(topic);
		if (this.#open) this.#send({ type: "leave", channel: topic, ref: this.#ref() });
		if (this.#topics.size === 0) {
			this.#generation += 1;
			this.#dropSocket();
			clearTimeout(this.#reconnectTimer);
			this.#reconnectTimer = null;
		}
	}

	#ref() {
		this.#refs += 1;
		return String(this.#refs);
	}

	#send(message) {
		if (!this.#open || !this.#socket) return false;
		this.#socket.send(JSON.stringify(message));
		return true;
	}

	#request(message) {
		const ref = this.#ref();
		return new Promise((resolve, reject) => {
			if (!this.#send({ ...message, ref })) {
				reject(new SuperBoardError("realtime_disconnected", "The realtime connection is closed."));
				return;
			}
			this.#pending.set(ref, { resolve, reject });
		});
	}

	#ensureConnection() {
		if (this.#socket || this.#connecting || this.#reconnectTimer) return;
		this.#schedule(0);
	}

	#schedule(delay) {
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = setTimeout(() => {
			this.#reconnectTimer = null;
			void this.#connect();
		}, delay);
	}

	async #connect() {
		if (this.#socket || this.#connecting || this.#topics.size === 0) return;
		this.#connecting = true;
		const generation = this.#generation;
		let ticket;
		try {
			ticket = await this.#transport.request("POST", "/realtime/tickets", { json: {} });
		} catch (error) {
			this.#connecting = false;
			if (generation !== this.#generation) return;
			if (error?.retryable || !error?.status) this.#retry();
			else for (const [topic, state] of this.#topics) this.#fail(topic, state, error);
			return;
		}
		this.#connecting = false;
		if (generation !== this.#generation) {
			if (this.#topics.size > 0) this.#ensureConnection();
			return;
		}
		if (this.#topics.size === 0) return;
		if (typeof this.#WebSocket !== "function") {
			const error = new SuperBoardError(
				"websocket_unavailable",
				"Pass a WebSocket implementation to use realtime channels.",
			);
			for (const [topic, state] of this.#topics) this.#fail(topic, state, error);
			return;
		}
		const socket = new this.#WebSocket(ticket.url);
		this.#socket = socket;
		socket.onopen = () => {
			if (socket !== this.#socket) return;
			this.#open = true;
			this.#attempt = 0;
			this.#startHeartbeat();
			for (const [topic, state] of this.#topics) this.#join(topic, state);
		};
		socket.onmessage = (event) => {
			if (socket === this.#socket) this.#receive(event.data);
		};
		socket.onclose = () => this.#closed(socket);
		socket.onerror = () => {};
	}

	#join(topic, state) {
		const ref = this.#ref();
		state.joinRef = ref;
		this.#send({
			type: "join",
			channel: topic,
			ref,
			...(state.config ? { config: state.config } : {}),
		});
	}

	#fail(topic, state, error) {
		state.joined = false;
		state.joinRef = null;
		for (const channel of state.channels) channel[FAILED](topic, error);
	}

	#retry() {
		const delay = this.#reconnectDelay(this.#attempt);
		this.#attempt += 1;
		this.#schedule(delay);
	}

	#startHeartbeat() {
		clearInterval(this.#heartbeat);
		this.#awaitingPong = null;
		this.#heartbeat = unref(
			setInterval(() => {
				const socket = this.#socket;
				if (!socket || !this.#open) return;
				if (this.#awaitingPong) {
					this.#closed(socket);
					try {
						socket.close(4000, "heartbeat timeout");
					} catch {}
					return;
				}
				this.#awaitingPong = this.#ref();
				this.#send({ type: "ping", ref: this.#awaitingPong });
			}, this.#heartbeatMs),
		);
	}

	#dropSocket() {
		const socket = this.#socket;
		this.#socket = null;
		this.#cleanup();
		if (socket)
			try {
				socket.close(1000, "closed by client");
			} catch {}
	}

	#cleanup() {
		const wasOpen = this.#open;
		this.#open = false;
		clearInterval(this.#heartbeat);
		this.#heartbeat = null;
		this.#awaitingPong = null;
		for (const { reject } of this.#pending.values())
			reject(new SuperBoardError("realtime_disconnected", "The realtime connection closed."));
		this.#pending.clear();
		for (const [topic, state] of this.#topics) {
			state.joined = false;
			state.joinRef = null;
			if (wasOpen) for (const channel of state.channels) channel[DISCONNECTED](topic);
		}
	}

	#closed(socket) {
		if (socket !== this.#socket) return;
		this.#socket = null;
		this.#cleanup();
		if (this.#topics.size > 0) this.#retry();
	}

	#receive(data) {
		let message;
		try {
			message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
		} catch {
			return;
		}
		if (!message || typeof message.type !== "string") return;
		if (message.type === "pong") {
			if (message.ref === this.#awaitingPong) this.#awaitingPong = null;
			return;
		}
		const pending = typeof message.ref === "string" ? this.#pending.get(message.ref) : undefined;
		if (message.type === "ack" && pending) {
			this.#pending.delete(message.ref);
			pending.resolve();
			return;
		}
		const state =
			typeof message.channel === "string" ? this.#topics.get(message.channel) : undefined;
		if (message.type === "joined") {
			if (!state || state.joinRef !== message.ref) return;
			state.joined = true;
			state.joinRef = null;
			for (const channel of state.channels) channel[JOINED](message.channel);
			return;
		}
		if (message.type === "error") {
			const error = new SuperBoardError(
				typeof message.code === "string" ? message.code : "realtime_error",
				`Realtime error: ${String(message.code)}`,
			);
			if (pending) {
				this.#pending.delete(message.ref);
				pending.reject(error);
			} else if (state && state.joinRef === message.ref) {
				this.#fail(message.channel, state, error);
			} else if (state) {
				for (const channel of state.channels) channel[FAILED](message.channel, error, false);
			}
			return;
		}
		if (state) for (const channel of state.channels) channel[DELIVER](message.channel, message);
	}
}

export class RealtimeChannel {
	#hub;
	#name;
	#presenceKey;
	#broadcast = [];
	#presence = { sync: [], join: [], leave: [] };
	#changes = [];
	#statusListeners = [];
	#waiters = [];
	#topics = new Set();
	#joined = new Set();
	#presenceState = {};
	#tracked;
	#subscribed = false;
	#state = "closed";

	constructor(hub, name, options = {}) {
		if (typeof name !== "string" || !/^[A-Za-z0-9:_.-]{1,64}$/u.test(name))
			throw new TypeError(
				"Channel names have 1 to 64 letters, digits, colons, dots, dashes or underscores.",
			);
		this.#hub = hub;
		this.#name = name;
		this.#presenceKey = options.presence?.key;
	}

	get name() {
		return this.#name;
	}
	get state() {
		return this.#state;
	}

	on(type, filter, callback) {
		if (typeof callback !== "function") throw new TypeError("on() needs a callback.");
		if (type === "broadcast") {
			if (typeof filter !== "string" || !filter)
				throw new TypeError("Name the broadcast event, or use *.");
			this.#broadcast.push({ event: filter, callback });
		} else if (type === "presence") {
			if (!Object.hasOwn(this.#presence, filter))
				throw new TypeError("Presence events are sync, join and leave.");
			this.#presence[filter].push(callback);
		} else if (type === "change") {
			const event = filter?.event ?? "*";
			if (typeof filter?.table !== "string" || !filter.table || !CHANGE_EVENTS.has(event))
				throw new TypeError(
					"Change listeners need a table and an INSERT, UPDATE, DELETE or * event.",
				);
			this.#changes.push({ table: filter.table, event, callback });
		} else {
			throw new TypeError("Listen to broadcast, presence or change events.");
		}
		if (this.#subscribed) this.#joinTopics();
		return this;
	}

	subscribe(callback) {
		if (typeof callback === "function") this.#statusListeners.push(callback);
		const ready = new Promise((resolve, reject) => {
			if (this.#state === "joined") resolve(this);
			else this.#waiters.push({ resolve: () => resolve(this), reject });
		});
		if (this.#subscribed && this.#state === "errored") {
			for (const topic of this.#topics) this.#hub.leave(topic, this);
			this.#topics.clear();
			this.#joined.clear();
			this.#subscribed = false;
		}
		if (!this.#subscribed) {
			this.#subscribed = true;
			this.#state = "joining";
			this.#joinTopics();
		}
		return ready;
	}

	async unsubscribe() {
		this.#subscribed = false;
		for (const topic of this.#topics) this.#hub.leave(topic, this);
		this.#topics.clear();
		this.#joined.clear();
		this.#state = "closed";
		this.#settle(new SuperBoardError("channel_closed", "The channel was unsubscribed."));
		this.#status("CLOSED");
	}

	send(event, payload, { self = false } = {}) {
		if (!this.#joined.has(this.#name))
			return Promise.reject(
				new SuperBoardError("channel_not_joined", "Subscribe to the channel before sending."),
			);
		return this.#hub.request({
			type: "broadcast",
			channel: this.#name,
			event,
			payload: payload ?? null,
			...(self ? { self: true } : {}),
		});
	}

	async track(state) {
		this.#tracked = state ?? {};
		if (this.#subscribed) this.#joinTopics();
		if (this.#joined.has(this.#name))
			this.#hub.send({ type: "presence", channel: this.#name, state: this.#tracked });
	}

	async untrack() {
		this.#tracked = undefined;
		if (this.#joined.has(this.#name))
			this.#hub.send({ type: "presence_untrack", channel: this.#name });
	}

	presenceState() {
		return Object.fromEntries(
			Object.entries(this.#presenceState).map(([key, states]) => [key, [...states]]),
		);
	}

	#wantedTopics() {
		const topics = new Set();
		if (
			this.#broadcast.length ||
			this.#presence.sync.length ||
			this.#presence.join.length ||
			this.#presence.leave.length ||
			this.#tracked !== undefined ||
			this.#changes.length === 0
		)
			topics.add(this.#name);
		for (const { table } of this.#changes) topics.add(`db:${table}`);
		return topics;
	}

	#joinTopics() {
		for (const topic of this.#wantedTopics()) {
			if (this.#topics.has(topic)) continue;
			this.#topics.add(topic);
			if (this.#state === "joined") this.#state = "joining";
			const config =
				topic === this.#name && this.#presenceKey && !topic.startsWith("db:")
					? { presence: { key: this.#presenceKey } }
					: undefined;
			this.#hub.join(topic, this, config);
		}
	}

	#status(status, error) {
		for (const listener of this.#statusListeners) notify(listener, status, error);
	}

	#settle(error) {
		const waiters = this.#waiters;
		this.#waiters = [];
		for (const waiter of waiters) {
			if (error) waiter.reject(error);
			else waiter.resolve();
		}
	}

	[JOINED](topic) {
		if (!this.#topics.has(topic)) return;
		this.#joined.add(topic);
		if (topic === this.#name && this.#tracked !== undefined)
			this.#hub.send({ type: "presence", channel: this.#name, state: this.#tracked });
		if ([...this.#topics].every((name) => this.#joined.has(name))) {
			this.#state = "joined";
			this.#settle();
			this.#status("SUBSCRIBED");
		}
	}

	[FAILED](topic, error, fatal = true) {
		if (!this.#topics.has(topic)) return;
		if (fatal) {
			this.#joined.delete(topic);
			this.#state = "errored";
			this.#settle(error);
		}
		this.#status("CHANNEL_ERROR", error);
	}

	[DISCONNECTED](topic) {
		if (!this.#topics.has(topic)) return;
		const wasJoined = this.#state === "joined";
		this.#joined.delete(topic);
		this.#state = "joining";
		if (wasJoined) this.#status("RECONNECTING");
	}

	[DELIVER](topic, message) {
		if (message.type === "change") {
			for (const listener of this.#changes)
				if (
					`db:${listener.table}` === topic &&
					(listener.event === "*" || listener.event === message.event)
				)
					notify(listener.callback, {
						table: message.table,
						event: message.event,
						record: message.record ?? null,
						old_record: message.old_record ?? null,
						commit_timestamp: message.commit_timestamp,
					});
			return;
		}
		if (topic !== this.#name) return;
		if (message.type === "broadcast") {
			for (const listener of this.#broadcast)
				if (listener.event === "*" || listener.event === message.event)
					notify(listener.callback, { event: message.event, payload: message.payload ?? null });
		} else if (message.type === "presence_state") {
			this.#presenceState = {};
			for (const [key, states] of Object.entries(message.presences ?? {}))
				if (Array.isArray(states) && states.length) this.#presenceState[key] = [...states];
			this.#emitSync();
		} else if (message.type === "presence_diff") {
			for (const [key, states] of Object.entries(message.leaves ?? {})) {
				const current = [...(this.#presenceState[key] ?? [])];
				for (const left of Array.isArray(states) ? states : []) {
					const index = current.findIndex((state) => sameState(state, left));
					if (index >= 0) current.splice(index, 1);
				}
				if (current.length) this.#presenceState[key] = current;
				else delete this.#presenceState[key];
				for (const callback of this.#presence.leave)
					notify(callback, { key, leftPresences: states, currentPresences: [...current] });
			}
			for (const [key, states] of Object.entries(message.joins ?? {})) {
				const current = [
					...(this.#presenceState[key] ?? []),
					...(Array.isArray(states) ? states : []),
				];
				this.#presenceState[key] = current;
				for (const callback of this.#presence.join)
					notify(callback, { key, newPresences: states, currentPresences: [...current] });
			}
			this.#emitSync();
		}
	}

	#emitSync() {
		const state = this.presenceState();
		for (const callback of this.#presence.sync) notify(callback, state);
	}
}
