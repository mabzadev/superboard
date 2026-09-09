import { pluginComponentForContribution } from "@superboard/contracts/plugin-packages";
import {
	readJsonObjectLimited,
	readBytesLimited,
	RequestBodyError,
} from "@superboard/contracts/request-body";
import type { APIContext } from "astro";

import registry from "../../../../config/superboard-plugin-api-adapters.json";
import { dispatchAuditPluginApi } from "./audit-plugin-api.js";
import { dispatchContentPluginApi } from "./content-plugin-api.js";
import {
	executeRepositoryFirstCommand,
	proxyOperatorApiRequest,
	type OperatorApiProxyEnv,
} from "./operator-api-proxy.js";
import { jsonResponse, requirePluginOperator } from "./operator-guard.js";
import {
	resolveOperatorProjectScope,
	OperatorProjectScopeError,
} from "./operator-project-scope.js";
import { requireActiveSuperBoardPlugin } from "./plugin-availability.js";
import { dispatchSettingsPluginApi } from "./settings-plugin-api.js";
import { getSiteEnv } from "./site-env.js";
import { resolveSuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

export type PluginApiAdapterKind = "command" | "data_source";
export interface PluginApiAdapterEnvelope {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	body?: unknown;
}
interface AdapterOperation {
	method: string;
	path: string;
	parameters: string[];
	server_bound_parameters: string[];
	parameter_values: Record<string, readonly string[] | undefined>;
	query: string;
	body: string;
	read_only?: boolean;
}
interface Adapter {
	audience?: string;
	plugin_id: string;
	id: string;
	kind: string;
	status: string;
	operations: AdapterOperation[];
}
const adapters = new Map<string, Adapter>(
	registry.adapters.map((adapter): [string, Adapter] => [adapter.id, adapter]),
);
function isAdapterMethod(value: unknown): value is PluginApiAdapterEnvelope["method"] {
	return (
		value === "GET" ||
		value === "POST" ||
		value === "PUT" ||
		value === "PATCH" ||
		value === "DELETE"
	);
}
// oxlint-disable-next-line no-control-regex -- Reject control characters in untrusted adapter URLs.
const invalidControlPattern = /[\u0000-\u001f\u007f]/u;
const encodedPathSeparatorPattern = /%2f|%5c/iu;
const multipartContentTypePattern = /^multipart\/form-data(?:;|$)/iu;
const opaquePathParameters = new Set(["userHash", "authId"]);

export class PluginApiAdapterError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}

export function matchPluginApiAdapter(
	pluginId: string,
	contributionId: string,
	kind: PluginApiAdapterKind,
	value: unknown,
) {
	const adapter = adapters.get(contributionId);
	if (!adapter || adapter.plugin_id !== pluginId || adapter.kind !== kind)
		throw new PluginApiAdapterError("PLUGIN_ADAPTER_NOT_FOUND", 404);
	if (adapter.audience === "application_client")
		throw new PluginApiAdapterError("APPLICATION_CREDENTIALS_REQUIRED", 403);
	if (adapter.status !== "verified")
		throw new PluginApiAdapterError("PLUGIN_ADAPTER_UNAVAILABLE", 501);
	if (
		!isRecord(value) ||
		typeof value.method !== "string" ||
		!isAdapterMethod(value.method) ||
		typeof value.path !== "string" ||
		value.path.length > 8192 ||
		!value.path.startsWith("/") ||
		value.path.startsWith("//") ||
		value.path.includes("#") ||
		value.path.includes("\\") ||
		invalidControlPattern.test(value.path) ||
		Object.keys(value).some((key) => !["method", "path", "body"].includes(key))
	)
		throw new PluginApiAdapterError("PLUGIN_ADAPTER_REQUEST_INVALID", 422);
	const url = new URL(value.path, "https://adapter.internal");
	if (
		url.origin !== "https://adapter.internal" ||
		!(
			url.pathname.startsWith("/api/v1/") ||
			url.pathname.startsWith("/api/v2/") ||
			([
				"supbrd-plug-content",
				"supbrd-plug-audit",
				"supbrd-plug-settings",
				"supbrd-plugmod-vocostar",
			].includes(pluginId) &&
				url.pathname.startsWith("/_emdash/api/"))
		)
	)
		throw new PluginApiAdapterError("PLUGIN_ADAPTER_PATH_INVALID", 422);
	const matches = adapter.operations.flatMap((operation) => {
		if (operation.method !== value.method) return [];
		const parameters = matchPath(operation, url.pathname);
		if (
			!parameters ||
			(operation.query === "none" && url.search) ||
			(operation.body === "none" && value.body !== undefined)
		)
			return [];
		if (kind === "command" && operation.method === "GET") return [];
		if (kind === "data_source" && operation.method !== "GET" && operation.read_only !== true)
			return [];
		return [{ operation, parameters }];
	});
	if (matches.length !== 1)
		throw new PluginApiAdapterError(
			matches.length
				? "PLUGIN_ADAPTER_OPERATION_AMBIGUOUS"
				: "PLUGIN_ADAPTER_OPERATION_NOT_ALLOWED",
			422,
		);
	return {
		...matches[0],
		adapter,
		url,
		body: value.body,
		method: value.method,
	};
}

