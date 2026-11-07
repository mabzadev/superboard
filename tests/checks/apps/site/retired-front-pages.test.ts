import { expect, test } from "vitest";

import { retiredFrontPageDestination } from "../../../../apps/site/src/lib/retired-front-pages.js";

test.each(["/app/members", "/app/members/"])(
	"redirects the retired members page %s to application users",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBe("/auth/users");
	},
);

test.each(["/app/users", "/app/memberships", "/app/members/details", "/app/customers"])(
	"keeps other user pages unchanged: %s",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBeNull();
	},
);

test.each(["/auth/orgs", "/auth/orgs/"])(
	"retires the removed organizations page %s in favor of access control settings",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBe("/auth/settings?tab=access");
	},
);

test.each(["/auth/saml", "/auth/saml/"])(
	"retires the removed SAML single sign-on page %s in favor of sign-in settings",
	(path) => {
		expect(retiredFrontPageDestination(path)).toBe("/auth/settings?tab=sign-in");
	},
);
