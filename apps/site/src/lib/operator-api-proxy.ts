import {
	SITE_OPERATOR_HEADERS,
	signSiteOperatorRequest,
} from "@superboard/contracts/site-operator";

import { requireActiveSuperBoardPlugin } from "./plugin-availability.js";
import {
	assertIdempotencyKey,
	beginRepositoryCommand,
	completeRepositoryCommand,
	resolveRepositoryCommandScope,
} from "./plugin-command-authority.js";
import { importPluginStoreEncryptionKey } from "./plugin-store-repository.js";
import { resolveSuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

export interface OperatorApiProxyEnv {
	API_SERVICE?: { fetch(request: Request): Promise<Response> };
	SITE_OPERATOR_BRIDGE_TOKEN?: string;
	DB?: D1Database;
	SUPERBOARD_INSTANCE_ID?: string;
	SUPERBOARD_ENVIRONMENT?: string;
	SUPERBOARD_PLUGIN_STORE_ENCRYPTION_KEY?: string;
}

const CLIENT_COMMAND_ERROR_PATTERN = /(?:INVALID|REQUIRED|CONFLICT|NOT_DECLARED)$/u;

export interface TrustedPluginApiContext {
	plugin_id: string;
	command_id?: string;
	project_ref: string;
}

type CommandAuthority = (input: {
	plugin_context?: TrustedPluginApiContext;
	request_headers: Headers;
	request_body: Uint8Array;
	method: "POST" | "PUT" | "PATCH" | "DELETE";
	url: URL;
	env: OperatorApiProxyEnv;
	dispatch: () => Promise<Response>;
}) => Promise<Response>;

export async function proxyOperatorApiRequest(input: {
	request: Request;
	operator: { id: string; role: number };
	env: OperatorApiProxyEnv;
	command_authority?: CommandAuthority;
	plugin_context?: TrustedPluginApiContext;
}): Promise<Response> {
	const instanceId = input.env.SUPERBOARD_INSTANCE_ID?.trim();
	if (
		!input.operator.id ||
		!Number.isInteger(input.operator.role) ||
		input.operator.role < 40 ||
		input.operator.role > 50
	) {
		return errorResponse(403, "OPERATOR_REQUIRED");
	}
	const token = input.env.SITE_OPERATOR_BRIDGE_TOKEN?.trim();
	if (!input.env.API_SERVICE || !token || !instanceId) {
		return errorResponse(503, "GATEWAY_BRIDGE_UNAVAILABLE");
	}
	const source = new URL(input.request.url);
	if (!["GET", "HEAD", "OPTIONS"].includes(input.request.method)) {
		if (input.request.headers.get("X-EmDash-Request") !== "1")
			return errorResponse(403, "CSRF_HEADER_REQUIRED");
		const origin = input.request.headers.get("Origin");
		if (!origin || origin !== source.origin)
			return errorResponse(403, "CROSS_ORIGIN_MUTATION_REJECTED");
	}
	const owner = input.plugin_context?.plugin_id ?? resolveRepositoryCommandScope(source).plugin_id;
	if (owner !== "supbrd-core") {
		if (!input.env.DB) return errorResponse(503, "PLUGIN_STATE_UNAVAILABLE");
		const denied = await requireActiveSuperBoardPlugin(input.env.DB, {
			instance_id: instanceId,
			target: resolveSuperBoardPluginTarget(input.env.SUPERBOARD_ENVIRONMENT ?? "local"),
			plugin_id: owner,
		});
		if (denied) return denied;
	}
	const target = new URL(`${source.pathname}${source.search}`, "https://api.internal");
	const headers = new Headers(input.request.headers);
	for (const name of [
		"authorization",
		"cookie",
		"host",
		"x-superboard-site-operator",
		"x-superboard-internal-token",
		SITE_OPERATOR_HEADERS.context,
		SITE_OPERATOR_HEADERS.signature,
	]) {
		headers.delete(name);
	}

	headers.set("X-Request-Id", headers.get("X-Request-Id")?.trim() || crypto.randomUUID());
	const unsigned = new Request(new Request(target, input.request), { headers });
	const assertion = await signSiteOperatorRequest(
		unsigned,
		{ operator_id: input.operator.id, instance_id: instanceId, role: input.operator.role },
		token,
	);
	assertion.forEach((value, name) => headers.set(name, value));
	const forwarded = new Request(unsigned, { headers });
	const dispatch = async () => input.env.API_SERVICE!.fetch(forwarded);
	let response: Response;
	if (["GET", "HEAD", "OPTIONS"].includes(input.request.method)) {
		response = await dispatch();
	} else {
		const method = input.request.method;
		if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE")
			return Response.json({ error: { code: "METHOD_NOT_ALLOWED" } }, { status: 405 });
		const commandRequest = forwarded.clone();
		response = await (input.command_authority ?? executeRepositoryFirstCommand)({
			plugin_context: input.plugin_context,
			request_headers: commandRequest.headers,
			request_body: new Uint8Array(await commandRequest.arrayBuffer()),
			method,
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

export async function executeRepositoryFirstCommand(input: {
	plugin_context?: TrustedPluginApiContext;
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
			project_ref: input.plugin_context?.project_ref ?? scope.project_ref,
			plugin_id: input.plugin_context?.plugin_id ?? scope.plugin_id,
			command_id:
				input.plugin_context?.command_id ??
				(input.request_headers.get("X-SuperBoard-Command-Id")?.trim() || undefined),
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
		const status =
			code === "PLUGIN_MANIFEST_NOT_ACTIVE"
				? 404
				: CLIENT_COMMAND_ERROR_PATTERN.test(code)
					? 400
					: 503;
		return errorResponse(status, code);
	}
}

function errorResponse(status: number, code: string) {
	return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}
