import { describe, it, expect, vi } from "vitest";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));

import onRequest from "../../../../../../packages/core/src/astro/middleware/request-context.js";

function editorRequestContext(pathname = "/blog") {
	return {
		request: new Request(`https://example.com${pathname}`),
		url: new URL(`https://example.com${pathname}`),
		cookies: { get: vi.fn(() => undefined), set: vi.fn() },
		locals: { user: { id: "u1", role: 30 } },
		cache: { set: vi.fn() },
	} as unknown as Parameters<typeof onRequest>[0];
}

describe("editor toolbar injection cache headers (issue #1398)", () => {
	it("sets Cache-Control: private, no-store on toolbar-injected HTML", async () => {
		const context = editorRequestContext();

		const response = await onRequest(
			context,
			async () =>
				new Response("<html><body>hello</body></html>", {
					headers: { "content-type": "text/html" },
				}),
		);

		const body = await response.text();
		expect(body).toContain('id="emdash-toolbar"');
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("does not force no-store on non-HTML responses (no toolbar injected)", async () => {
		const context = editorRequestContext("/api/data.json");

		const response = await onRequest(
			context,
			async () =>
				new Response('{"ok":true}', {
					headers: { "content-type": "application/json" },
				}),
		);

		expect(response.headers.get("Cache-Control")).toBeNull();
	});
});
