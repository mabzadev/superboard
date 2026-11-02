import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { setDefaultDnsResolver } from "../../../../../../packages/core/src/import/ssrf.js";
import {
	createHttpAccess,
	createUnrestrictedHttpAccess,
} from "../../../../../../packages/core/src/plugins/context.js";

const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

const STUB_RESOLVER = async () => ["93.184.216.34"];
let previousResolver: ReturnType<typeof setDefaultDnsResolver> | undefined;

beforeAll(() => {
	previousResolver = setDefaultDnsResolver(STUB_RESOLVER);
});

afterAll(() => {
	setDefaultDnsResolver(previousResolver ?? null);
});

afterEach(() => {
	mockFetch.mockReset();
});

function redirectResponse(location: string, status = 302): Response {
	return new Response(null, {
		status,
		headers: { Location: location },
	});
}

function okResponse(body = "ok"): Response {
	return new Response(body, { status: 200 });
}

function headersOfCall(callIndex: number): Headers {
	const init = mockFetch.mock.calls[callIndex]?.[1] as RequestInit | undefined;
	return new Headers(init?.headers);
}

describe("createHttpAccess host allowlist matching", () => {
	const pluginId = "test-plugin";

	it('allows any hostname when allowedHosts contains standalone "*"', async () => {
		mockFetch.mockResolvedValue(okResponse());

		const http = createHttpAccess(pluginId, ["*"]);
		await expect(http.fetch("https://api.example.com/v1")).resolves.toBeInstanceOf(Response);
		await expect(http.fetch("https://random.host.io/path")).resolves.toBeInstanceOf(Response);
	});

	it('allows requests when "*" is mixed with explicit hosts', async () => {
		mockFetch.mockResolvedValue(okResponse());

		const http = createHttpAccess(pluginId, ["*", "api.example.com"]);
		await expect(http.fetch("https://another.example.net/ok")).resolves.toBeInstanceOf(Response);
	});

	it('still supports "*.domain" wildcard matching', async () => {
		mockFetch.mockResolvedValue(okResponse());

		const http = createHttpAccess(pluginId, ["*.example.com"]);
		await expect(http.fetch("https://api.example.com/v1")).resolves.toBeInstanceOf(Response);
		await expect(http.fetch("https://evil.com")).rejects.toThrow(
			'is not allowed to fetch from host "evil.com"',
		);
	});
});

describe("createHttpAccess credential stripping", () => {
	const pluginId = "test-plugin";
	const allowedHosts = ["a.example.com", "b.example.com"];

	it("preserves credentials on same-origin redirect", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://a.example.com/page2"))
			.mockResolvedValueOnce(okResponse());

		const http = createHttpAccess(pluginId, allowedHosts);
		await http.fetch("https://a.example.com/page1", {
			headers: { Authorization: "Bearer secret", Cookie: "session=abc" },
		});

		const h = headersOfCall(1);
		expect(h.get("authorization")).toBe("Bearer secret");
		expect(h.get("cookie")).toBe("session=abc");
	});

	it("strips credentials on cross-origin redirect", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://b.example.com/landing"))
			.mockResolvedValueOnce(okResponse());

		const http = createHttpAccess(pluginId, allowedHosts);
		await http.fetch("https://a.example.com/start", {
			headers: {
				Authorization: "Bearer secret",
				Cookie: "session=abc",
				"Proxy-Authorization": "Basic creds",
				"X-Custom": "keep-me",
			},
		});

		const h = headersOfCall(1);
		expect(h.get("authorization")).toBeNull();
		expect(h.get("cookie")).toBeNull();
		expect(h.get("proxy-authorization")).toBeNull();
		expect(h.get("x-custom")).toBe("keep-me");
	});

	it("strips credentials only once even with multiple same-origin hops after cross-origin", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://b.example.com/step1"))
			.mockResolvedValueOnce(redirectResponse("https://b.example.com/step2"))
			.mockResolvedValueOnce(okResponse());

		const http = createHttpAccess(pluginId, allowedHosts);
		await http.fetch("https://a.example.com/start", {
			headers: { Authorization: "Bearer secret" },
		});

		expect(headersOfCall(0).get("authorization")).toBe("Bearer secret");
		expect(headersOfCall(1).get("authorization")).toBeNull();
		expect(headersOfCall(2).get("authorization")).toBeNull();
	});
});

describe("createUnrestrictedHttpAccess credential stripping", () => {
	const pluginId = "unrestricted-plugin";

	it("preserves credentials on same-origin redirect", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://api.example.com/v2"))
			.mockResolvedValueOnce(okResponse());

		const http = createUnrestrictedHttpAccess(pluginId);
		await http.fetch("https://api.example.com/v1", {
			headers: { Authorization: "Bearer token" },
		});

		expect(headersOfCall(1).get("authorization")).toBe("Bearer token");
	});

	it("strips credentials on cross-origin redirect", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://evil.example.com/steal"))
			.mockResolvedValueOnce(okResponse());

		const http = createUnrestrictedHttpAccess(pluginId);
		await http.fetch("https://api.example.com/start", {
			headers: {
				Authorization: "Bearer token",
				Cookie: "session=xyz",
				"Proxy-Authorization": "Basic pw",
				Accept: "application/json",
			},
		});

		const h = headersOfCall(1);
		expect(h.get("authorization")).toBeNull();
		expect(h.get("cookie")).toBeNull();
		expect(h.get("proxy-authorization")).toBeNull();
		expect(h.get("accept")).toBe("application/json");
	});

	it("handles redirect with no init gracefully", async () => {
		mockFetch
			.mockResolvedValueOnce(redirectResponse("https://other.example.com/"))
			.mockResolvedValueOnce(okResponse());

		const http = createUnrestrictedHttpAccess(pluginId);
		await http.fetch("https://api.example.com/bare");

		expect(headersOfCall(1).get("authorization")).toBeNull();
	});
});
