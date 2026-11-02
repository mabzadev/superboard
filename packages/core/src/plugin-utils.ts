import type { EmDashHandlers } from "./astro/types.js";

export type PublicPluginApiRouteHandler = EmDashHandlers["handlePublicPluginApiRoute"];

export interface PublicPluginRuntimeLocals {
	emdash?: {
		handlePublicPluginApiRoute?: PublicPluginApiRouteHandler;
	};
}

export function apiFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
	const headers = new Headers(init?.headers);
	headers.set("X-EmDash-Request", "1");
	return fetch(input, { ...init, headers });
}

export function getPublicPluginApiRouteHandler(
	locals: PublicPluginRuntimeLocals | null | undefined,
): PublicPluginApiRouteHandler | undefined {
	const handler = locals?.emdash?.handlePublicPluginApiRoute;
	return typeof handler === "function" ? handler : undefined;
}

export async function parseApiResponse<T>(
	response: Response,
	fallbackMessage = "Request failed",
): Promise<T> {
	if (!response.ok) {
		throw new Error(await getErrorMessage(response, `${fallbackMessage}: ${response.statusText}`));
	}
	const body: { data: T } = await response.json();
	return body.data;
}

export async function getErrorMessage(response: Response, fallback: string): Promise<string> {
	const body: unknown = await response.json().catch(() => ({}));
	if (isRecord(body) && isRecord(body.error)) {
		const msg = body.error.message;
		if (typeof msg === "string") return msg;
	}
	return fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
