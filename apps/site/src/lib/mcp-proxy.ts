import { SITE_OPERATOR_HEADERS } from "@superboard/contracts/site-operator";

const mcpPaths = new Set(["/mcp", "/mcp/health", "/.well-known/oauth-protected-resource/mcp"]);
export function isMcpPath(path: string): boolean {
	return mcpPaths.has(path);
}
export async function proxyMcpRequest(
	request: Request,
	service: { fetch(request: Request): Promise<Response> } | undefined,
	endpoint: string,
): Promise<Response> {
	const source = new URL(request.url);
	if (!isMcpPath(source.pathname)) return Response.json({ error: "not_found" }, { status: 404 });
	if (
		source.pathname === "/mcp" &&
		request.method === "GET" &&
		request.headers.get("Accept")?.includes("text/html")
	)
		return Response.redirect(new URL("/system/mcp", source), 302);
	if (!service) return Response.json({ error: "mcp_unavailable" }, { status: 503 });
	const publicUrl = new URL(endpoint);
	if (
		publicUrl.protocol !== "https:" ||
		publicUrl.pathname !== "/mcp" ||
		publicUrl.search ||
		publicUrl.hash ||
		publicUrl.username ||
		publicUrl.password
	)
		return Response.json({ error: "mcp_misconfigured" }, { status: 503 });
	const target = new URL(`${source.pathname}${source.search}`, publicUrl.origin);
	const headers = new Headers(request.headers);
	for (const name of [
		"Cookie",
		"Host",
		"X-SuperBoard-Site-Operator",
		"X-SuperBoard-Internal-Token",
		"X-EmDash-Request",
		SITE_OPERATOR_HEADERS.context,
		SITE_OPERATOR_HEADERS.signature,
	])
		headers.delete(name);
	headers.set("Host", publicUrl.host);
	try {
		return await service.fetch(new Request(new Request(target, request), { headers }));
	} catch {
		return Response.json({ error: "mcp_unavailable" }, { status: 503 });
	}
}
