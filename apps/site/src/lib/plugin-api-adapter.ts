import {
	canonicalPluginId,
	pluginPackage,
	pluginComponentForContribution,
} from "@superboard/contracts/plugin-packages";
import {
	readJsonObjectLimited,
	readBytesLimited,
	RequestBodyError,
} from "@superboard/contracts/request-body";
import { resolveRouteReference, RouteReferenceError } from "@superboard/contracts/route-reference";
import { matchRouteParameters } from "@superboard/contracts/route-registry";
import type { RouteDescriptor } from "@superboard/contracts/route-registry";
import { createFetchRouter, resolveRegisteredRoute } from "@superboard/contracts/route-registry";
import type { APIContext } from "astro";

import registry from "../../../../scripts/config/superboard-plugin-api-adapters.json";
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
import { resolveApiRouteReferences } from "./route-references.js";
import { dispatchSettingsPluginApi } from "./settings-plugin-api.js";
import { getSiteEnv } from "./site-env.js";
import { registerSiteRouteSource } from "./site-route-registry.js";
import { resolveSuperBoardPluginTarget } from "./superboard-plugin-catalog.js";

export type PluginApiAdapterKind = "command" | "data_source";
export interface PluginApiAdapterEnvelope {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	body?: unknown;
}
interface AdapterOperation {
	route_id?: string;
	method?: string;
	path?: string;
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
const adapterRegistry: { adapters: Adapter[] } = registry;
const adapters = new Map<string, Adapter>(
	adapterRegistry.adapters.flatMap((adapter): [string, Adapter][] => [
		[adapter.id, adapter],
		[canonicalPluginId(adapter.id), adapter],
	]),
);

function ownedAdapter(pluginId: string, contributionId: string): Adapter | undefined {
	const adapter = adapters.get(contributionId);
	if (!adapter) return undefined;
	const owner = pluginPackage(pluginId);
	return adapter.plugin_id === pluginId ||
		(owner &&
			(pluginId === owner.directory || pluginId === owner.id) &&
			owner.components.includes(adapter.plugin_id))
		? adapter
		: undefined;
}
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
	routes: readonly RouteDescriptor[] = [],
) {
	const adapter = ownedAdapter(pluginId, contributionId);
	if (!adapter || adapter.kind !== kind)
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
			(["superboard-content", "superboard-audit", "superboard-settings"].includes(
				adapter.plugin_id,
			) &&
				url.pathname.startsWith("/_emdash/api/"))
		)
	)
		throw new PluginApiAdapterError("PLUGIN_ADAPTER_PATH_INVALID", 422);
	const matches = adapter.operations.flatMap((reference) => {
		const operation = resolveRouteReference(reference, routes, adapter.plugin_id);
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

async function executePluginApiAdapter(
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
	const operator = context.locals.user;
	if (!operator) return jsonResponse({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
	const env = envOverride ?? getSiteEnv();
	const localId =
		(kind === "command" ? context.params.commandId : context.params.dataSourceId) ?? "";
	const requestedPlugin = context.params.pluginId ?? "";
	const alias = ownedAdapter(
		requestedPlugin,
		localId.includes(`.${kind}.`) ? localId : `${requestedPlugin}.${kind}.${localId}`,
	);
	const pluginId = alias?.plugin_id ?? pluginComponentForContribution(requestedPlugin, localId);
	const contributionId =
		alias?.id ?? (localId.includes(`.${kind}.`) ? localId : `${pluginId}.${kind}.${localId}`);
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
		const references =
			ownedAdapter(pluginId, contributionId)?.operations.flatMap((operation) =>
				operation.route_id ? [operation.route_id] : [],
			) ?? [];
		const routes = references.length
			? await resolveApiRouteReferences(env, operator, references)
			: [];
		const matched = matchPluginApiAdapter(pluginId, contributionId, kind, envelope, routes);
		if (
			multipartMetadata &&
			(matched.operation.body !== "passthrough" || matched.body !== undefined)
		)
			throw new PluginApiAdapterError("PLUGIN_ADAPTER_MULTIPART_INVALID", 422);
		if (context.request.method === "GET" && matched.method !== "GET")
			throw new PluginApiAdapterError("PLUGIN_ADAPTER_METHOD_NOT_ALLOWED", 405);
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
			["superboard-content", "superboard-audit", "superboard-settings"].includes(pluginId) &&
			destination.pathname.startsWith("/_emdash/api/")
		) {
			const dispatch = () =>
				pluginId === "superboard-content"
					? dispatchContentPluginApi(context, request, matched.operation.route_id)
					: pluginId === "superboard-audit"
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
		if (error instanceof RouteReferenceError)
			return jsonResponse({ error: { code: error.code } }, 503);
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

function matchPath(
	operation: AdapterOperation & { path: string },
	pathname: string,
): Record<string, string> | null {
	const matched = matchRouteParameters(operation.path, pathname);
	if (!matched) return null;
	const parameters: Record<string, string> = {};
	for (const [name, received] of Object.entries(matched)) {
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

type AdapterEnvironment = Parameters<typeof executePluginApiAdapter>[2];
const adapterRoutes = createFetchRouter<{ context: APIContext; env?: AdapterEnvironment }>({
	service: "site",
	module: "plugin-adapters",
	pluginId: "supbrd-core",
	surface: "board",
	access: "operator",
});
for (const adapter of adapterRegistry.adapters) {
	if (adapter.status !== "verified" || adapter.audience === "application_client") continue;
	const kind: PluginApiAdapterKind = adapter.kind === "command" ? "command" : "data_source";
	const resource = kind === "command" ? "commands" : "data-sources";
	const method = kind === "command" ? "POST" : "GET";
	const owner = pluginPackage(adapter.plugin_id);
	const owners = new Set([adapter.plugin_id, ...(owner ? [owner.id, owner.directory] : [])]);
	const ids = new Set([
		adapter.id,
		canonicalPluginId(adapter.id),
		adapter.id.split(".").slice(2).join("."),
	]);
	const paths = [...owners].flatMap((pluginId) =>
		[...ids]
			.filter(
				(id) =>
					ownedAdapter(pluginId, id.includes(`.${kind}.`) ? id : `${pluginId}.${kind}.${id}`) ===
					adapter,
			)
			.map((id) => `/_emdash/api/superboard/plugins/${pluginId}/${resource}/${id}`),
	);
	const canonical = `/_emdash/api/superboard/plugins/${canonicalPluginId(adapter.plugin_id)}/${resource}/${canonicalPluginId(adapter.id)}`;
	adapterRoutes
		.defineRoute({
			id: `site:adapter:${adapter.id}`,
			pluginId: adapter.plugin_id,
			exposures: [{ surface: "board", path: canonical }],
		})
		.on(method, paths, ({ env }) => executePluginApiAdapter(env.context, kind, env.env));
}
registerSiteRouteSource("plugin-adapters", adapterRoutes);

export function dispatchPluginApiAdapter(
	context: APIContext,
	kind: PluginApiAdapterKind,
	env?: AdapterEnvironment,
): Promise<Response> {
	return resolveRegisteredRoute(
		adapterRoutes,
		context.request.method,
		"board",
		context.url.pathname,
	)
		? adapterRoutes.fetch(context.request, { context, env })
		: executePluginApiAdapter(context, kind, env);
}
