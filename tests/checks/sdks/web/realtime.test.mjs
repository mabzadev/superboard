import assert from "node:assert/strict";
import test from "node:test";

import { SuperBoardClient } from "../../../../sdks/web/src/client.js";

const options = {
	apiUrl: "https://sdk.example.test",
	projectKey: "project-key",
	appId: "demo.web",
};

function fakeRealtime({ answerPings = true, refuse = new Set() } = {}) {
	const sockets = [];
	const tickets = [];
	class FakeSocket {
		constructor(url) {
			this.url = url;
			this.sent = [];
			this.closed = false;
			sockets.push(this);
			setTimeout(() => this.onopen?.(), 0);
		}
		send(data) {
			const message = JSON.parse(data);
			this.sent.push(message);
			if (message.type === "join") {
				if (refuse.has(message.channel))
					this.push({
						type: "error",
						code: "channel_forbidden",
						channel: message.channel,
						ref: message.ref,
					});
				else {
					this.push({ type: "joined", channel: message.channel, ref: message.ref });
					if (!message.channel.startsWith("db:"))
						this.push({ type: "presence_state", channel: message.channel, presences: {} });
				}
			}
			if (message.type === "broadcast")
				this.push({ type: "ack", channel: message.channel, ref: message.ref });
			if (message.type === "ping" && answerPings) this.push({ type: "pong", ref: message.ref });
		}
		push(message) {
			setTimeout(() => {
				if (!this.closed) this.onmessage?.({ data: JSON.stringify(message) });
			}, 0);
		}
		close() {
			if (this.closed) return;
			this.closed = true;
			setTimeout(() => this.onclose?.({ code: 1000 }), 0);
		}
		drop() {
			this.closed = true;
			this.onclose?.({ code: 1006 });
		}
	}
	const fetch = async (url, init) => {
		const headers = new Headers(init.headers);
		tickets.push({ url: new URL(url), authorization: headers.get("Authorization") });
		if (new URL(url).pathname === "/v1/auth/superboard-token")
			return Response.json({ access_token: "app-token", expires_in: 300 });
		return Response.json(
			{
				ticket: `t${tickets.length}`,
				url: `wss://sdk.example.test/v1/data/realtime/connect?ticket=t${tickets.length}`,
				expires_at: new Date(Date.now() + 60_000).toISOString(),
			},
			{ status: 201 },
		);
	};
	return { sockets, tickets, fetch, WebSocket: FakeSocket };
}

async function until(predicate, label = "condition") {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > 2_000) throw new Error(`Timed out waiting for ${label}`);
		await new Promise((resolve) => {
			setTimeout(resolve, 2);
		});
	}
}

function realtimeClient(fake, extra = {}) {
	return new SuperBoardClient({
		...options,
		fetch: fake.fetch,
		WebSocket: fake.WebSocket,
		realtime: { reconnectDelayMs: () => 0, heartbeatIntervalMs: 60_000, ...extra },
	});
}

const sentOfType = (socket, type) => socket.sent.filter((message) => message.type === type);

await test("channels share one socket and receive broadcasts, presence and table changes", async () => {
	const fake = fakeRealtime();
	const client = realtimeClient(fake);
	const received = { broadcast: [], changes: [], joins: [], leaves: [], sync: [] };
	const room = client
		.channel("room:1", { presence: { key: "alice" } })
		.on("broadcast", "cursor", (message) => received.broadcast.push(message))
		.on("presence", "join", (diff) => received.joins.push(diff))
		.on("presence", "leave", (diff) => received.leaves.push(diff))
		.on("presence", "sync", (state) => received.sync.push(state));
	const feed = client
		.channel("feed")
		.on("change", { table: "todos", event: "INSERT" }, (change) => received.changes.push(change));

	await Promise.all([room.subscribe(), feed.subscribe()]);
	assert.equal(fake.sockets.length, 1);
	assert.equal(fake.tickets.length, 1);
	assert.equal(fake.tickets[0].url.pathname, "/v1/data/realtime/tickets");
	assert.equal(fake.tickets[0].authorization, null);
	const socket = fake.sockets[0];
	assert.equal(socket.url, "wss://sdk.example.test/v1/data/realtime/connect?ticket=t1");
	assert.deepEqual(
		sentOfType(socket, "join").map(({ channel, config }) => ({ channel, config })),
		[
			{ channel: "room:1", config: { presence: { key: "alice" } } },
			{ channel: "db:todos", config: undefined },
		],
	);

	await room.send("cursor", { x: 1 });
	assert.deepEqual(sentOfType(socket, "broadcast")[0], {
		type: "broadcast",
		channel: "room:1",
		event: "cursor",
		payload: { x: 1 },
		ref: sentOfType(socket, "broadcast")[0].ref,
	});
	await room.track({ status: "online" });
	assert.deepEqual(sentOfType(socket, "presence"), [
		{ type: "presence", channel: "room:1", state: { status: "online" } },
	]);

	socket.push({ type: "broadcast", channel: "room:1", event: "cursor", payload: { x: 2 } });
	socket.push({ type: "broadcast", channel: "room:1", event: "other", payload: null });
	socket.push({
		type: "presence_diff",
		channel: "room:1",
		joins: { bob: [{ status: "online" }] },
		leaves: {},
	});
	socket.push({
		type: "presence_diff",
		channel: "room:1",
		joins: { bob: [{ status: "away" }] },
		leaves: { bob: [{ status: "online" }] },
	});
	for (const event of ["INSERT", "UPDATE"])
		socket.push({
			type: "change",
			channel: "db:todos",
			table: "todos",
			event,
			record: { id: "1" },
			old_record: null,
			commit_timestamp: "2026-11-07T10:00:00.000Z",
		});
	await until(() => received.changes.length === 1 && received.sync.length >= 3, "deliveries");

	assert.deepEqual(received.broadcast, [{ event: "cursor", payload: { x: 2 } }]);
	assert.deepEqual(received.changes, [
		{
			table: "todos",
			event: "INSERT",
			record: { id: "1" },
			old_record: null,
			commit_timestamp: "2026-11-07T10:00:00.000Z",
		},
	]);
	assert.deepEqual(
		received.joins.map(({ key, newPresences }) => [key, newPresences]),
		[
			["bob", [{ status: "online" }]],
			["bob", [{ status: "away" }]],
		],
	);
	assert.deepEqual(
		received.leaves.map(({ key, currentPresences }) => [key, currentPresences]),
		[["bob", []]],
	);
	assert.deepEqual(room.presenceState(), { bob: [{ status: "away" }] });

	await feed.unsubscribe();
	assert.deepEqual(
		sentOfType(socket, "leave").map(({ channel }) => channel),
		["db:todos"],
	);
	assert.equal(socket.closed, false);
	await room.unsubscribe();
	assert.equal(socket.closed, true);
	assert.equal(client.realtime.state, "closed");
	await assert.rejects(room.send("cursor", {}), { code: "channel_not_joined" });
});

