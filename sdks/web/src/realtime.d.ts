export type ChannelStatus = "SUBSCRIBED" | "RECONNECTING" | "CHANNEL_ERROR" | "CLOSED";
export type ChangeEvent = "INSERT" | "UPDATE" | "DELETE";
export type PresenceState<T = Record<string, unknown>> = Record<string, T[]>;

export interface RealtimeOptions {
	/** WebSocket constructor; defaults to `globalThis.WebSocket`. */
	WebSocket?: new (url: string) => WebSocket;
	heartbeatIntervalMs?: number;
	reconnectDelayMs?: (attempt: number) => number;
}
export interface ChannelOptions {
	presence?: { key?: string };
}
export interface BroadcastMessage<T = unknown> {
	event: string;
	payload: T;
}
export interface ChangeMessage<T = Record<string, unknown>> {
	table: string;
	event: ChangeEvent;
	record: T | null;
	old_record: T | null;
	commit_timestamp: string;
}

export class RealtimeChannel {
	private constructor();
	readonly name: string;
	readonly state: "closed" | "joining" | "joined" | "errored";
	on<T = unknown>(
		type: "broadcast",
		event: string,
		callback: (message: BroadcastMessage<T>) => void,
	): this;
	on<T = Record<string, unknown>>(
		type: "presence",
		event: "sync",
		callback: (state: PresenceState<T>) => void,
	): this;
	on<T = Record<string, unknown>>(
		type: "presence",
		event: "join",
		callback: (diff: { key: string; newPresences: T[]; currentPresences: T[] }) => void,
	): this;
	on<T = Record<string, unknown>>(
		type: "presence",
		event: "leave",
		callback: (diff: { key: string; leftPresences: T[]; currentPresences: T[] }) => void,
	): this;
	on<T = Record<string, unknown>>(
		type: "change",
		filter: { table: string; event?: ChangeEvent | "*" },
		callback: (change: ChangeMessage<T>) => void,
	): this;
	/** Resolves once every topic of the channel is joined. */
	subscribe(callback?: (status: ChannelStatus, error?: Error) => void): Promise<this>;
	unsubscribe(): Promise<void>;
	send(event: string, payload?: unknown, options?: { self?: boolean }): Promise<void>;
	track(state: Record<string, unknown>): Promise<void>;
	untrack(): Promise<void>;
	presenceState<T = Record<string, unknown>>(): PresenceState<T>;
}
export class RealtimeClient {
	private constructor();
	readonly state: "open" | "connecting" | "closed";
	channel(name: string, options?: ChannelOptions): RealtimeChannel;
	/** Opens a new connection with a fresh ticket and joins the channels again. */
	reconnect(): void;
	/** Unsubscribes every channel and closes the connection. */
	disconnect(): void;
}
