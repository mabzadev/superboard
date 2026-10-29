import { parseRouteDescriptors } from "@superboard/contracts/route-manifest";
import {
	resolveRouteReference,
	routeReferenceBatches,
	ROUTE_REFERENCES_PATH,
} from "@superboard/contracts/route-reference";
import { matchRouteParameters, type RouteDescriptor } from "@superboard/contracts/route-registry";
import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";

import { ApiError, getErrorMessage, parseApiErrorPayload } from "./ApiError.js";

export interface RequestOptions {
	onProgress?: ((percentage: number) => void) | null;
	retry?: boolean;
	timeout?: number;
	signal?: AbortSignal;
	maxRetries?: number;
	headers?: Record<string, string>;
	responseType?: AxiosRequestConfig["responseType"];
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export interface PluginApiAdapter {
	id: string;
	kind: "command" | "data_source";
	operations: readonly {
		route_id?: string;
		method?: string;
		path?: string;
		query: "none" | "passthrough";
		body: "none" | "passthrough";
		parameter_values?: Record<string, readonly string[]>;
		read_only?: boolean;
	}[];
}
let sessionCheck: Promise<boolean> | null = null;

async function operatorSessionExpired(): Promise<boolean> {
	sessionCheck ??= fetch(sameOriginUrl("/_emdash/api/auth/me"), {
		credentials: "same-origin",
		cache: "no-store",
	})
		.then((response) => response.status === 401)
		.catch(() => false)
		.finally(() => {
			sessionCheck = null;
		});
	return sessionCheck;
}

export function operatorLoginLocation(): string {
	const path = globalThis.location
		? `${globalThis.location.pathname}${globalThis.location.search}`
		: "/";
	return `/_emdash/admin/login?redirect=${encodeURIComponent(path)}`;
}

function sameOriginUrl(path: string): string {
	if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/u.test(path))
		throw new ApiError("Invalid API path", 400, "INVALID_API_PATH");
	if (!globalThis.location) return path;
	const url = new URL(path, globalThis.location.origin);
	if (url.origin !== globalThis.location.origin)
		throw new ApiError("Invalid API path", 400, "INVALID_API_PATH");
	return url.href;
}

const referencesKey = Symbol.for("superboard.front.route-references.v1");
const referenceGlobals = globalThis as typeof globalThis & {
	[referencesKey]?: Map<string, Promise<RouteDescriptor[]>>;
};
const referenceRequests = (referenceGlobals[referencesKey] ??= new Map<
	string,
	Promise<RouteDescriptor[]>
>());

async function fetchRouteReferences(
	ids: readonly string[],
	signal?: AbortSignal,
): Promise<RouteDescriptor[]> {
	const selected = [...new Set(ids)].sort();
	const key = `${globalThis.location?.origin ?? ""}:${JSON.stringify(selected)}`;
	let pending = referenceRequests.get(key);
	if (!pending) {
		pending = Promise.resolve()
			.then(async () => {
				const routes: RouteDescriptor[] = [];
				for (const batch of routeReferenceBatches(selected)) {
					const query = new URLSearchParams();
					for (const id of batch) query.append("route_id", id);
					const response = await fetch(sameOriginUrl(`${ROUTE_REFERENCES_PATH}?${query}`), {
						credentials: "same-origin",
					});
					if (!response.ok) {
						await response.body?.cancel();
						if (response.status === 401 && (await operatorSessionExpired()))
							globalThis.location?.assign(operatorLoginLocation());
						throw new ApiError(
							getErrorMessage(response.status),
							response.status,
							"ROUTE_REFERENCE_UNAVAILABLE",
						);
					}
					const payload: unknown = await response.json();
					if (!payload || typeof payload !== "object" || !("routes" in payload))
						throw new ApiError(getErrorMessage(503), 503, "ROUTE_REFERENCE_INVALID");
					routes.push(...parseRouteDescriptors(payload.routes));
				}
				return [...new Map(routes.map((route) => [route.id, route])).values()];
			})
			.finally(() => {
				referenceRequests.delete(key);
			});
		referenceRequests.set(key, pending);
	}
	if (!signal) return pending;
	if (signal.aborted) throw signal.reason;
	let abort: (() => void) | undefined;
	try {
		return await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				abort = () => {
					reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
				};
				signal.addEventListener("abort", abort, { once: true });
			}),
		]);
	} finally {
		if (abort) signal.removeEventListener("abort", abort);
	}
}

