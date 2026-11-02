import { describe, expect, it, vi } from "vitest";

import { injectCoreRoutes } from "../../../../../../packages/core/src/astro/integration/routes.js";

describe("email settings route registration (#151)", () => {
	it("registers /_emdash/api/settings/email route", () => {
		const injectRoute = vi.fn();

		injectCoreRoutes(injectRoute);

		const patterns = injectRoute.mock.calls.map((call) => (call[0] as { pattern: string }).pattern);
		expect(patterns).toContain("/_emdash/api/settings/email");
	});
});
