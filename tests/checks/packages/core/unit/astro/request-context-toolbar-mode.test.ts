import { describe, it, expect, vi } from "vitest";

type Middleware = (context: unknown, next: () => Promise<Response>) => Promise<Response> | Response;

async function loadMiddleware(toolbar: unknown): Promise<Middleware> {
	vi.resetModules();
	vi.doMock("astro:middleware", () => ({
		defineMiddleware: (handler: unknown) => handler,
	}));
	vi.doMock("virtual:emdash/config", () => ({ default: { toolbar } }));
	const mod =
		await import("../../../../../../packages/core/src/astro/middleware/request-context.js");
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- test harness casts the middleware to a plain function
	return mod.default as unknown as Middleware;
}

function buildContext(opts: {
	pathname?: string;
	search?: string;
	user?: { id: string; role: number } | null;
	editCookie?: boolean;
}) {
	const url = new URL(`https://example.com${opts.pathname ?? "/blog"}${opts.search ?? ""}`);
	return {
		request: new Request(url),
		url,
		cache: { set: vi.fn() },
		cookies: {
			get: vi.fn((name: string) =>
				name === "emdash-edit-mode" && opts.editCookie ? { value: "true" } : undefined,
			),
			set: vi.fn(),
		},
		locals: { user: opts.user ?? null },
	};
}

const htmlResponse = () =>
	new Response("<html><body>hello</body></html>", {
		headers: { "content-type": "text/html" },
	});

const EDITOR = { id: "u1", role: 30 };

describe("toolbar: server (default)", () => {
	it("injects the toolbar for editors and leaves anonymous HTML untouched", async () => {
		const onRequest = await loadMiddleware(undefined);

		const editorRes = await onRequest(buildContext({ user: EDITOR }), async () => htmlResponse());
		expect(await editorRes.text()).toContain('id="emdash-toolbar"');
		expect(editorRes.headers.get("Cache-Control")).toBe("private, no-store");

		const anonRes = await onRequest(buildContext({}), async () => htmlResponse());
		const anonHtml = await anonRes.text();
		expect(anonHtml).not.toContain("emdash-toolbar");
		expect(anonRes.headers.get("Cache-Control")).toBeNull();
	});

	it("ignores the _edit param entirely", async () => {
		const onRequest = await loadMiddleware(undefined);
		const res = await onRequest(buildContext({ search: "?_edit=1" }), async () => htmlResponse());
		expect(res.status).toBe(200);
	});
});

describe("toolbar: client", () => {
	it("injects the identical bootstrap into anonymous HTML without touching cache headers", async () => {
		const onRequest = await loadMiddleware("client");
		const context = buildContext({});
		const res = await onRequest(context, async () => htmlResponse());
		const html = await res.text();
		expect(html).toContain("emdash-toolbar-bootstrap");
		expect(html).not.toContain('id="emdash-toolbar"');
		expect(res.headers.get("Cache-Control")).toBeNull();
		expect(context.cache.set).not.toHaveBeenCalled();
	});

	it("serves editors the same bootstrap variant when no _edit param is present", async () => {
		const onRequest = await loadMiddleware("client");

		const editorRes = await onRequest(buildContext({ user: EDITOR }), async () => htmlResponse());
		const anonRes = await onRequest(buildContext({}), async () => htmlResponse());

		expect(await editorRes.text()).toBe(await anonRes.text());
		expect(editorRes.headers.get("Cache-Control")).toBeNull();
	});

	it("renders the full server toolbar for editors on _edit requests, uncacheable", async () => {
		const onRequest = await loadMiddleware("client");
		const context = buildContext({ user: EDITOR, search: "?_edit=1" });
		const res = await onRequest(context, async () => htmlResponse());
		const html = await res.text();
		expect(html).toContain('id="emdash-toolbar"');
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		expect(context.cache.set).toHaveBeenCalledWith(false);
	});

	it("redirects non-editors on _edit URLs to the canonical URL without rendering", async () => {
		const onRequest = await loadMiddleware("client");
		const next = vi.fn(async () => htmlResponse());

		for (const user of [null, { id: "u2", role: 20 }]) {
			const context = buildContext({ user, search: "?_edit=1&page=2", pathname: "/blog" });
			const res = await onRequest(context, next);
			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe("/blog?page=2");
			expect(context.cache.set).toHaveBeenCalledWith(false);
			expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		}
		expect(next).not.toHaveBeenCalled();
	});

	it("still injects the server toolbar for editors in active edit mode (cookie)", async () => {
		const onRequest = await loadMiddleware("client");
		const res = await onRequest(buildContext({ user: EDITOR, editCookie: true }), async () =>
			htmlResponse(),
		);
		expect(await res.text()).toContain('id="emdash-toolbar"');
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("serves the bootstrap variant for a stale edit cookie without a session", async () => {
		const onRequest = await loadMiddleware("client");
		const res = await onRequest(buildContext({ editCookie: true }), async () => htmlResponse());
		const html = await res.text();
		expect(html).toContain("emdash-toolbar-bootstrap");
		expect(html).not.toContain('id="emdash-toolbar"');
	});
});

describe("toolbar bootstrap script", () => {
	it("generates syntactically valid JavaScript", async () => {
		const { renderToolbarBootstrap } =
			await import("../../../../../../packages/core/src/visual-editing/toolbar-bootstrap.js");
		const html = renderToolbarBootstrap();
		const open = html.indexOf("<script>");
		const close = html.lastIndexOf("</script>");
		expect(open).toBeGreaterThanOrEqual(0);
		expect(close).toBeGreaterThan(open);
		const script = html.slice(open + "<script>".length, close);
		expect(script.trim()).toBeTruthy();
		// eslint-disable-next-line typescript/no-implied-eval -- deliberate parse-only syntax check of generated script, never invoked
		expect(() => new Function(script)).not.toThrow();
	});
});

describe("toolbar: false", () => {
	it("renders neither the toolbar nor the bootstrap for anyone", async () => {
		const onRequest = await loadMiddleware(false);

		for (const user of [null, EDITOR]) {
			const res = await onRequest(buildContext({ user }), async () => htmlResponse());
			const html = await res.text();
			expect(html).not.toContain("emdash-toolbar");
			expect(res.headers.get("Cache-Control")).toBeNull();
		}
	});
});
