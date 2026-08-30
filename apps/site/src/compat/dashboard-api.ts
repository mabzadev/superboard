interface RequestOptions {
	onProgress?: ((percentage: number) => void) | null;
	retry?: boolean;
	timeout?: number;
	signal?: AbortSignal;
	maxRetries?: number;
	headers?: Record<string, string>;
	responseType?: "arraybuffer" | "blob" | "json" | "text";
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface DashboardResponse<T = unknown> {
	data: T;
	status: number;
	statusText: string;
	headers: Headers;
	config: Record<string, unknown>;
	request?: unknown;
}

declare global {
	interface Window {
		__SUPERBOARD_API_URL__?: string;
	}
}

async function request<T>(
	method: HttpMethod,
	path: string,
	payload: unknown,
	options: RequestOptions,
): Promise<DashboardResponse<T>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), options.timeout ?? 60_000);
	const forwardAbort = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener("abort", forwardAbort, { once: true });
	try {
		const base =
			typeof window === "undefined"
				? "http://localhost"
				: (window.__SUPERBOARD_API_URL__ ?? window.location.origin);
		const response = await fetch(new URL(path, base), {
			method,
			credentials: "include",
			signal: controller.signal,
			headers: {
				Accept: "application/json",
				...(payload === undefined ? {} : { "Content-Type": "application/json" }),
				...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
				...options.headers,
			},
			body: payload === undefined ? undefined : JSON.stringify(payload),
		});
		let data: unknown;
		if (options.responseType === "arraybuffer") data = await response.arrayBuffer();
		else if (options.responseType === "blob") data = await response.blob();
		else if (options.responseType === "text") data = await response.text();
		else {
			const text = await response.text();
			data = text === "" ? null : JSON.parse(text);
		}
		if (!response.ok) {
			const error = new Error(
				isRecord(data) && typeof data.message === "string"
					? data.message
					: `Request failed with status ${response.status}`,
			) as Error & { response?: { status: number; data: unknown } };
			error.response = { status: response.status, data };
			throw error;
		}
		options.onProgress?.(100);
		return {
			data: data as T,
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
			config: {},
		};
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", forwardAbort);
	}
}

export function GET<T = unknown>(path: string, options: RequestOptions = {}) {
	return request<T>("GET", path, undefined, options);
}

export function POST<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}) {
	return request<T>("POST", path, data, options);
}

export function PATCH<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}) {
	return request<T>("PATCH", path, data, options);
}

export function PUT<T = unknown>(path: string, data?: unknown, options: RequestOptions = {}) {
	return request<T>("PUT", path, data, options);
}

export function DELETE<T = unknown>(path: string, options: RequestOptions = {}) {
	return request<T>("DELETE", path, undefined, options);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
