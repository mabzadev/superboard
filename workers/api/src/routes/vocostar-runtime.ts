import type { Env } from "../types.js";

export const VOCOSTAR_CALLBACK_PATHS = [
	"/internal/notify",
	"/ws/vocals/notify",
	"/ws/vocals/progress",
	"/ws/medias/notify",
	"/ws/medias/progress",
] as const;
export const VOCOSTAR_WEBSOCKET_PATHS = ["/ws/vocals", "/ws/medias"] as const;

export function isVocostarWebSocketPath(path: string): boolean {
	return VOCOSTAR_WEBSOCKET_PATHS.some((candidate) => candidate === path);
}

export async function proxyVocostarRuntime(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const callback =
		request.method === "POST" && VOCOSTAR_CALLBACK_PATHS.some((path) => path === url.pathname);
	const websocket = request.method === "GET" && isVocostarWebSocketPath(url.pathname);
	if (env.CUSTOM_WORKER_PLUGIN_ID !== "supbrd-plugmod-vocostar" || (!callback && !websocket)) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}
	if (!env.CUSTOM_WORKER) {
		return Response.json({ error: "vocostar_runtime_unavailable" }, { status: 503 });
	}
	const headers = new Headers();
	for (const name of [
		"content-type",
		"authorization",
		"upgrade",
		"sec-websocket-protocol",
		"x-vocostar-internal-token",
	]) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	try {
		return await env.CUSTOM_WORKER.fetch(
			new Request(`https://custom.internal${url.pathname}${url.search}`, {
				method: request.method,
				headers,
				body: callback ? request.body : null,
				redirect: "manual",
			}),
		);
	} catch {
		return Response.json({ error: "vocostar_runtime_unavailable" }, { status: 503 });
	}
}
