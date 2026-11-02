import { describe, it, expect } from "vitest";

import { requireScope } from "../../../../../../packages/core/src/auth/scopes.js";

describe("requireScope", () => {
	it("allows session auth (no tokenScopes) unconditionally", () => {
		const result = requireScope({}, "content:write");
		expect(result).toBeNull();
	});

	it("allows session auth with undefined tokenScopes", () => {
		const result = requireScope({ tokenScopes: undefined }, "schema:write");
		expect(result).toBeNull();
	});

	it("allows when token has the required scope", () => {
		const result = requireScope(
			{ tokenScopes: ["content:read", "content:write"] },
			"content:write",
		);
		expect(result).toBeNull();
	});

	it("rejects when token lacks the required scope", () => {
		const result = requireScope({ tokenScopes: ["content:read"] }, "content:write");
		expect(result).toBeInstanceOf(Response);
		expect(result!.status).toBe(403);
	});

	it("returns INSUFFICIENT_SCOPE error body", async () => {
		const result = requireScope({ tokenScopes: ["media:read"] }, "schema:write");
		expect(result).not.toBeNull();
		const body = (await result!.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
		expect(body.error.message).toContain("schema:write");
	});

	it("admin scope grants access to everything", () => {
		expect(requireScope({ tokenScopes: ["admin"] }, "content:read")).toBeNull();
		expect(requireScope({ tokenScopes: ["admin"] }, "content:write")).toBeNull();
		expect(requireScope({ tokenScopes: ["admin"] }, "schema:read")).toBeNull();
		expect(requireScope({ tokenScopes: ["admin"] }, "schema:write")).toBeNull();
		expect(requireScope({ tokenScopes: ["admin"] }, "media:read")).toBeNull();
		expect(requireScope({ tokenScopes: ["admin"] }, "media:write")).toBeNull();
	});

	it("empty scopes array rejects everything", () => {
		expect(requireScope({ tokenScopes: [] }, "content:read")).toBeInstanceOf(Response);
		expect(requireScope({ tokenScopes: [] }, "admin")).toBeInstanceOf(Response);
	});

	it("read scope does not grant write access", () => {
		expect(requireScope({ tokenScopes: ["content:read"] }, "content:write")).toBeInstanceOf(
			Response,
		);
		expect(requireScope({ tokenScopes: ["media:read"] }, "media:write")).toBeInstanceOf(Response);
		expect(requireScope({ tokenScopes: ["schema:read"] }, "schema:write")).toBeInstanceOf(Response);
	});

	describe("backwards compatibility: content:write implicit grants", () => {
		it("content:write grants menus:manage", () => {
			expect(requireScope({ tokenScopes: ["content:write"] }, "menus:manage")).toBeNull();
		});

		it("content:write grants taxonomies:manage", () => {
			expect(requireScope({ tokenScopes: ["content:write"] }, "taxonomies:manage")).toBeNull();
		});

		it("content:read does NOT grant menus:manage (read-only doesn't escalate)", () => {
			expect(requireScope({ tokenScopes: ["content:read"] }, "menus:manage")).toBeInstanceOf(
				Response,
			);
		});

		it("menus:manage alone allows menu operations", () => {
			expect(requireScope({ tokenScopes: ["menus:manage"] }, "menus:manage")).toBeNull();
		});

		it("menus:manage does not grant content:write (no reverse implication)", () => {
			expect(requireScope({ tokenScopes: ["menus:manage"] }, "content:write")).toBeInstanceOf(
				Response,
			);
		});

		it("taxonomies:manage alone allows taxonomy operations", () => {
			expect(requireScope({ tokenScopes: ["taxonomies:manage"] }, "taxonomies:manage")).toBeNull();
		});

		it("prototype-chain keys do not crash or grant access", () => {
			for (const key of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
				expect(requireScope({ tokenScopes: [key] }, "menus:manage")).toBeInstanceOf(Response);
			}
		});
	});
});
