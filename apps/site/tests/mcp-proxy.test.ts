import { expect, test } from "vitest";

import { isMcpPath, proxyMcpRequest } from "../src/lib/mcp-proxy.js";

test("MCP forwarding preserves protocol and streaming without sending console cookies", async () => {
	const backend = new Response("event: message\ndata: connected\n\n", {
		status: 401,
		headers: {
			"Content-Type": "text/event-stream",
			"WWW-Authenticate":
				'Bearer resource_metadata="https://board.test/.well-known/oauth-protected-resource/mcp"',
		},
	});
	const service = {
		fetch: async (request: Request) => {
			expect(request.url).toBe("https://board.test/mcp");
			expect(request.method).toBe("POST");
			expect(request.headers.get("Authorization")).toBe("Bearer token");
			expect(request.headers.get("MCP-Protocol-Version")).toBe("2025-11-25");
			expect(request.headers.get("Cookie")).toBeNull();
			expect(await request.text()).toBe('{"method":"initialize"}');
			return backend;
		},
	};
	const response = await proxyMcpRequest(
		new Request("http://127.0.0.1/mcp", {
			method: "POST",
			headers: {
				Cookie: "emdash-session=private",
				Authorization: "Bearer token",
				"MCP-Protocol-Version": "2025-11-25",
			},
			body: '{"method":"initialize"}',
		}),
		service,
		"https://board.test/mcp",
	);
	expect(response).toBe(backend);
	expect(response.headers.get("WWW-Authenticate")).toContain("/oauth-protected-resource/mcp");
	expect(isMcpPath("/mcp/authorize")).toBe(false);
	expect(isMcpPath("/system/mcp")).toBe(false);
});
test("browser navigation retains access to the MCP management screen", async () => {
	const response = await proxyMcpRequest(
		new Request("https://board.test/mcp", { headers: { Accept: "text/html" } }),
		undefined,
		"https://board.test/mcp",
	);
	expect(response.status).toBe(302);
	expect(response.headers.get("Location")).toBe("https://board.test/system/mcp");
});