function findAdapter(
	adapters: readonly PluginApiAdapter[],
	method: Method,
	path: string,
	routes: readonly RouteDescriptor[],
): PluginApiAdapter | undefined {
	const pathname = path.split("?")[0]!;
	return adapters.find((adapter) =>
		adapter.operations.some((reference) => {
			const operation = resolveRouteReference(reference, routes);
			if (operation.method !== method || (operation.query === "none" && path.includes("?")))
				return false;
			if (adapter.kind === "data_source" && method !== "GET" && !operation.read_only) return false;
			const parameters = matchRouteParameters(operation.path, pathname);
			if (!parameters) return false;
			return Object.entries(parameters).every(([name, actual]) => {
				try {
					const values = operation.parameter_values?.[name];
					return !values || values.includes(decodeURIComponent(actual));
				} catch {
					return false;
				}
			});
		}),
	);
}

export function createPluginApiClient(
	pluginId?: string,
	adapters: readonly PluginApiAdapter[] = [],
) {
	const request = async (
		method: Method,
		path: string,
		data: unknown,
		options: RequestOptions = {},
	): Promise<AxiosResponse> => {
		let url = sameOriginUrl(path);
		let transportMethod = method;
		let body = data;
		const headers = new Headers(options.headers);
		headers.delete("Authorization");
		if (pluginId) headers.set("X-SuperBoard-Plugin-Id", pluginId);
		if (method !== "GET") {
			headers.set("X-EmDash-Request", "1");
			if (!headers.get("Idempotency-Key")) headers.set("Idempotency-Key", crypto.randomUUID());
		}
		const references = adapters.flatMap((adapter) =>
			adapter.operations.flatMap((operation) => (operation.route_id ? [operation.route_id] : [])),
		);
		const routes =
			pluginId && references.length ? await fetchRouteReferences(references, options.signal) : [];
		const adapter = pluginId
			? findAdapter(adapters, method, path, [
					...new Map(routes.map((route) => [route.id, route])).values(),
				])
			: undefined;
		if (adapter && !(data instanceof Blob)) {
			const base = `/_emdash/api/superboard/plugins/${encodeURIComponent(pluginId!)}/${adapter.kind === "command" ? "commands" : "data-sources"}/${encodeURIComponent(adapter.id)}`;
			const envelope = { method, path, ...(data === undefined ? {} : { body: data }) };
			if (data instanceof FormData) {
				url = sameOriginUrl(base);
				transportMethod = "POST";
				headers.set("X-SuperBoard-Adapter-Request", JSON.stringify({ method, path }));
				headers.delete("Content-Type");
			} else if (adapter.kind === "data_source" && method === "GET")
				url = sameOriginUrl(`${base}?request=${encodeURIComponent(JSON.stringify(envelope))}`);
			else {
				url = sameOriginUrl(base);
				transportMethod = "POST";
				body = envelope;
			}
		}
		try {
			return await axios({
				method: transportMethod,
				url,
				data: body,
				headers: Object.fromEntries(headers),
				withCredentials: true,
				timeout: options.timeout ?? 60_000,
				signal: options.signal,
				responseType: options.responseType,
				onUploadProgress: ({ loaded, total }) => {
					if (total) options.onProgress?.(Math.floor((loaded * 100) / total));
				},
			});
		} catch (error) {
			if (axios.isCancel(error)) throw error;
			if (axios.isAxiosError(error)) {
				const status = error.response?.status ?? 0;
				if (status === 401 && (await operatorSessionExpired()))
					globalThis.location?.assign(operatorLoginLocation());
				const parsed = parseApiErrorPayload(error.response?.data);
				throw new ApiError(
					parsed.message ?? getErrorMessage(status),
					status,
					parsed.code ?? error.code,
					error.response?.data,
				);
			}
			throw error;
		}
	};
	return {
		request,
		GET: (path: string, options?: RequestOptions) => request("GET", path, undefined, options),
		POST: (path: string, data?: unknown, options?: RequestOptions) =>
			request("POST", path, data, options),
		PATCH: (path: string, data?: unknown, options?: RequestOptions) =>
			request("PATCH", path, data, options),
		PUT: (path: string, data?: unknown, options?: RequestOptions) =>
			request("PUT", path, data, options),
		DELETE: (path: string, options?: RequestOptions) => request("DELETE", path, undefined, options),
	};
}

export const { GET, POST, PUT, PATCH, DELETE } = createPluginApiClient();
