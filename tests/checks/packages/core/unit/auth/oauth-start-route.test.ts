import { describe, it, expect, vi, afterEach } from "vitest";

import { GET as startOAuth } from "../../../../../../packages/core/src/astro/routes/api/auth/oauth/[provider].js";

function makeThrowingRuntimeLocals() {
	return {
		emdash: { db: {} as never, config: {} },
		get runtime() {
			return {
				get env(): never {
					throw new Error(
						"Astro.locals.runtime.env has been removed in Astro v6. Use 'import { env } from \"cloudflare:workers\"' instead.",
					);
				},
			};
		},
	};
}

describe("OAuth start route (#1736)", () => {
	afterEach(() => {
		vi.doUnmock("virtual:emdash/env");
		vi.resetModules();
	});

	it("does not throw when locals.runtime.env is a throwing getter (Astro 6+ Cloudflare)", async () => {
		const request = new Request("http://localhost:4321/_emdash/api/auth/oauth/google");

		const response = await startOAuth({
			params: { provider: "google" },
			request,
			locals: makeThrowingRuntimeLocals(),
			redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
		} as unknown as Parameters<typeof startOAuth>[0]);

		const location = response.headers.get("Location") ?? "";
		expect(location).toContain("error=provider_not_configured");
		expect(location).not.toContain("error=oauth_error");
	});

	it("reads provider credentials from the virtual:emdash/env module on Cloudflare", async () => {
		vi.resetModules();
		vi.doMock(
			"virtual:emdash/env",
			() => ({
				env: {
					EMDASH_OAUTH_GOOGLE_CLIENT_ID: "test-client-id",
					EMDASH_OAUTH_GOOGLE_CLIENT_SECRET: "test-client-secret",
				},
			}),
			{ virtual: true },
		);
		const { GET: startOAuthWithEnv } =
			await import("../../../../../../packages/core/src/astro/routes/api/auth/oauth/[provider].js");

		const request = new Request("http://localhost:4321/_emdash/api/auth/oauth/google");
		const response = await startOAuthWithEnv({
			params: { provider: "google" },
			request,
			locals: { emdash: { db: {} as never, config: {} } },
			redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
		} as unknown as Parameters<typeof startOAuth>[0]);

		const location = response.headers.get("Location") ?? "";
		expect(location).not.toContain("error=provider_not_configured");

		vi.doUnmock("virtual:emdash/env");
	});
});
