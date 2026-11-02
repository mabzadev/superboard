import { describe, expect, it, vi } from "vitest";

import { injectCoreRoutes } from "../../../../../../packages/core/src/astro/integration/routes.js";

interface InjectRouteCall {
	pattern: string;
	entrypoint: string;
}

describe("byline-fields route registration (Phase 4)", () => {
	function collectPatterns(): { patterns: string[]; ordered: InjectRouteCall[] } {
		const injectRoute = vi.fn();
		injectCoreRoutes(injectRoute);
		const calls = injectRoute.mock.calls.map((call) => call[0] as InjectRouteCall);
		return { patterns: calls.map((c) => c.pattern), ordered: calls };
	}

	it("registers list / create at /_emdash/api/admin/byline-fields", () => {
		const { patterns } = collectPatterns();
		expect(patterns).toContain("/_emdash/api/admin/byline-fields");
	});

	it("registers single-field CRUD at /_emdash/api/admin/byline-fields/[slug]", () => {
		const { patterns } = collectPatterns();
		expect(patterns).toContain("/_emdash/api/admin/byline-fields/[slug]");
	});

	it("registers reorder at /_emdash/api/admin/byline-fields/reorder", () => {
		const { patterns } = collectPatterns();
		expect(patterns).toContain("/_emdash/api/admin/byline-fields/reorder");
	});

	it("registers usage at /_emdash/api/admin/byline-fields/[slug]/usage", () => {
		const { patterns } = collectPatterns();
		expect(patterns).toContain("/_emdash/api/admin/byline-fields/[slug]/usage");
	});

	it("registers the static `reorder` route before the dynamic `[slug]` route", () => {
		const { patterns } = collectPatterns();
		const reorderIdx = patterns.indexOf("/_emdash/api/admin/byline-fields/reorder");
		const slugIdx = patterns.indexOf("/_emdash/api/admin/byline-fields/[slug]");
		expect(reorderIdx).toBeGreaterThanOrEqual(0);
		expect(slugIdx).toBeGreaterThanOrEqual(0);
		expect(reorderIdx).toBeLessThan(slugIdx);
	});
});
