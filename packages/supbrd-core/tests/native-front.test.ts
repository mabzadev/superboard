import { describe, expect, test } from "vitest";

import { parseFrontNavigation } from "../src/native-front.js";

describe("native Front navigation", () => {
	test("normalizes navigation from an active legacy Release", () => {
		expect(
			parseFrontNavigation(
				[{ route_id: "superboard.app", label: "Application", permission: "app.read" }],
				[{ route_id: "superboard.app", path_pattern: "/app" }],
			),
		).toEqual([
			{
				group_id: "legacy",
				label: "Navigation",
				order: 0,
				items: [
					{
						route_id: "superboard.app",
						label: "Application",
						permission: "app.read",
						order: 0,
						href: "/app",
					},
				],
			},
		]);
	});
});
