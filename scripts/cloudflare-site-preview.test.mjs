import assert from "node:assert/strict";
import test from "node:test";

import { resolveSitePreviewRoute } from "./cloudflare-site-preview.mjs";

test("the Site preview selection returns one exact route and one propagated CLI option", () => {
	assert.deepEqual(
		resolveSitePreviewRoute({
			requested: true,
			service: "site",
			environment: "development",
			hostname: "site.mbza.dev",
		}),
		{
			hostname: "site.mbza.dev",
			routes: [{ pattern: "site.mbza.dev", custom_domain: true }],
			cliArgs: ["--site-preview-route"],
		},
	);
	assert.equal(
		resolveSitePreviewRoute({
			requested: false,
			service: "site",
			environment: "development",
			hostname: "site.mbza.dev",
		}),
		null,
	);
});

test("the Site preview selection refuses every non-development or conflicting use", () => {
	for (const selection of [
		{ service: "api", environment: "development" },
		{ service: "site", environment: "production" },
		{ service: "site", environment: "development", noRoutes: true },
		{ service: "site", environment: "development", preflight: true },
	]) {
		assert.throws(
			() =>
				resolveSitePreviewRoute({
					requested: true,
					hostname: "site.mbza.dev",
					...selection,
				}),
			/site-preview-route/u,
		);
	}
});