await test("a dropped connection gets a new ticket and joins and tracks again", async () => {
	const fake = fakeRealtime();
	const client = realtimeClient(fake);
	const statuses = [];
	const room = client.channel("room:2").on("broadcast", "*", () => {});
	await room.subscribe((status) => statuses.push(status));
	await room.track({ status: "online" });

	fake.sockets[0].drop();
	await until(() => fake.sockets.length === 2 && room.state === "joined", "rejoin");
	await until(() => sentOfType(fake.sockets[1], "presence").length === 1, "presence replay");

	assert.equal(fake.tickets.length, 2);
	assert.equal(fake.sockets[1].url, "wss://sdk.example.test/v1/data/realtime/connect?ticket=t2");
	assert.deepEqual(
		sentOfType(fake.sockets[1], "join").map(({ channel }) => channel),
		["room:2"],
	);
	assert.deepEqual(sentOfType(fake.sockets[1], "presence")[0].state, { status: "online" });
	assert.deepEqual(statuses, ["SUBSCRIBED", "RECONNECTING", "SUBSCRIBED"]);
	client.realtime.disconnect();
});

await test("an unanswered heartbeat closes the socket and reconnects", async () => {
	const fake = fakeRealtime({ answerPings: false });
	const client = realtimeClient(fake, { heartbeatIntervalMs: 15 });
	const room = client.channel("room:3");
	await room.subscribe();
	await until(() => fake.sockets.length === 2, "heartbeat reconnection");
	assert.equal(fake.sockets[0].closed, true);
	assert.equal(sentOfType(fake.sockets[0], "ping").length, 1);
	client.realtime.disconnect();

	const healthy = fakeRealtime();
	const steady = realtimeClient(healthy, { heartbeatIntervalMs: 10 });
	await steady.channel("room:4").subscribe();
	await until(() => sentOfType(healthy.sockets[0], "ping").length >= 3, "pings");
	assert.equal(healthy.sockets.length, 1);
	steady.realtime.disconnect();
});

await test("a refused join rejects the subscription without closing other channels", async () => {
	const fake = fakeRealtime({ refuse: new Set(["db:secret"]) });
	const client = realtimeClient(fake);
	const statuses = [];
	const open = client.channel("lobby").subscribe();
	const refused = client
		.channel("secret")
		.on("change", { table: "secret" }, () => {})
		.subscribe((status, error) => statuses.push([status, error?.code]));
	await assert.rejects(refused, { code: "channel_forbidden" });
	await open;
	assert.deepEqual(statuses, [["CHANNEL_ERROR", "channel_forbidden"]]);
	assert.equal(fake.sockets.length, 1);
	client.realtime.disconnect();
});

await test("signing in reconnects with a ticket for the new identity", async () => {
	const fake = fakeRealtime();
	const client = realtimeClient(fake);
	const room = client.channel("room:5");
	await room.subscribe();
	client.setSession({ access_token: "identity", refresh_token: "refresh", user_id: "alice" });
	await until(() => fake.sockets.length === 2 && room.state === "joined", "identity reconnection");
	const tickets = fake.tickets.filter(
		(ticket) => ticket.url.pathname === "/v1/data/realtime/tickets",
	);
	assert.deepEqual(
		tickets.map((ticket) => ticket.authorization),
		[null, "Bearer app-token"],
	);
	assert.equal(fake.sockets[0].closed, true);
	client.realtime.disconnect();
});
