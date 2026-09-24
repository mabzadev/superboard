import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalFrontHref } from "../../../../packages/contracts/src/front-paths.ts";

test("renamed plugin links preserve detail IDs, queries and fragments", () => {
	for (const [before, after] of [
		["/identity/fr/apps/app-42?tab=keys#secret", "/auth/apps/app-42?tab=keys&lang=fr#secret"],
		["/identity/en/users/user-42", "/auth/directory/users/user-42?lang=en"],
		["/app/referrals", "/auth/referrals"],
		["/system/files", "/data/files"],
		["/products/offerings", "/monetization/offerings"],
		["/products/products", "/monetization/products/products"],
		["/marketing/email", "/communication/marketing-email"],
		["/flows/workflows/workflow-42", "/acquisition/workflows/workflow-42"],
		["/onboardings/statistics", "/acquisition/onboardings/statistics"],
		["/app/ios-setup", "/core/ios-setup"],
		["/system/audit", "/core/audit"],
	])
		assert.equal(canonicalFrontHref(before), after);
});

test("canonical links are stable and unrelated or external URLs are untouched", () => {
	for (const href of [
		"/auth/users?lang=fr",
		"/support/inbox",
		"/analytics/events",
		"/api/v1/products",
		"/_emdash/admin/login",
		"https://example.com/identity/fr/apps",
		"//example.com/flows",
		"#section",
		"/flows-other",
	]) {
		assert.equal(canonicalFrontHref(href), href);
	}
	assert.equal(
		canonicalFrontHref(canonicalFrontHref("/identity/fr/roles/new")),
		"/auth/roles/new?lang=fr",
	);
});
