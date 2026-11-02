import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import express, { type Express } from "express";
import type { Request as ExpressRequest } from "express";

import { createServer } from "./server.js";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 100;

const ipRequests = new Map<string, number[]>();

setInterval(() => {
	const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
	for (const [ip, timestamps] of ipRequests) {
		const recent = timestamps.filter((t) => t > cutoff);
		if (recent.length === 0) ipRequests.delete(ip);
		else ipRequests.set(ip, recent);
	}
}, 300_000).unref();

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_VALIDATE_TIMEOUT_MS = 5_000;

const tokenCache = new Map<string, number>();

setInterval(() => {
	const now = Date.now();
	for (const [token, exp] of tokenCache) {
		if (exp <= now) tokenCache.delete(token);
	}
}, 60_000).unref();

function rateLimit(req: ExpressRequest, res: express.Response, next: express.NextFunction) {
	const ip = req.ip ?? "unknown";
	const now = Date.now();
	const cutoff = now - RATE_LIMIT_WINDOW_MS;

	const timestamps = ipRequests.get(ip) ?? [];
	const recent = timestamps.filter((t) => t > cutoff);

	if (recent.length >= RATE_LIMIT_MAX) {
		res.status(429).json({ error: "Too many requests. Try again later." });
		return;
	}

	recent.push(now);
	ipRequests.set(ip, recent);
	next();
}

export { ipRequests as _ipRequests };
export { tokenCache as _tokenCache };

export function createApp(superboardApiUrl: string, publicUrl: string): Express {
	const app = express();
	app.use(express.json({ limit: "1mb" }));
	const publicHostname = new URL(publicUrl).hostname;
	const allowedHostnames = new Set([publicHostname, "localhost", "127.0.0.1", "[::1]"]);

	app.use((req, res, next) => {
		const hostname = hostnameFromAuthority(req.headers.host);
		const origin = req.headers.origin;
		const originHostname = origin ? hostnameFromOrigin(origin) : null;
		if (
			!hostname ||
			!allowedHostnames.has(hostname) ||
			(origin && (!originHostname || !allowedHostnames.has(originHostname)))
		) {
			res.status(403).json({ error: "request_origin_not_allowed" });
			return;
		}
		next();
	});

	app.use((req, res, next) => {
		const start = Date.now();
		res.on("finish", () => {
			console.log(
				JSON.stringify({
					method: req.method,
					path: req.path,
					status: res.statusCode,
					ms: Date.now() - start,
				}),
			);
		});
		next();
	});

	app.get("/.well-known/oauth-protected-resource", (_req, res) => {
		res.json({
			resource: publicUrl,
			authorization_servers: [superboardApiUrl],
			scopes_supported: ["mcp:full"],
		});
	});

	app.get("/health", (_req, res) => {
		res.json({ status: "ok" });
	});

	function getToken(req: ExpressRequest): string | undefined {
		const authHeader = req.headers.authorization;
		return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
	}

	async function requireAuth(
		req: ExpressRequest & { auth?: AuthInfo },
		res: express.Response,
		next: express.NextFunction,
	) {
		const token = getToken(req);
		if (!token) {
			res
				.status(401)
				.set(
					"WWW-Authenticate",
					`Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
				)
				.json({ error: "Unauthorized" });
			return;
		}

		const cachedExp = tokenCache.get(token);
		if (cachedExp && cachedExp > Date.now()) {
			req.auth = { token, clientId: "mcp-client", scopes: [] };
			next();
			return;
		}

		let validateRes: Response;
		try {
			validateRes = await fetch(`${superboardApiUrl}/api/v1/mcp/validate`, {
				method: "GET",
				headers: { Authorization: `Bearer ${token}` },
				signal: AbortSignal.timeout(TOKEN_VALIDATE_TIMEOUT_MS),
			});
		} catch (err) {
			res.status(502).json({
				error: "bad_gateway",
				error_description: `Failed to validate token with backend: ${err instanceof Error ? err.message : String(err)}`,
			});
			return;
		}

		if (validateRes.ok) {
			tokenCache.set(token, Date.now() + TOKEN_CACHE_TTL_MS);
			req.auth = { token, clientId: "mcp-client", scopes: [] };
			next();
			return;
		}

		if (validateRes.status === 401) {
			const wwwAuth = validateRes.headers.get("WWW-Authenticate");
			if (wwwAuth) {
				res.set("WWW-Authenticate", wwwAuth);
			} else {
				res.set(
					"WWW-Authenticate",
					`Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
				);
			}
			const body = (await validateRes.json().catch(() => ({ error: "Unauthorized" }))) as unknown;
			res.status(401).json(body);
			return;
		}

		res.status(502).json({
			error: "bad_gateway",
			error_description: `Backend returned unexpected status ${validateRes.status}`,
		});
	}

	const mcpHandler = createMcpHandler(() => createServer(), {
		legacy: "stateless",
		responseMode: "auto",
		onerror: (error) =>
			console.error(JSON.stringify({ event: "mcp_protocol_error", error: error.message })),
	});
	app.post("/mcp", rateLimit, requireAuth, async (req, res) => {
		await handleMcpRequest(req, res, publicUrl, mcpHandler);
	});

	app.get("/mcp", rateLimit, requireAuth, async (req, res) => {
		await handleMcpRequest(req, res, publicUrl, mcpHandler);
	});

	app.delete("/mcp", rateLimit, requireAuth, async (req, res) => {
		await handleMcpRequest(req, res, publicUrl, mcpHandler);
	});

	return app;
}

async function handleMcpRequest(
	req: ExpressRequest & { auth?: AuthInfo },
	res: express.Response,
	publicUrl: string,
	handler: ReturnType<typeof createMcpHandler>,
): Promise<void> {
	try {
		const request = toWebRequest(req, publicUrl);
		const response = await handler.fetch(request, { authInfo: req.auth });
		res.status(response.status);
		response.headers.forEach((value, name) => res.setHeader(name, value));
		if (!response.body) {
			res.end();
			return;
		}
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!res.write(value)) {
				await new Promise<void>((resolve) => res.once("drain", resolve));
			}
		}
		res.end();
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "mcp_node_adapter_error",
				error: error instanceof Error ? error.message : String(error),
			}),
		);
		if (!res.headersSent) res.status(500).json({ error: "mcp_transport_error" });
		else res.end();
	}
}

function toWebRequest(req: ExpressRequest, publicUrl: string): globalThis.Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
		else if (value !== undefined) headers.set(name, value);
	}
	const method = req.method.toUpperCase();
	return new globalThis.Request(new URL(req.originalUrl || req.url, publicUrl), {
		method,
		headers,
		...(method === "GET" || method === "HEAD" || req.body === undefined
			? {}
			: { body: JSON.stringify(req.body) }),
	});
}

function hostnameFromAuthority(authority: string | undefined): string | null {
	if (!authority) return null;
	try {
		return new URL(`http://${authority}`).hostname;
	} catch {
		return null;
	}
}

function hostnameFromOrigin(origin: string): string | null {
	try {
		return new URL(origin).hostname;
	} catch {
		return null;
	}
}
