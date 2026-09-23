import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizePublishedMenu } from "../../../fixtures/site-browser/published-menu-report.mjs";

const origin = "http://127.0.0.1:1234";
const discovered = [
	{ href: "/analytics", locale: "en" },
	{ href: "/analytics", locale: "fr" },
];
const passed = (locale) => ({
	url: `${origin}/analytics?lang=${locale}`,
	locale,
	status: "passed",
	errors: [],
});

await test("an unvisited translation cannot be reported as successful coverage", () => {
	const result = summarizePublishedMenu({
		origin,
		discovered,
		pages: [passed("en")],
		faults: [],
		errors: [],
	});
	assert.equal(result.complete, false);
	assert.equal(result.passed, 1);
	assert.deepEqual(result.unverified, [{ href: "/analytics", locale: "fr" }]);
});

await test("network errors override a mistakenly successful page status", () => {
	const page = { ...passed("fr"), errors: [{ kind: "http", symptom: "HTTP 503" }] };
	const result = summarizePublishedMenu({
		origin,
		discovered,
		pages: [passed("en"), page],
		faults: [],
		errors: [],
	});
	assert.equal(result.complete, false);
	assert.equal(result.failed, 1);
});

await test("expected defects are recorded separately from healthy menu coverage", () => {
	const input = {
		origin,
		discovered,
		pages: [passed("en"), passed("fr")],
		faults: [{ expected: "failed", result: { status: "failed", errors: [{ kind: "render" }] } }],
		errors: [],
	};
	assert.equal(summarizePublishedMenu(input).complete, true);
	input.faults[0].result.status = "passed";
	assert.equal(summarizePublishedMenu(input).complete, false);
});

await test("different query destinations stay unverified until each is executed", () => {
	const result = summarizePublishedMenu({
		origin,
		discovered: [
			{ href: "/acquisition/paywalls?item=one", locale: "en" },
			{ href: "/acquisition/paywalls?item=two", locale: "en" },
		],
		pages: [{ ...passed("en"), url: `${origin}/acquisition/paywalls?item=one&lang=en` }],
		faults: [],
		errors: [],
	});
	assert.deepEqual(result.unverified, [{ href: "/acquisition/paywalls?item=two", locale: "en" }]);
});
