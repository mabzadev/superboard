import { expect, test } from "vitest";

import { retiredFrontPageDestination } from "../../../../apps/site/src/lib/retired-front-pages.js";

test.each(["/app/members", "/app/members/"])(
	"redirects the retired members page %s to application users",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBe("/app/users");
	},
);

test.each(["/app/users", "/app/memberships", "/app/members/details", "/app/customers"])(
	"keeps other user pages unchanged: %s",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBeNull();
	},
);
