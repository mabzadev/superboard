import {
	assertIdempotencyKey,
	beginRepositoryCommand,
	completeRepositoryCommand,
	resolveRepositoryCommandScope,
} from "./plugin-command-authority.js";
import { importPluginStoreEncryptionKey } from "./plugin-store-repository.js";
import { resolveSuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

interface OperatorApiProxyEnv {
	API_SERVICE?: { fetch(request: Request): Promise<Response> };
	SITE_OPERATOR_BRIDGE_TOKEN?: string;
	DB?: D1Database;
	SUPERBOARD_INSTANCE_ID?: string;
	SUPERBOARD_ENVIRONMENT?: string;
	SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?: string;
}

type CommandAuthority = (input: {
	request_headers: Headers;
	request_body: Uint8Array;
	method: "POST" | "PUT" | "PATCH" | "DELETE";
	url: URL;
	env: OperatorApiProxyEnv;
	dispatch: () => Promise<Response>;
}) => Promise<Response>;

export async function proxyOperatorApiRequest(input: {
	request: Request;
	operator_email: string;
	env: OperatorApiProxyEnv;
	command_authority?: CommandAuthority;
}): Promise<Response> {
	const email = input.operator_email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
		return errorResponse(401, "OPERATOR_IDENTITY_INVALID");
	}
	const token = input.env.SITE_OPERATOR_BRIDGE_TOKEN?.trim();
	if (!input.env.API_SERVICE || !token) {
		return errorResponse(503, "GATEWAY_BRIDGE_UNAVAILABLE");
	}
	const source = new URL(input.request.url);
	if (!["GET", "HEAD", "OPTIONS"].includes(input.request.method)) {
		const origin = input.request.headers.get("Origin");
		if (!origin || origin !== source.origin)
			return errorResponse(403, "CROSS_ORIGIN_MUTATION_REJECTED");
	}
	const target = new URL(`${source.pathname}${source.search}`, "https://api.internal");
	const headers = new Headers(input.request.headers);
	for (const name of [
		"authorization",
		"cookie",
		"host",
		"x-superboard-site-operator",
		"x-superboard-internal-token",
	]) {
		headers.delete(name);
	}
	headers.set("X-SuperBoard-Site-Operator", email);
	headers.set("X-SuperBoard-Internal-Token", token);
	headers.set("X-Request-Id", headers.get("X-Request-Id")?.trim() || crypto.randomUUID());
	const forwarded = new Request(new Request(target, input.request), { headers });
	const dispatch = async () => input.env.API_SERVICE!.fetch(forwarded);
	let response: Response;
	if (["GET", "HEAD", "OPTIONS"].includes(input.request.method)) {
		response = await dispatch();
	} else {
		const commandRequest = forwarded.clone();
		response = await (input.command_authority ?? executeRepositoryFirstCommand)({
			request_headers: commandRequest.headers,
			request_body: new Uint8Array(await commandRequest.arrayBuffer()),
			method: input.request.method as "POST" | "PUT" | "PATCH" | "DELETE",
			url: source,
			env: input.env,
			dispatch,
		});
	}
	const responseHeaders = new Headers(response.headers);
	responseHeaders.delete("Set-Cookie");
	responseHeaders.set("Cache-Control", "private, no-store");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: responseHeaders,
	});
}

async function executeRepositoryFirstCommand(input: {
	request_headers: Headers;
	request_body: Uint8Array;
	method: "POST" | "PUT" | "PATCH" | "DELETE";
	url: URL;
	env: OperatorApiProxyEnv;
	dispatch: () => Promise<Response>;
}): Promise<Response> {
	const db = input.env.DB;
	const instanceId = input.env.SUPERBOARD_INSTANCE_ID?.trim();
	const encodedKey = input.env.SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?.trim();
	if (!db || !instanceId || !encodedKey) {
		return errorResponse(503, "COMMAND_REPOSITORY_UNAVAILABLE");
	}
	let operationId: string;
	let encryptionKey: CryptoKey;
	try {
		operationId = assertIdempotencyKey(input.request_headers.get("Idempotency-Key"));
		encryptionKey = await importPluginStoreEncryptionKey(encodedKey);
	} catch (error) {
		return errorResponse(
			error instanceof Error && error.message === "IDEMPOTENCY_KEY_REQUIRED" ? 400 : 503,
			error instanceof Error ? error.message : "COMMAND_REPOSITORY_UNAVAILABLE",
		);
	}
	const scope = resolveRepositoryCommandScope(input.url);
	const method = input.method;
	try {
		const accepted = await beginRepositoryCommand(db, {
			operation_id: operationId,
			instance_id: instanceId,
			target: resolveSuperBoardPluginTarget(input.env.SUPERBOARD_ENVIRONMENT ?? "local"),
			project_ref: scope.project_ref,
			plugin_id: scope.plugin_id,
			command_id: input.request_headers.get("X-SuperBoard-Command-Id")?.trim() || undefined,
			adapter_operation: scope.adapter_operation,
			method,
			request_path: input.url.pathname,
			request_body: input.request_body,
			accepted_at: new Date().toISOString(),
			encryption_key: encryptionKey,
		});
		if (accepted.status === "replay") return accepted.response;
		let response: Response;
		try {
			response = await input.dispatch();
		} catch {
			response = errorResponse(502, "TRANSIENT_EXECUTOR_UNAVAILABLE");
		}
		await completeRepositoryCommand(db, {
			operation_id: operationId,
			response,
			completed_at: new Date().toISOString(),
			encryption_key: encryptionKey,
		});
		return response;
	} catch (error) {
		const code = error instanceof Error ? error.message : "COMMAND_REPOSITORY_FAILED";
		const status = /(?:INVALID|REQUIRED|CONFLICT|NOT_DECLARED)$/u.test(code) ? 400 : 503;
		return errorResponse(status, code);
	}
}

function errorResponse(status: number, code: string) {
	return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}
