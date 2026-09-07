const productNamePattern = /SuperBoard/;
const adminLinkPattern = /href="\/_emdash\/admin"/;
const legacyTokenErrorPattern = /Invalid or expired token/;
import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.SUPERBOARD_TEST_BASE_URL;
if (!base) throw new Error("Run against an isolated local fixture with SUPERBOARD_TEST_BASE_URL");
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
	throw new Error("A local test fixture is required");

void test("operator home signs in through EmDash and remains available without a business plugin", async () => {
	const loggedOut = await fetch(new URL("/superboard-system/home", base), { redirect: "manual" });
	assert.equal(loggedOut.status, 302);
	assert.equal(new URL(loggedOut.headers.get("location"), base).pathname, "/_emdash/admin/login");
	const session = await fetch(new URL("/_emdash/api/setup/dev-bypass", base));
	assert.equal(session.status, 200);
	const cookie = session.headers
		.getSetCookie()
		.map((header) => header.split(";")[0])
		.join("; ");
	assert.ok(cookie);
	const home = await fetch(new URL("/superboard-system/home", base), {
		headers: { cookie },
		redirect: "manual",
	});
	assert.equal(home.status, 200);
	const html = await home.text();
	assert.match(html, productNamePattern);
	assert.match(html, adminLinkPattern);
	assert.doesNotMatch(html, legacyTokenErrorPattern);
});
