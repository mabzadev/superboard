import { describe, expect, it } from "vitest";

import { parsePublicEndpoints } from "../../../../apps/site/src/lib/public-endpoints.js";
describe("server-owned public endpoints", () => {
	it("keeps explicit target origins and leaves missing services absent", () => {
		expect(
			parsePublicEndpoints('{"sdk":"https://sdk.example.test/","mcp":"https://mcp.example.test"}'),
		).toEqual({ sdk: "https://sdk.example.test", mcp: "https://mcp.example.test" });
		expect(parsePublicEndpoints(undefined)).toEqual({});
	});
	it("rejects credentials, paths, scripts and malformed configuration", () => {
		for (const value of [
			"[]",
			'{"sdk":42}',
			'{"sdk":"https://user:secret@example.test"}',
			'{"sdk":"https://example.test/snippets"}',
			'{"mcp":"javascript:alert(1)"}',
			'{"unknown":"https://example.test"}',
		])
			expect(() => parsePublicEndpoints(value)).toThrow("PUBLIC_ENDPOINTS_INVALID");
	});
});