export async function dispatchPluginApiAdapter(
	context: APIContext,
	kind: PluginApiAdapterKind,
	envOverride?: OperatorApiProxyEnv & {
		DB: D1Database;
		SUPERBOARD_INSTANCE_ID: string;
		SUPERBOARD_ENVIRONMENT: string;
	},
): Promise<Response> {
	const denied = requirePluginOperator(context, { mutation: context.request.method !== "GET" });
	if (denied) return denied;
	const env = envOverride ?? getSiteEnv();
	const localId =
		(kind === "command" ? context.params.commandId : context.params.dataSourceId) ?? "";
	const pluginId = pluginComponentForContribution(context.params.pluginId ?? "", localId);
	const contributionId = localId.includes(`.${kind}.`) ? localId : `${pluginId}.${kind}.${localId}`;
	const inactive = await requireActiveSuperBoardPlugin(env.DB, {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
		plugin_id: pluginId,
	});
	if (inactive) return inactive;
	try {
		const multipartMetadata = context.request.headers.get("X-SuperBoard-Adapter-Request");
		if (
			multipartMetadata &&
			(multipartMetadata.length > 8192 ||
				!multipartContentTypePattern.test(context.request.headers.get("Content-Type") ?? ""))
		)
			throw new PluginApiAdapterError("PLUGIN_ADAPTER_MULTIPART_INVALID", 422);
		const envelope = multipartMetadata
			? (JSON.parse(multipartMetadata) as unknown)
			: context.request.method === "GET"
				? (JSON.parse(context.url.searchParams.get("request") ?? "null") as unknown)
				: await readJsonObjectLimited(context.request, 2 * 1024 * 1024);
		const matched = matchPluginApiAdapter(pluginId, contributionId, kind, envelope);
		if (
			multipartMetadata &&
			(matched.operation.body !== "passthrough" || matched.body !== undefined)
		)
			throw new PluginApiAdapterError("PLUGIN_ADAPTER_MULTIPART_INVALID", 422);
		if (context.request.method === "GET" && matched.method !== "GET")
			throw new PluginApiAdapterError("PLUGIN_ADAPTER_METHOD_NOT_ALLOWED", 405);
		const operator = context.locals.user!;
		let projectRef = "instance-wide";
		if (matched.operation.server_bound_parameters.length) {
			const scope = await resolveOperatorProjectScope(env, operator);
			for (const parameter of matched.operation.server_bound_parameters) {
				if (parameter !== "projectRef")
					throw new PluginApiAdapterError("PLUGIN_ADAPTER_SCOPE_UNSUPPORTED", 501);
				const selected = matched.parameters[parameter];
				if (selected !== scope.production_project_ref && selected !== scope.test_project_ref)
					throw new PluginApiAdapterError("PLUGIN_ADAPTER_PROJECT_FORBIDDEN", 403);
				projectRef = selected;
			}
		}
		const destination = new URL(`${matched.url.pathname}${matched.url.search}`, context.url.origin);
		const headers = new Headers(context.request.headers);
		headers.delete("content-length");
		headers.delete("X-SuperBoard-Command-Id");
		headers.delete("X-SuperBoard-Adapter-Request");
		if (!multipartMetadata) {
			if (matched.body !== undefined) headers.set("Content-Type", "application/json");
			else headers.delete("Content-Type");
		}
		const body = multipartMetadata
			? await readBytesLimited(context.request, 100 * 1024 * 1024)
			: matched.body !== undefined
				? JSON.stringify(matched.body)
				: undefined;
		const request = new Request(destination, {
			method: matched.method,
			headers,
			...(body !== undefined ? { body } : {}),
		});
		if (
			[
				"supbrd-plug-content",
				"supbrd-plug-audit",
				"supbrd-plug-settings",
				"supbrd-plugmod-vocostar",
			].includes(pluginId) &&
			destination.pathname.startsWith("/_emdash/api/")
		) {
			const dispatch = () =>
				pluginId === "supbrd-plug-content"
					? dispatchContentPluginApi(context, request)
					: pluginId === "supbrd-plug-audit"
						? dispatchAuditPluginApi(request, env)
						: dispatchSettingsPluginApi(context, request, pluginId);
			if (matched.method === "GET") return dispatch();
			return executeRepositoryFirstCommand({
				env,
				url: destination,
				request_headers: headers,
				request_body: new Uint8Array(await request.clone().arrayBuffer()),
				method: matched.method,
				plugin_context: {
					plugin_id: pluginId,
					command_id: contributionId,
					project_ref: projectRef,
				},
				dispatch,
			});
		}
		return await proxyOperatorApiRequest({
			request,
			operator: { id: operator.id, role: operator.role },
			env,
			plugin_context: {
				plugin_id: pluginId,
				command_id: kind === "command" ? contributionId : undefined,
				project_ref: projectRef,
			},
			...(kind === "data_source" && matched.operation.read_only === true
				? { command_authority: async (input) => input.dispatch() }
				: {}),
		});
	} catch (error) {
		if (error instanceof PluginApiAdapterError)
			return jsonResponse({ error: { code: error.code } }, error.status);
		if (error instanceof OperatorProjectScopeError)
			return jsonResponse({ error: { code: error.code } }, error.status);
		if (error instanceof RequestBodyError)
			return jsonResponse({ error: { code: "PLUGIN_ADAPTER_REQUEST_INVALID" } }, error.status);
		if (error instanceof SyntaxError)
			return jsonResponse({ error: { code: "PLUGIN_ADAPTER_REQUEST_INVALID" } }, 422);
		console.error("[plugin-api-adapter] dispatch failed", error);
		return jsonResponse({ error: { code: "PLUGIN_ADAPTER_DISPATCH_FAILED" } }, 503);
	}
}

function matchPath(operation: AdapterOperation, pathname: string): Record<string, string> | null {
	const expected = operation.path.split("/");
	const actual = pathname.split("/");
	if (expected.length !== actual.length) return null;
	const parameters: Record<string, string> = {};
	for (const [index, segment] of expected.entries()) {
		const received = actual[index];
		if (!segment.startsWith(":")) {
			if (segment !== received) return null;
			continue;
		}
		const name = segment.slice(1);
		let value: string;
		try {
			value = decodeURIComponent(received);
		} catch {
			return null;
		}
		if (
			!value ||
			value === "." ||
			value === ".." ||
			invalidControlPattern.test(value) ||
			(!opaquePathParameters.has(name) && encodedPathSeparatorPattern.test(received))
		)
			return null;
		const allowed = operation.parameter_values[name];
		if (allowed && !allowed.includes(value)) return null;
		parameters[name] = value;
	}
	return parameters;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
