import assert from "node:assert/strict";
import test from "node:test";

import { inspectRouteSource } from "../../lints/routes.mjs";

test("maintained routers must be constructed through the common factory, including aliased imports", () => {
	const imports =
		'import { Hono as Router } from "hono"; import { registerRouter as tracked } from "@superboard/contracts/route-registry";';
	assert.deepEqual(
		inspectRouteSource(
			`${imports} const routes = tracked(new Router(), group); routes.get("/ok", handler);`,
		),
		[],
	);
	assert.equal(
		inspectRouteSource(`${imports} const routes = new Router(); routes.get("/hidden", handler);`)[0]
			.code,
		"ROUTE_ROUTER_UNREGISTERED",
	);
	assert.equal(
		inspectRouteSource(`${imports} const routes = other(new Router(), group);`)[0].code,
		"ROUTE_ROUTER_UNREGISTERED",
	);
});
test("direct routing table mutations and low-level router additions are blocked", () => {
	assert.equal(
		inspectRouteSource('app.router.add("GET", "/hidden", handler);')[0].code,
		"ROUTE_ROUTER_BYPASS",
	);
	assert.equal(
		inspectRouteSource('app.routes.push({method: "GET", path: "/hidden", handler});')[0].code,
		"ROUTE_TABLE_MUTATION",
	);
	assert.deepEqual(
		inspectRouteSource('items.push(value); const routes = "/text is not registration";'),
		[],
	);
});

test("table aliases and indexed replacements cannot bypass route registration", () => {
	for (const source of [
		'const entries = app.routes; entries.push({ method: "GET", path: "/hidden", handler });',
		'app.routes[0] = { method: "GET", path: "/hidden", handler };',
		"app.routes = [];",
	])
		assert.ok(
			inspectRouteSource(source).some((failure) => failure.code === "ROUTE_TABLE_MUTATION"),
		);
});
