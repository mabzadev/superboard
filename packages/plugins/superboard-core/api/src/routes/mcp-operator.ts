import { runPluginTask, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import {
	readJsonObjectLimited,
	readBytesLimited,
	RequestBodyError,
} from "@superboard/contracts/request-body";
import type { SiteOperatorIdentity } from "@superboard/contracts/site-operator";
import type { Context } from "hono";
import { z } from "zod";

import { getRequestAuthContext } from "../lib/auth.js";
import { issueMcpToken, tokenDigest, type McpClientRow } from "../lib/mcp-oauth.js";
import type { Env } from "../types.js";

const pluginId = "supbrd-plugmod-mcp";
const privateClientId = "superboard:operator-invocation";
const invocation = z.object({
	tool: z.string().min(1).max(128),
	arguments: z.record(z.string(), z.unknown()).default({}),
	session_id: z.string().uuid().optional(),
});
const toolProviders: Record<string, string> = {
	get_platform_status: "supbrd-plugmod-observability",
	get_usage: "supbrd-plugmod-analytics",
	configure_sdk: "supbrd-plug-settings",
	...Object.fromEntries(
		[
			"create_link",
			"get_link",
			"update_link",
			"archive_link",
			"search_links",
			"get_analytics_overview",
			"get_link_analytics",
			"get_top_links",
			"configure_redirects",
			"create_campaign",
			"list_campaigns",
			"archive_campaign",
		].map((tool) => [tool, "supbrd-plugmod-dynamic-links"]),
	),
};
interface Session {
	session_id: string;
	operator_id: string;
	created_at: string;
	expires_at: string;
}
interface Receipt {
	receipt_id: string;
	session_id: string;
	operator_id: string;
	tool: string;
	request_checksum: string;
	result_checksum: string | null;
	status: "running" | "completed" | "failed";
	error_code: string | null;
	started_at: string;
	completed_at: string | null;
}

export async function mcpOperator(c: Context<{ Bindings: Env }>): Promise<Response> {
	try {
		const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
		if (!auth?.siteOperator) return fail(401, "OPERATOR_REQUIRED");
		const actor = auth.siteOperator;
		const instance = actor.instance_id;
		const url = new URL(c.req.url);
		const path = url.pathname.slice("/api/v1/mcp/operator".length);
		const operationId = c.req.header("Idempotency-Key") ?? "";
		if (c.req.method !== "GET" && (operationId.length < 8 || operationId.length > 200))
			return fail(400, "IDEMPOTENCY_KEY_REQUIRED");
		const admitted = await runPluginTask(
			c.env,
			pluginId,
			{ kind: "runtime", task_id: `mcp:${operationId || crypto.randomUUID()}`, duration_ms: 45000 },
			async () => {
				const cursor = url.searchParams.get("cursor") ?? "";
				if (path === "/sessions" && c.req.method === "GET") {
					const rows = await c.env.DB.prepare(
						"SELECT session_id,operator_id,created_at,expires_at FROM mcp_operator_sessions WHERE instance_id=? AND operator_id=? AND session_id>? ORDER BY session_id LIMIT 51",
					)
						.bind(instance, actor.operator_id, cursor)
						.all<Session>();
					return json({
						items: rows.results
							.slice(0, 50)
							.map((row) => ({
								...row,
								status: Date.parse(row.expires_at) > Date.now() ? "active" : "expired",
							})),
						next_cursor: rows.results.length > 50 ? rows.results[49]!.session_id : null,
					});
				}
				if (path === "/receipts" && c.req.method === "GET") {
					const rows = await c.env.DB.prepare(
						"SELECT receipt_id,session_id,operator_id,tool,request_checksum,result_checksum,status,error_code,started_at,completed_at FROM mcp_operator_invocations WHERE instance_id=? AND operator_id=? AND receipt_id>? ORDER BY receipt_id LIMIT 51",
					)
						.bind(instance, actor.operator_id, cursor)
						.all<Receipt>();
					return json({
						items: rows.results.slice(0, 50),
						next_cursor: rows.results.length > 50 ? rows.results[49]!.receipt_id : null,
					});
				}
				if (path === "/tools" && c.req.method === "GET")
					return json(
						await withEphemeralToken(c.env, actor, (token) => rpc(c.env, token, "tools/list", {})),
					);
				if (path !== "/invocations" || c.req.method !== "POST") return fail(404, "NOT_FOUND");
				const input = invocation.parse(await readJsonObjectLimited(c.req.raw, 65536));
				const checksum = await hash(canonical(input));
				const prior = await receipt(c.env.DB, instance, operationId);
				if (prior)
					return prior.operator_id !== actor.operator_id || prior.request_checksum !== checksum
						? fail(409, "IDEMPOTENCY_CONFLICT")
						: prior.status === "running"
							? fail(409, "MCP_INVOCATION_INDETERMINATE")
							: json({ ...prior, replayed: true, result: null });
				let session: Session | null;
				if (input.session_id) {
					session = await c.env.DB.prepare(
						"SELECT session_id,operator_id,created_at,expires_at FROM mcp_operator_sessions WHERE instance_id=? AND session_id=? AND operator_id=?",
					)
						.bind(instance, input.session_id, actor.operator_id)
						.first<Session>();
					if (!session) return fail(404, "MCP_SESSION_NOT_FOUND");
					if (Date.parse(session.expires_at) <= Date.now()) return fail(409, "MCP_SESSION_EXPIRED");
				} else {
					session = {
						session_id: crypto.randomUUID(),
						operator_id: actor.operator_id,
						created_at: new Date().toISOString(),
						expires_at: new Date(Date.now() + 900000).toISOString(),
					};
					await c.env.DB.prepare(
						"INSERT INTO mcp_operator_sessions(instance_id,session_id,operator_id,created_at,expires_at) VALUES (?,?,?,?,?)",
					)
						.bind(
							instance,
							session.session_id,
							actor.operator_id,
							session.created_at,
							session.expires_at,
						)
						.run();
				}
				const receiptId = crypto.randomUUID();
				const inserted = await c.env.DB.prepare(
					"INSERT OR IGNORE INTO mcp_operator_invocations(instance_id,operation_id,receipt_id,session_id,operator_id,tool,request_checksum,status,started_at) VALUES (?,?,?,?,?,?,?,'running',?)",
				)
					.bind(
						instance,
						operationId,
						receiptId,
						session.session_id,
						actor.operator_id,
						input.tool,
						checksum,
						new Date().toISOString(),
					)
					.run();
				if (!inserted.meta.changes) return fail(409, "MCP_INVOCATION_INDETERMINATE");
				try {
					const work = () =>
						withEphemeralToken(c.env, actor, (token) =>
							rpc(c.env, token, "tools/call", { name: input.tool, arguments: input.arguments }),
						);
					const provider = toolProviders[input.tool];
					const execution = provider
						? await runPluginTask(
								c.env,
								provider,
								{ kind: "runtime", task_id: `mcp-tool:${operationId}`, duration_ms: 40000 },
								work,
							)
						: { ran: true as const, value: await work() };
					if (!execution.ran) throw new PluginTaskUnavailable("MCP_PROVIDER_NOT_ACTIVE", 404);
					const result = execution.value;
					const status = result.isError === true || result.error ? "failed" : "completed";
					await c.env.DB.prepare(
						"UPDATE mcp_operator_invocations SET status=?,result_checksum=?,completed_at=? WHERE instance_id=? AND operation_id=?",
					)
						.bind(
							status,
							await hash(canonical(result)),
							new Date().toISOString(),
							instance,
							operationId,
						)
						.run();
					return json({ session_id: session.session_id, receipt_id: receiptId, status, result });
				} catch (error) {
					await c.env.DB.prepare(
						"UPDATE mcp_operator_invocations SET status='failed',error_code=?,completed_at=? WHERE instance_id=? AND operation_id=?",
					)
						.bind(
							error instanceof PluginTaskUnavailable ? error.code : "MCP_INVOCATION_FAILED",
							new Date().toISOString(),
							instance,
							operationId,
						)
						.run();
					throw error;
				}
			},
		);
		return admitted.ran ? admitted.value : fail(404, "PLUGIN_NOT_ACTIVE");
	} catch (error) {
		if (error instanceof z.ZodError) return fail(422, "MCP_INPUT_INVALID");
		if (error instanceof RequestBodyError) return fail(error.status, "MCP_INPUT_INVALID");
		if (error instanceof PluginTaskUnavailable) return fail(error.status, error.code);
		console.error("[mcp-operator] invocation failed", error);
		return fail(503, "MCP_INVOCATION_UNAVAILABLE");
	}
}

async function withEphemeralToken<T>(
	env: Env,
	actor: SiteOperatorIdentity,
	work: (token: string) => Promise<T>,
): Promise<T> {
	if (!env.MCP_SERVICE) throw new PluginTaskUnavailable("MCP_WORKER_UNAVAILABLE", 503);
	await env.DB.prepare(
		"INSERT OR IGNORE INTO mcp_clients(id,name,client_id,redirect_uris,scopes,confidential) VALUES (?,'EmDash operator invocation',?,'[]','[\"mcp:full\"]',1)",
	)
		.bind(privateClientId, privateClientId)
		.run();
	const client = await env.DB.prepare("SELECT * FROM mcp_clients WHERE id=?")
		.bind(privateClientId)
		.first<McpClientRow>();
	if (!client || client.client_id !== privateClientId || client.redirect_uris !== "[]")
		throw new Error("MCP_PRIVATE_CLIENT_CONFLICT");
	const issued = await issueMcpToken(env.DB, {
		client,
		userId: null,
		siteOperator: actor,
		expiresInSeconds: 60,
	});
	const digest = await tokenDigest(issued.access_token);
	try {
		return await work(issued.access_token);
	} finally {
		await env.DB.prepare("UPDATE mcp_tokens SET revoked_at=datetime('now') WHERE token_digest=?")
			.bind(digest)
			.run();
	}
}

async function rpc(
	env: Env,
	token: string,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const id = crypto.randomUUID();
	if (!env.MCP_DOMAIN || !/^[a-z0-9.-]+$/u.test(env.MCP_DOMAIN))
		throw new Error("MCP_DOMAIN_UNAVAILABLE");
	const url = new URL(`https://${env.MCP_DOMAIN}/mcp`);
	const request = new Request(url, {
		method: "POST",
		headers: {
			Host: url.host,
			Authorization: `Bearer ${token}`,
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
			"MCP-Protocol-Version": "2025-11-25",
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		signal: AbortSignal.timeout(30000),
	});
	const response = await env.MCP_SERVICE!.fetch(request);
	if (!response.ok)
		throw new PluginTaskUnavailable(
			"MCP_PROTOCOL_UNAVAILABLE",
			response.status === 401 || response.status === 403 ? 502 : 503,
		);
	const text = new TextDecoder().decode(await readBytesLimited(response, 1048576));
	const messages: unknown[] = response.headers.get("Content-Type")?.includes("text/event-stream")
		? text.split(/\r?\n\r?\n/u).flatMap((event) => {
				const data = event
					.split(/\r?\n/u)
					.filter((line) => line.startsWith("data:"))
					.map((line) => line.slice(5).trimStart())
					.join("\n");
				return data ? [JSON.parse(data)] : [];
			})
		: [JSON.parse(text)];
	const message = messages.find(
		(value): value is Record<string, unknown> =>
			!!value && typeof value === "object" && "id" in value && value.id === id,
	);
	if (!message) throw new Error("MCP_RESPONSE_ID_MISMATCH");
	if (message.error) return { error: message.error };
	if (!message.result || typeof message.result !== "object" || Array.isArray(message.result))
		throw new Error("MCP_RESULT_INVALID");
	return message.result as Record<string, unknown>;
}
function receipt(db: D1Database, instance: string, operationId: string) {
	return db
		.prepare(
			"SELECT receipt_id,session_id,operator_id,tool,request_checksum,result_checksum,status,error_code,started_at,completed_at FROM mcp_operator_invocations WHERE instance_id=? AND operation_id=?",
		)
		.bind(instance, operationId)
		.first<Receipt>();
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
async function hash(value: string) {
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
function json(data: unknown) {
	return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
}
function fail(status: number, code: string) {
	return Response.json(
		{ error: { code, message: code } },
		{ status, headers: { "Cache-Control": "no-store" } },
	);
}
