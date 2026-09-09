// The legacy rooms retain user-keyed identities, D1 snapshots and hibernating sockets.
class LegacyRoom {
	constructor(state, env, table, view = table) {
		this.state = state;
		this.env = env;
		this.table = table;
		this.view = view;
		this.userId = null;
	}

	async fetch(request) {
		const headerUserId = request.headers.get("x-user-id");
		if (headerUserId) {
			this.userId = headerUserId;
			await this.state.storage.put("userId", headerUserId);
		}
		this.userId ??= await this.state.storage.get("userId");
		if (request.method === "POST" && new URL(request.url).pathname.endsWith("/notify")) {
			const message = await this.snapshot("update");
			const sockets = this.state.getWebSockets();
			for (const socket of sockets) socket.send(message);
			return Response.json({ notified: sockets.length });
		}
		if (request.headers.get("upgrade") !== "websocket") return new Response(null, { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.state.acceptWebSocket(server);
		server.send(await this.snapshot("snapshot"));
		return new Response(null, { status: 101, webSocket: client });
	}

	async snapshot(type) {
		const rows = await this.env.DB.prepare(
			`SELECT * FROM ${this.view} WHERE user_id = ? ORDER BY created_at DESC`,
		)
			.bind(this.userId)
			.all();
		return JSON.stringify({
			type,
			table: this.table,
			data: rows.results,
			count: rows.results.length,
			timestamp: new Date().toISOString(),
		});
	}

	webSocketMessage() {}
	webSocketClose(socket, code) {
		socket.close(code);
	}
	webSocketError() {}
}

export class UserVocalsRoom extends LegacyRoom {
	constructor(state, env) {
		super(state, env, "users_vocals");
	}
}

export class UserMediasRoom extends LegacyRoom {
	constructor(state, env) {
		super(state, env, "users_medias", "v_users_medias");
	}
}

export default {
	async fetch(request, env) {
		if (new URL(request.url).pathname !== "/notify") return new Response(null, { status: 404 });
		const body = await request.json();
		if (body.notification_type === "runtime_failure") return new Response(null, { status: 503 });
		await env.DB.prepare("INSERT INTO runtime_notification_deliveries (body) VALUES (?)")
			.bind(JSON.stringify(body))
			.run();
		return Response.json({ ok: true });
	},
};
