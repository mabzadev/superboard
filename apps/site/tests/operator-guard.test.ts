import { describe, expect, test } from "vitest";

import { requireReleaseOperator } from "../src/lib/operator-guard.js";

function context(options: { role?: number; origin?: string; marker?: string } = {}) {
	return {
		locals: options.role === undefined ? {} : { user: { role: options.role } },
		request: new Request("https://site.example/superboard-system/api/releases/compile", {
			method: "POST",
			headers: {
				Origin: options.origin ?? "https://site.example",
				"X-SuperBoard-Request": options.marker ?? "1",
			},
		}),
		url: new URL("https://site.example/superboard-system/api/releases/compile"),
	} as Parameters<typeof requireReleaseOperator>[0];
}

const disabledEnv = { SUPERBOARD_RELEASE_OPERATIONS: "disabled" } as Parameters<
	typeof requireReleaseOperator
>[1];
const enabledEnv = { SUPERBOARD_RELEASE_OPERATIONS: "enabled" } as Parameters<
	typeof requireReleaseOperator
>[1];

describe("Release operator guard", () => {
	test("fails closed before a release mutation can reach D1", async () => {
		expect(requireReleaseOperator(context(), enabledEnv)?.status).toBe(401);
		expect(requireReleaseOperator(context({ role: 40 }), enabledEnv)?.status).toBe(403);
		expect(requireReleaseOperator(context({ role: 50 }), disabledEnv)?.status).toBe(503);
		expect(
			requireReleaseOperator(context({ role: 50, origin: "https://other.example" }), enabledEnv)
				?.status,
		).toBe(403);
		expect(requireReleaseOperator(context({ role: 50 }), enabledEnv)).toBeNull();
	});
});
