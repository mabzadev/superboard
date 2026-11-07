import type { RowChange } from "../database/records.js";
import { getTable, type TableDefinition } from "../database/schema.js";
import type { Caller, Role } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { isRecord } from "../platform/http.js";
import { allows, type AccessRule } from "../platform/policy.js";
import { getProjectSettings, type ProjectSettings } from "../settings.js";

export interface RealtimeIdentity {
	projectId: number;
	role: Role;
	userId: string | null;
	expiresAt: number;
}

interface Attachment extends RealtimeIdentity {
	id: string;
}

export interface PublishedChanges {
	table: string;
	rule: AccessRule;
	changes: RowChange[];
}

export const IDENTITY_HEADER = "x-realtime-identity";
const CHANNEL_PATTERN = /^[A-Za-z0-9:_.-]{1,64}$/u;
const MAXIMUM_CHANNELS_PER_SOCKET = 20;
const MAXIMUM_MESSAGE_BYTES = 65_536;
const MAXIMUM_PRESENCE_BYTES = 4_096;
const MAXIMUM_CONNECTIONS = 10_000;
const CACHE_MILLISECONDS = 10_000;

export class RealtimeHub {
	private readonly sql: SqlStorage;
	private readonly tables = new Map<string, { table: TableDefinition | null; expires: number }>();
	private settings: { value: ProjectSettings; expires: number } | null = null;
	private readonly closing = new Set<string>();

	constructor(
		private readonly ctx: DurableObjectState,
		private readonly env: DataEnv,
	) {
		this.sql = ctx.storage.sql;
		this.sql.exec(
			`CREATE TABLE IF NOT EXISTS subscriptions (
				socket_id TEXT NOT NULL,
				channel TEXT NOT NULL,
				presence_key TEXT NOT NULL,
				presence_state TEXT,
				PRIMARY KEY (socket_id, channel)
			)`,
		);
		this.sql.exec("CREATE INDEX IF NOT EXISTS subscriptions_channel ON subscriptions(channel)");
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/connect") return this.connect(request);
		if (url.pathname === "/publish" && request.method === "POST")
			return this.publish((await request.json()) as PublishedChanges);
		if (url.pathname === "/broadcast" && request.method === "POST") {
			const body = (await request.json()) as { channel: string; event: string; payload: unknown };
			const delivered = this.deliver(body.channel, {
				type: "broadcast",
				channel: body.channel,
				event: body.event,
				payload: body.payload,
			});
			return Response.json({ delivered });
		}
		if (url.pathname === "/stats") return Response.json(this.stats());
		if (url.pathname === "/invalidate" && request.method === "POST") {
			this.tables.clear();
			this.settings = null;
			const body = (await request.json()) as { projectId?: unknown };
			if (Number.isSafeInteger(body.projectId)) {
				const settings = await this.projectSettings(Number(body.projectId));
				if (!settings.realtime_anonymous)
					for (const [socket, attachment] of this.liveSockets().values())
						if (attachment.role === "anon") this.close(socket, 4003, "anonymous_disabled");
			}
			return new Response(null, { status: 204 });
		}
		return new Response(null, { status: 404 });
	}

	webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		return this.handleMessage(socket, message);
	}

	webSocketClose(socket: WebSocket): void {
		this.disconnect(socket);
	}

	webSocketError(socket: WebSocket): void {
		this.disconnect(socket);
	}

	private connect(request: Request): Response {
		if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
			return Response.json({ error: { code: "websocket_required" } }, { status: 426 });
		const identity = parseIdentity(request.headers.get(IDENTITY_HEADER));
		if (!identity) return Response.json({ error: { code: "identity_invalid" } }, { status: 400 });
		if (this.ctx.getWebSockets().length >= MAXIMUM_CONNECTIONS)
			return Response.json({ error: { code: "realtime_capacity" } }, { status: 503 });
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ id: crypto.randomUUID(), ...identity } satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	private async handleMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		const attachment = socket.deserializeAttachment() as Attachment;
		if (attachment.expiresAt <= Date.now()) return this.close(socket, 4001, "session_expired");
		const text = typeof message === "string" ? message : new TextDecoder().decode(message);
		if (text.length > MAXIMUM_MESSAGE_BYTES) return send(socket, errorMessage("message_too_large"));
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return send(socket, errorMessage("message_invalid"));
		}
		if (!isRecord(parsed) || typeof parsed.type !== "string")
			return send(socket, errorMessage("message_invalid"));
		const ref = typeof parsed.ref === "string" ? parsed.ref : undefined;
		if (parsed.type === "ping") return send(socket, { type: "pong", ref });
		const channel = typeof parsed.channel === "string" ? parsed.channel : "";
		if (!CHANNEL_PATTERN.test(channel))
			return send(socket, errorMessage("channel_invalid", channel, ref));
		switch (parsed.type) {
			case "join":
				return this.join(socket, attachment, channel, parsed, ref);
			case "leave":
				this.leave(attachment.id, channel);
				return send(socket, { type: "left", channel, ref });
			case "broadcast":
				return this.broadcast(socket, attachment, channel, parsed, ref);
			case "presence":
				return this.track(socket, attachment, channel, parsed.state, ref);
			case "presence_untrack":
				return this.track(socket, attachment, channel, null, ref);
			default:
				return send(socket, errorMessage("message_type_invalid", channel, ref));
		}
	}

	private async join(
		socket: WebSocket,
		attachment: Attachment,
		channel: string,
		message: Record<string, unknown>,
		ref: string | undefined,
	): Promise<void> {
		const denied = await this.authorize(attachment, channel);
		if (denied) return send(socket, errorMessage(denied, channel, ref));
		const joined = this.sql
			.exec<{ total: number }>(
				"SELECT COUNT(*) AS total FROM subscriptions WHERE socket_id = ?",
				attachment.id,
			)
			.one().total;
		if (joined >= MAXIMUM_CHANNELS_PER_SOCKET)
			return send(socket, errorMessage("channel_limit", channel, ref));
		const config = isRecord(message.config) ? message.config : {};
		const presence = isRecord(config.presence) ? config.presence : {};
		const key =
			typeof presence.key === "string" && /^[A-Za-z0-9:_.@-]{1,64}$/u.test(presence.key)
				? presence.key
				: attachment.id;
		this.sql.exec(
			`INSERT INTO subscriptions (socket_id, channel, presence_key, presence_state) VALUES (?, ?, ?, NULL)
			 ON CONFLICT(socket_id, channel) DO UPDATE SET presence_key = excluded.presence_key`,
			attachment.id,
			channel,
			key,
		);
		send(socket, { type: "joined", channel, ref });
		if (!channel.startsWith("db:"))
			send(socket, { type: "presence_state", channel, presences: this.presences(channel) });
	}

	private broadcast(
		socket: WebSocket,
		attachment: Attachment,
		channel: string,
		message: Record<string, unknown>,
		ref: string | undefined,
	): void {
		if (channel.startsWith("db:"))
			return send(socket, errorMessage("channel_read_only", channel, ref));
		if (!this.subscribed(attachment.id, channel))
			return send(socket, errorMessage("channel_not_joined", channel, ref));
		if (typeof message.event !== "string" || !/^[A-Za-z0-9:_.-]{1,64}$/u.test(message.event))
			return send(socket, errorMessage("event_invalid", channel, ref));
		this.deliver(
			channel,
			{ type: "broadcast", channel, event: message.event, payload: message.payload ?? null },
			message.self === true ? undefined : attachment.id,
		);
		if (ref) send(socket, { type: "ack", channel, ref });
	}

	private track(
		socket: WebSocket,
		attachment: Attachment,
		channel: string,
		state: unknown,
		ref: string | undefined,
	): void {
		if (channel.startsWith("db:"))
			return send(socket, errorMessage("channel_read_only", channel, ref));
		const row = this.sql
			.exec<{ presence_key: string; presence_state: string | null }>(
				"SELECT presence_key, presence_state FROM subscriptions WHERE socket_id = ? AND channel = ?",
				attachment.id,
				channel,
			)
			.toArray()[0];
		if (!row) return send(socket, errorMessage("channel_not_joined", channel, ref));
		const serialized = state === null ? null : JSON.stringify(state ?? {});
		if (serialized && serialized.length > MAXIMUM_PRESENCE_BYTES)
			return send(socket, errorMessage("presence_too_large", channel, ref));
		this.sql.exec(
			"UPDATE subscriptions SET presence_state = ? WHERE socket_id = ? AND channel = ?",
			serialized,
			attachment.id,
			channel,
		);
		const leaves = row.presence_state
			? { [row.presence_key]: [JSON.parse(row.presence_state) as unknown] }
			: {};
		const joins = serialized ? { [row.presence_key]: [JSON.parse(serialized) as unknown] } : {};
		this.deliver(channel, { type: "presence_diff", channel, joins, leaves });
	}

	private leave(socketId: string, channel: string): void {
		const row = this.sql
			.exec<{ presence_key: string; presence_state: string | null }>(
				"SELECT presence_key, presence_state FROM subscriptions WHERE socket_id = ? AND channel = ?",
				socketId,
				channel,
			)
			.toArray()[0];
		this.sql.exec(
			"DELETE FROM subscriptions WHERE socket_id = ? AND channel = ?",
			socketId,
			channel,
		);
		if (row?.presence_state)
			this.deliver(channel, {
				type: "presence_diff",
				channel,
				joins: {},
				leaves: { [row.presence_key]: [JSON.parse(row.presence_state) as unknown] },
			});
	}

	private disconnect(socket: WebSocket): void {
		const attachment = socket.deserializeAttachment() as Attachment | null;
		if (!attachment) return;
		const channels = this.sql
			.exec<{ channel: string }>(
				"SELECT channel FROM subscriptions WHERE socket_id = ?",
				attachment.id,
			)
			.toArray();
		for (const { channel } of channels) this.leave(attachment.id, channel);
	}

	private async publish(body: PublishedChanges): Promise<Response> {
		const channel = `db:${body.table}`;
		const sockets = this.members(channel);
		let delivered = 0;
		for (const [socket, attachment] of sockets) {
			for (const change of body.changes) {
				if (!changeVisible(body.rule, attachment, change)) continue;
				send(socket, {
					type: "change",
					channel,
					table: body.table,
					event: change.event,
					record: change.record,
					old_record: change.old_record,
					commit_timestamp: new Date().toISOString(),
				});
				delivered += 1;
			}
		}
		return Response.json({ delivered });
	}

	private deliver(channel: string, message: unknown, exceptSocketId?: string): number {
		let delivered = 0;
		for (const [socket, attachment] of this.members(channel)) {
			if (attachment.id === exceptSocketId) continue;
			send(socket, message);
			delivered += 1;
		}
		return delivered;
	}

	private liveSockets(): Map<string, [WebSocket, Attachment]> {
		const live = new Map<string, [WebSocket, Attachment]>();
		const now = Date.now();
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as Attachment | null;
			if (!attachment || this.closing.has(attachment.id)) continue;
			if (attachment.expiresAt <= now) this.close(socket, 4001, "session_expired");
			else live.set(attachment.id, [socket, attachment]);
		}
		return live;
	}

	private close(socket: WebSocket, code: number, reason: string): void {
		const attachment = socket.deserializeAttachment() as Attachment | null;
		if (!attachment || this.closing.has(attachment.id)) return;
		this.closing.add(attachment.id);
		try {
			this.disconnect(socket);
			socket.close(code, reason);
		} catch {
			// The socket is already closing.
		} finally {
			this.closing.delete(attachment.id);
		}
	}

	private members(channel: string): [WebSocket, Attachment][] {
		const live = this.liveSockets();
		const members: [WebSocket, Attachment][] = [];
		for (const { socket_id } of this.sql
			.exec<{ socket_id: string }>("SELECT socket_id FROM subscriptions WHERE channel = ?", channel)
			.toArray()) {
			const entry = live.get(socket_id);
			if (entry) members.push(entry);
			else this.sql.exec("DELETE FROM subscriptions WHERE socket_id = ?", socket_id);
		}
		return members;
	}

	private presences(channel: string): Record<string, unknown[]> {
		const live = this.liveSockets();
		const presences: Record<string, unknown[]> = {};
		for (const row of this.sql
			.exec<{ socket_id: string; presence_key: string; presence_state: string }>(
				"SELECT socket_id, presence_key, presence_state FROM subscriptions WHERE channel = ? AND presence_state IS NOT NULL",
				channel,
			)
			.toArray()) {
			if (!live.has(row.socket_id)) {
				this.sql.exec("DELETE FROM subscriptions WHERE socket_id = ?", row.socket_id);
				continue;
			}
			(presences[row.presence_key] ??= []).push(JSON.parse(row.presence_state) as unknown);
		}
		return presences;
	}

	private subscribed(socketId: string, channel: string): boolean {
		return (
			this.sql
				.exec("SELECT 1 FROM subscriptions WHERE socket_id = ? AND channel = ?", socketId, channel)
				.toArray().length > 0
		);
	}

	private async authorize(identity: Attachment, channel: string): Promise<string | null> {
		const caller: Caller = { ...identity, keyId: null, operatorId: null };
		if (channel.startsWith("db:")) {
			const name = channel.slice(3);
			if (!/^[a-z][a-z0-9_]{0,47}$/u.test(name)) return "channel_invalid";
			const table = await this.table(identity.projectId, name);
			if (!table?.realtime) return "channel_unavailable";
			return allows(table.rules.read, caller) ? null : "access_denied";
		}
		if (identity.role !== "anon") return null;
		return (await this.projectSettings(identity.projectId)).realtime_anonymous
			? null
			: "authentication_required";
	}

	private async table(projectId: number, name: string): Promise<TableDefinition | null> {
		const cached = this.tables.get(name);
		if (cached && cached.expires > Date.now()) return cached.table;
		const table = await getTable(this.env, projectId, name);
		this.tables.set(name, { table, expires: Date.now() + CACHE_MILLISECONDS });
		return table;
	}

	private async projectSettings(projectId: number): Promise<ProjectSettings> {
		if (this.settings && this.settings.expires > Date.now()) return this.settings.value;
		const value = await getProjectSettings(this.env, projectId);
		this.settings = { value, expires: Date.now() + CACHE_MILLISECONDS };
		return value;
	}

	private stats(): { connections: number; channels: { channel: string; members: number }[] } {
		return {
			connections: this.ctx.getWebSockets().length,
			channels: this.sql
				.exec<{ channel: string; members: number }>(
					"SELECT channel, COUNT(*) AS members FROM subscriptions GROUP BY channel ORDER BY members DESC LIMIT 100",
				)
				.toArray(),
		};
	}
}

