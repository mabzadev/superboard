import { readJsonLimited } from "@superboard/contracts/request-body";
import { registerRouter } from "@superboard/contracts/route-registry";
import { Hono } from "hono";

import { resolveCaller, resolveServiceCaller, type Role } from "../platform/caller.js";
import type { DataEnv } from "../platform/env.js";
import { DataError, isRecord, json, readJsonObject } from "../platform/http.js";
import { publicOrigin, signToken, verifyToken } from "../platform/signing.js";
import { IDENTITY_HEADER, type RealtimeIdentity } from "../realtime/hub.js";
import { realtimeStub } from "../realtime/publish.js";
import { DATA_PLUGIN_ID, action, deferralOf } from "./context.js";

export const realtimeRoutes = registerRouter(new Hono<{ Bindings: DataEnv }>(), {
	service: "files",
	module: "realtime",
	pluginId: DATA_PLUGIN_ID,
	surface: "internal",
	access: "sdk-key",
});

const TICKET_SECONDS = 60;
const TICKET_PURPOSE = "superboard-data-realtime-v1";

interface Ticket {
	p: number;
	r: Role;
	u: string | null;
	s: number;
	e: number;
}

const MAXIMUM_SESSION_SECONDS = 3_600;

function isTicket(value: unknown): value is Ticket {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.p) &&
		(value.r === "anon" || value.r === "authenticated" || value.r === "service") &&
		(value.u === null || typeof value.u === "string") &&
		Number.isSafeInteger(value.s) &&
		Number.isSafeInteger(value.e)
	);
}

realtimeRoutes.defineRoute({ id: "data:realtime:ticket" }).post(
	"/v1/realtime/tickets",
	action("realtime-ticket", async (c) => {
		const caller = await resolveCaller(c.req.raw, c.env, deferralOf(c));
		if (!c.env.REALTIME) throw unavailable();
		const now = Math.floor(Date.now() / 1000);
		const expires = now + TICKET_SECONDS;
		const ticket = await signToken(c.env, TICKET_PURPOSE, {
			p: caller.projectId,
			r: caller.role,
			u: caller.userId,
			s: Math.min(
				caller.sessionExpiresAt ?? Number.MAX_SAFE_INTEGER,
				now + MAXIMUM_SESSION_SECONDS,
			),
			e: expires,
		} satisfies Ticket);
		const origin = publicOrigin(c.env).replace(/^http/u, "ws");
		return json(
			{
				ticket,
				url: `${origin}/realtime/connect?ticket=${encodeURIComponent(ticket)}`,
				expires_at: new Date(expires * 1000).toISOString(),
			},
			201,
		);
	}),
);

realtimeRoutes
	.defineRoute({ id: "data:realtime:connect", access: "public", transport: "websocket" })
	.get(
		"/v1/realtime/connect",
		action("realtime-connect", async (c) => {
			if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
				throw new DataError(426, "websocket_required", "Open this URL as a WebSocket");
			const ticket = await verifyToken(
				c.env,
				TICKET_PURPOSE,
				c.req.query("ticket") ?? "",
				TICKET_SECONDS,
				isTicket,
			);
			if (!ticket)
				throw new DataError(401, "ticket_invalid", "Realtime ticket is invalid or expired");
			const stub = realtimeStub(c.env, ticket.p);
			if (!stub) throw unavailable();
			const identity: RealtimeIdentity = {
				projectId: ticket.p,
				role: ticket.r,
				userId: ticket.u,
				expiresAt: ticket.s * 1000,
			};
			return stub.fetch("https://realtime.internal/connect", {
				headers: { upgrade: "websocket", [IDENTITY_HEADER]: JSON.stringify(identity) },
			});
		}),
	);

realtimeRoutes.defineRoute({ id: "data:realtime:broadcast" }).post(
	"/v1/realtime/broadcast",
	action("realtime-broadcast", async (c) => {
		const caller = await resolveServiceCaller(c.req.raw, c.env, deferralOf(c));
		const body = await readJsonObject(c.req.raw, 65_536);
		if (
			typeof body.channel !== "string" ||
			!/^[A-Za-z0-9:_.-]{1,64}$/u.test(body.channel) ||
			body.channel.startsWith("db:") ||
			typeof body.event !== "string" ||
			!/^[A-Za-z0-9:_.-]{1,64}$/u.test(body.event)
		)
			throw new DataError(422, "broadcast_invalid", "channel and event are required");
		const stub = realtimeStub(c.env, caller.projectId);
		if (!stub) throw unavailable();
		const response = await stub.fetch("https://realtime.internal/broadcast", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				channel: body.channel,
				event: body.event,
				payload: body.payload ?? null,
			}),
		});
		return json(await readJsonLimited(response, 4_096));
	}),
);

function unavailable() {
	return new DataError(
		503,
		"realtime_unavailable",
		"Realtime is not configured for this environment",
	);
}
