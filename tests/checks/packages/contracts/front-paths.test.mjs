import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalFrontHref } from "../../../../packages/contracts/src/front-paths.ts";

test("renamed plugin links preserve detail IDs, queries and fragments", () => {
	for (const [before, after] of [
		[
			"/identity/fr/apps/app-42?tab=keys#secret",
			"/auth/settings?tab=apps&editor=apps&id=app-42&lang=fr#secret",
		],
		[
			"/identity/en/users/user-42",
			"/auth/users?tab=accounts&editor=users&id=user-42&section=directory&lang=en",
		],
		["/app/referrals", "/auth/users?tab=referrals"],
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
		"/auth/settings?tab=roles&editor=roles&id=new&lang=fr",
	);
});

test("authentication list bookmarks open their grouped tab without losing locale or fragments", () => {
	for (const [before, after] of [
		["/auth/customers?lang=fr#profile", "/auth/users?lang=fr&tab=profiles#profile"],
		["/identity/fr/apps", "/auth/settings?tab=apps&lang=fr"],
		["/auth/logs?lang=en", "/auth/settings?lang=en&tab=logs"],
		["/auth/saml", "/auth/settings?tab=login&section=sso"],
		["/auth/directory/users", "/auth/users?tab=accounts&section=directory"],
		["/auth", "/auth/users?tab=accounts"],
	]) {
		assert.equal(canonicalFrontHref(before), after);
		assert.equal(canonicalFrontHref(after), after);
	}
});

test("authentication editors preserve record identifiers and return to their owning view", () => {
	const collections = [
		["apps", "apps", "apps"],
		["apps/banners", "apps", "banners"],
		["roles", "roles", "roles"],
		["scopes", "permissions", "scopes"],
		["orgs", "organizations", "orgs"],
		["user-attributes", "fields", "fields"],
		["saml", "login", "saml"],
		["logs/email", "logs", "email"],
		["logs/sms", "logs", "sms"],
		["logs/sign-in", "logs", "sign-in"],
	];
	for (const [collection, tab, editor] of collections)
		for (const id of ["new", "item%2F42"]) {
			const href = canonicalFrontHref(`/auth/${collection}/${id}?lang=fr&source=bookmark#detail`);
			const destination = new URL(href, "https://example.test");
			assert.equal(destination.pathname, "/auth/settings");
			assert.equal(destination.searchParams.get("editor"), editor);
			assert.equal(destination.searchParams.get("tab"), tab);
			assert.equal(destination.searchParams.get("id"), decodeURIComponent(id));
			assert.equal(destination.searchParams.get("lang"), "fr");
			assert.equal(destination.searchParams.get("source"), "bookmark");
			assert.equal(destination.hash, "#detail");
			assert.equal(canonicalFrontHref(href), href);
		}
	assert.equal(canonicalFrontHref("/auth/account"), "/auth/settings?tab=security&editor=account");
	assert.equal(canonicalFrontHref("/auth/profile"), "/auth/settings?tab=security&editor=profile");
	assert.equal(
		canonicalFrontHref("/auth/register/with-email?invite=token"),
		"/auth/register?invite=token",
	);
});