export function changeVisible(
	rule: AccessRule,
	identity: RealtimeIdentity,
	change: RowChange,
): boolean {
	if (identity.role === "service") return true;
	if (rule === "public") return true;
	if (rule === "service" || identity.role !== "authenticated") return false;
	if (rule === "authenticated") return true;
	const owner = change.record?.owner_id ?? change.old_record?.owner_id ?? null;
	return owner !== null && owner === identity.userId;
}

function parseIdentity(value: string | null): RealtimeIdentity | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value) as unknown;
		if (
			isRecord(parsed) &&
			Number.isSafeInteger(parsed.projectId) &&
			(parsed.role === "anon" || parsed.role === "authenticated" || parsed.role === "service") &&
			(parsed.userId === null || typeof parsed.userId === "string") &&
			Number.isSafeInteger(parsed.expiresAt)
		)
			return {
				projectId: Number(parsed.projectId),
				role: parsed.role,
				userId: parsed.userId,
				expiresAt: Number(parsed.expiresAt),
			};
	} catch {
		return null;
	}
	return null;
}

function send(socket: WebSocket, message: unknown): void {
	try {
		socket.send(JSON.stringify(message));
	} catch {
		// The socket closed between selection and delivery; its close handler removes it.
	}
}

function errorMessage(code: string, channel?: string, ref?: string) {
	return { type: "error", code, ...(channel ? { channel } : {}), ...(ref ? { ref } : {}) };
}
