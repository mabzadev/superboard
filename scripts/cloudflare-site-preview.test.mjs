import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveSitePreviewRoute,
	resolveSiteReleaseOperations,
} from "./cloudflare-site-preview.mjs";

const RELEASE_OPERATIONS_PATTERN = /--release-operations/u;

test("Release operations require an explicit opt-in on a local Site or development preview", () => {
	for (const selection of [
		{ service: "site", environment: "local" },
		{
			service: "site",
			environment: "development",
			sitePreviewRoute: { hostname: "site.example.com" },
		},
	]) {
		assert.equal(
			resolveSiteReleaseOperations({ ...selection, requested: false }).value,
			"disabled",
		);
		assert.equal(resolveSiteReleaseOperations({ ...selection, requested: true }).value, "enabled");
	}
	for (const selection of [
		{ service: "api", environment: "local" },
		{ service: "site", environment: "development" },
		{
			service: "site",
			environment: "production",
			sitePreviewRoute: { hostname: "site.example.com" },
		},
	]) {
		assert.throws(
			() => resolveSiteReleaseOperations({ ...selection, requested: true }),
			RELEASE_OPERATIONS_PATTERN,
		);
	}
});

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
