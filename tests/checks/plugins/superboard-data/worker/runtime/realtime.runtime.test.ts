import { beforeAll, describe, expect, it } from "vitest";

import { createKey, ensureTable, jsonOf, operator, publicRequest, sdk, service } from "./helpers";

type Message = Record<string, unknown> & { type: string };

class Client {
	private readonly messages: Message[] = [];
	private readonly waiters: {
		predicate: (message: Message) => boolean;
		resolve: (message: Message) => void;
	}[] = [];

	constructor(readonly socket: WebSocket) {
		socket.accept();
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as Message;
			const waiter = this.waiters.find((candidate) => candidate.predicate(message));
			if (waiter) {
				this.waiters.splice(this.waiters.indexOf(waiter), 1);
				waiter.resolve(message);
			} else this.messages.push(message);
		});
	}

	send(message: Record<string, unknown>) {
		this.socket.send(JSON.stringify(message));
	}

	next(predicate: (message: Message) => boolean, timeout = 2_000): Promise<Message> {
		const index = this.messages.findIndex(predicate);
		if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("realtime message timeout")), timeout);
			this.waiters.push({
				predicate,
				resolve: (message) => {
					clearTimeout(timer);
					resolve(message);
				},
			});
		});
	}

	received(predicate: (message: Message) => boolean): boolean {
		return this.messages.some(predicate);
	}

	async join(channel: string, config?: Record<string, unknown>): Promise<Message> {
		this.send({ type: "join", channel, ref: channel, ...(config ? { config } : {}) });
		return this.next(
			(message) =>
				message.ref === channel && (message.type === "joined" || message.type === "error"),
		);
	}
}

async function connect(user?: string): Promise<Client> {
	const ticket = await sdk("/v1/realtime/tickets", { method: "POST", ...(user ? { user } : {}) });
	expect(ticket.status).toBe(201);
	const { url } = await jsonOf<{ url: string }>(ticket);
	expect(url.startsWith("wss://sdk.example.test/v1/data/realtime/connect?ticket=")).toBe(true);
	const path = new URL(url.replace(/^wss:/u, "https:"));
	const response = await publicRequest(`/v1/realtime/connect${path.search}`, {
		headers: { upgrade: "websocket" },
	});
	expect(response.status).toBe(101);
	if (!response.webSocket) throw new Error("The realtime endpoint did not open a WebSocket");
	return new Client(response.webSocket);
}

const pause = (milliseconds: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});

describe("Realtime", () => {
	beforeAll(async () => {
		await ensureTable({
			name: "messages",
			realtime: true,
			columns: [{ name: "text", type: "text", nullable: false }],
		});
	});

	it("streams row changes only to subscribers allowed to read them", async () => {
		const alice = await connect("alice");
		const bob = await connect("bob");
		expect(await alice.join("db:messages")).toMatchObject({ type: "joined" });
		expect(await bob.join("db:messages")).toMatchObject({ type: "joined" });

		const created = await jsonOf<{ id: string }>(
			await sdk("/v1/db/messages", { method: "POST", user: "alice", body: { text: "hello" } }),
		);
		const change = await alice.next((message) => message.type === "change");
		expect(change).toMatchObject({
			channel: "db:messages",
			table: "messages",
			event: "INSERT",
			record: { id: created.id, text: "hello", owner_id: "alice" },
		});
		await sdk(`/v1/db/messages/${created.id}`, { method: "DELETE", user: "alice" });
		expect(await alice.next((message) => message.type === "change")).toMatchObject({
			event: "DELETE",
			old_record: { id: created.id },
		});
		await pause(100);
		expect(bob.received((message) => message.type === "change")).toBe(false);
	});

	it("refuses table channels whose realtime is off", async () => {
		await ensureTable({ name: "quiet", columns: [{ name: "text", type: "text" }] });
		const client = await connect("alice");
		expect(await client.join("db:quiet")).toMatchObject({
			type: "error",
			code: "channel_unavailable",
		});
		expect(await client.join("db:missing")).toMatchObject({
			type: "error",
			code: "channel_unavailable",
		});
	});

	it("broadcasts messages and shares presence on a channel", async () => {
		const alice = await connect("alice");
		const bob = await connect("bob");
		await alice.join("room:1", { presence: { key: "alice" } });
		await bob.join("room:1", { presence: { key: "bob" } });

		alice.send({ type: "presence", channel: "room:1", state: { status: "online" } });
		expect(await bob.next((message) => message.type === "presence_diff")).toMatchObject({
			joins: { alice: [{ status: "online" }] },
		});
		const late = await connect("carol");
		await late.join("room:1");
		expect(await late.next((message) => message.type === "presence_state")).toMatchObject({
			presences: { alice: [{ status: "online" }] },
		});

		alice.send({ type: "broadcast", channel: "room:1", event: "typing", payload: { at: 1 } });
		expect(await bob.next((message) => message.type === "broadcast")).toMatchObject({
			event: "typing",
			payload: { at: 1 },
		});
		await pause(100);
		expect(alice.received((message) => message.type === "broadcast")).toBe(false);

		alice.socket.close(1000, "done");
		expect(
			await bob.next(
				(message) =>
					message.type === "presence_diff" && Object.keys(message.leaves as object).length > 0,
			),
		).toMatchObject({
			leaves: { alice: [{ status: "online" }] },
		});
	});

	it("lets the server broadcast with a server key", async () => {
		const client = await connect("alice");
		await client.join("news");
		const secret = await createKey("realtime");
		const response = await service("/v1/realtime/broadcast", secret, {
			method: "POST",
			body: { channel: "news", event: "published", payload: { id: 7 } },
		});
		expect(await jsonOf(response)).toEqual({ delivered: 1 });
		expect(await client.next((message) => message.type === "broadcast")).toMatchObject({
			event: "published",
			payload: { id: 7 },
		});
	});

	it("admits anonymous visitors only when the project allows it", async () => {
		const visitor = await connect();
		expect(await visitor.join("lobby")).toMatchObject({
			type: "error",
			code: "authentication_required",
		});
		expect(
			(await operator("database", "/settings", { method: "PATCH", body: { realtime_anonymous: true } })).status,
		).toBe(200);
		await pause(50);
		const allowed = await connect();
		expect(await allowed.join("lobby")).toMatchObject({ type: "joined" });
	});

	it("rejects forged tickets", async () => {
		const response = await publicRequest("/v1/realtime/connect?ticket=abc.def", {
			headers: { upgrade: "websocket" },
		});
		expect(response.status).toBe(401);
	});
});
