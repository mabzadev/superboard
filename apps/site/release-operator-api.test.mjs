import assert from "node:assert/strict";
import test from "node:test";

import { superboardReleaseOperatorApi } from "./release-operator-api.mjs";

test("injects every release operator endpoint below the authenticated EmDash API", () => {
	const routes = [];
	const integration = superboardReleaseOperatorApi();
	integration.hooks["astro:config:setup"]({
		injectRoute: (route) => routes.push(route),
	});
	assert.deepEqual(
		routes.map(({ pattern }) => pattern),
		[
			"/_emdash/api/superboard/releases/user-slice",
			"/_emdash/api/superboard/releases/compile",
			"/_emdash/api/superboard/releases/preview",
			"/_emdash/api/superboard/releases/approve",
			"/_emdash/api/superboard/releases/activate",
			"/_emdash/api/superboard/releases/rollback",
		],
	);
	assert.ok(routes.every(({ entrypoint }) => entrypoint.endsWith(".ts")));
});
