import { env } from "cloudflare:test";
import { expect, test } from "vitest";

import { issueMcpToken, tokenDigest } from "../../../workers/api/src/lib/mcp-oauth.js";
import {
	apiCommand,
	apiRead,
	jsonResult,
	pluginDatabase,
	prepareApiPlugin,
	proveApi,
} from "./retirement-api-helpers.js";
const plugin = "supbrd-plugmod-mcp";
const file = "retirement-api-mcp.runtime.test.ts";
test("canonical MCP APIs retain consent, scoped token revocation, protocol sessions and receipts", async () => {
	await prepareApiPlugin(plugin);
	const db = pluginDatabase("api");
	const client = {
		id: crypto.randomUUID(),
		client_id: `retirement-${crypto.randomUUID()}`,
		name: "API proof client",
		redirect_uris: JSON.stringify(["http://localhost:3210/callback"]),
	};
	await db
		.prepare("INSERT INTO mcp_clients(id,name,client_id,redirect_uris) VALUES (?,?,?,?)")
		.bind(client.id, client.name, client.client_id, client.redirect_uris)
		.run();
	const consent = await jsonResult<{ code: string; redirect_uri: string }>(
		await apiCommand(plugin, "approve_consent", {
			method: "POST",
			path: "/api/v1/mcp/approve_consent",
			body: {
				client_id: client.client_id,
				redirect_uri: "http://localhost:3210/callback",
				code_challenge: "retirement-pkce-challenge",
				code_challenge_method: "S256",
				state: "retirement-consent",
			},
		}),
	);
	const grant = await db
		.prepare(
			"SELECT id,client_id,redirect_uri,code_challenge_method FROM mcp_authorization_codes WHERE code=?",
		)
		.bind(consent.code)
		.first<{
			id: number;
			client_id: string;
			redirect_uri: string;
			code_challenge_method: string;
		}>();
	expect(grant).toMatchObject({
		client_id: client.client_id,
		redirect_uri: "http://localhost:3210/callback",
		code_challenge_method: "S256",
	});
	proveApi(plugin, "approve_consent", "mutation", file, [`mcp_authorization_codes:${grant!.id}`]);
	const token = await issueMcpToken(db, {
		client,
		userId: null,
		siteOperator: { operator_id: "operator-1", instance_id: env.SUPERBOARD_INSTANCE_ID, role: 50 },
	});
	const row = await db
		.prepare("SELECT id,revoked_at FROM mcp_tokens WHERE token_digest=?")
		.bind(await tokenDigest(token.access_token))
		.first<{ id: number; revoked_at: string | null }>();
	expect(row?.revoked_at).toBeNull();
	const id = String(row!.id);
	const tokens = await jsonResult<{ tokens: Array<{ id: string; client_id: string }> }>(
		await apiRead(plugin, "tokens", { method: "GET", path: "/api/v1/mcp/tokens" }),
	);
	expect(tokens.tokens).toContainEqual(
		expect.objectContaining({ id, client_id: client.client_id }),
	);
	expect(JSON.stringify(tokens)).not.toContain(token.access_token);
	expect(JSON.stringify(tokens)).not.toContain(token.refresh_token);
	proveApi(plugin, "tokens", "read", file, [id]);
	await jsonResult(
		await apiCommand(plugin, "revoke_token", {
			method: "DELETE",
			path: `/api/v1/mcp/tokens/${id}`,
		}),
	);
	expect(
		(
			await db
				.prepare("SELECT revoked_at FROM mcp_tokens WHERE id=?")
				.bind(id)
				.first<{ revoked_at: string }>()
		)?.revoked_at,
	).toBeTruthy();
	const revoked = await jsonResult<{ tokens: Array<{ id: string }> }>(
		await apiRead(plugin, "tokens", { method: "GET", path: "/api/v1/mcp/tokens" }),
	);
	expect(revoked.tokens.some((candidate) => candidate.id === id)).toBe(false);
	proveApi(plugin, "revoke_token", "mutation", file, [id]);
	const called = await jsonResult<{
		data: {
			status: string;
			session_id: string;
			receipt_id: string;
			result: { isError?: boolean; content: Array<{ text: string }> };
		};
	}>(
		await apiCommand(plugin, "invoke_tool", {
			method: "POST",
			path: "/api/v1/mcp/operator/invocations",
			body: { tool: "get_status", arguments: {} },
		}),
	);
	expect(called.data.status).toBe("completed");
	expect(called.data.result.isError).not.toBe(true);
	expect(called.data.result.content[0]?.text).toContain("Account Overview");
	const receipt = await db
		.prepare(
			"SELECT session_id,tool,status,result_checksum FROM mcp_operator_invocations WHERE receipt_id=? AND instance_id=?",
		)
		.bind(called.data.receipt_id, env.SUPERBOARD_INSTANCE_ID)
		.first<{ session_id: string; tool: string; status: string; result_checksum: string }>();
	expect(receipt).toMatchObject({
		session_id: called.data.session_id,
		tool: "get_status",
		status: "completed",
	});
	expect(receipt?.result_checksum).toMatch(/^[a-f0-9]{64}$/u);
	proveApi(plugin, "invoke_tool", "mutation", file, [
		called.data.receipt_id,
		called.data.session_id,
	]);
	const sessions = await jsonResult<{
		data: { items: Array<{ session_id: string; status: string }> };
	}>(await apiRead(plugin, "sessions", { method: "GET", path: "/api/v1/mcp/operator/sessions" }));
	expect(sessions.data.items).toContainEqual(
		expect.objectContaining({ session_id: called.data.session_id, status: "active" }),
	);
	proveApi(plugin, "sessions", "read", file, [called.data.session_id]);
	const receipts = await jsonResult<{
		data: { items: Array<{ receipt_id: string; tool: string; status: string }> };
	}>(
		await apiRead(plugin, "tool_receipts", {
			method: "GET",
			path: "/api/v1/mcp/operator/receipts",
		}),
	);
	expect(receipts.data.items).toContainEqual(
		expect.objectContaining({
			receipt_id: called.data.receipt_id,
			tool: "get_status",
			status: "completed",
		}),
	);
	proveApi(plugin, "tool_receipts", "read", file, [called.data.receipt_id]);
});
