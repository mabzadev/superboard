import { describe, it, expect, vi } from "vitest";

vi.mock("astro:middleware", () => ({
	defineMiddleware: (handler: unknown) => handler,
}));

import onRequest from "../../../../../../packages/core/src/astro/middleware/request-context.js";

function buildContext(opts: {
	pathname?: string;
	search?: string;
	user?: { id: string; role: number } | null;
	editCookie?: boolean;
	cache: { set: (input: unknown) => void };
}) {
	const url = new URL(`https://example.com${opts.pathname ?? "/blog"}${opts.search ?? ""}`);
	return {
		request: new Request(url),
		url,
		cookies: {
			get: vi.fn((name: string) =>
				name === "emdash-edit-mode" && opts.editCookie ? { value: "true" } : undefined,
			),
			set: vi.fn(),
		},
		locals: { user: opts.user ?? null },
		cache: opts.cache,
	} as unknown as Parameters<typeof onRequest>[0];
}

const htmlResponse = () =>
	new Response("<html><body>hello</body></html>", {
		headers: { "content-type": "text/html" },
	});

describe("route-cache opt-out for preview and toolbar responses", () => {
	it("opts out of the route cache when a _preview param is present", async () => {
		const cache = { set: vi.fn() };
		const context = buildContext({ search: "?_preview=some-token", cache });

		await onRequest(context, async () => htmlResponse());

		expect(cache.set).toHaveBeenCalledWith(false);
	});

	it("opts out of the route cache when the toolbar is injected", async () => {
		const cache = { set: vi.fn() };
		const context = buildContext({ user: { id: "u1", role: 30 }, cache });

		const response = await onRequest(context, async () => htmlResponse());

		expect(await response.text()).toContain('id="emdash-toolbar"');
		expect(cache.set).toHaveBeenCalledWith(false);
	});

	it("leaves the route cache alone for editor requests without injection (non-HTML)", async () => {
		const cache = { set: vi.fn() };
		const context = buildContext({
			pathname: "/api/data.json",
			user: { id: "u1", role: 30 },
			cache,
		});

		await onRequest(
			context,
			async () => new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
		);

		expect(cache.set).not.toHaveBeenCalled();
	});

	it("leaves the route cache alone for anonymous requests without CMS signals", async () => {
		const cache = { set: vi.fn() };
		const context = buildContext({ cache });

		await onRequest(context, async () => htmlResponse());

		expect(cache.set).not.toHaveBeenCalled();
	});
});
