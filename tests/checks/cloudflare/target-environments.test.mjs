import assert from "node:assert/strict";
import { test } from "node:test";

import {
	consoleEnvironmentCatalog,
	targetForEnvironment,
	validateEnvironmentIsolation,
} from "../../../scripts/cloudflare/target-environments.mjs";

const target = {
	target: "example",
	domains: { api: "api.dev.example", auth: "auth.dev.example", site: "console.dev.example" },
	applicationIdentity: { applicationAudience: "dev.application" },
	environments: {
		development: { d1: { id: "dev-db" } },
		production: {
			domains: { api: "api.example", auth: "auth.example", site: "console.example" },
			applicationIdentity: { applicationAudience: "production.application" },
			d1: { id: "production-db" },
		},
	},
};

test("one application materializes separate APIs, authentication and console destinations", () => {
	validateEnvironmentIsolation(target);
	assert.equal(targetForEnvironment(target, "production").domains.api, "api.example");
	assert.equal(
		targetForEnvironment(target, "development").applicationIdentity.applicationAudience,
		"dev.application",
	);
	assert.deepEqual(
		consoleEnvironmentCatalog(target, "development").map(({ apiUrl }) => apiUrl),
		["https://api.dev.example", "https://api.example"],
	);
	assert.equal(target.domains.api, "api.dev.example");
});
test("sharing an API or an authoritative store between deployment environments is rejected", () => {
	const sameDomain = structuredClone(target);
	delete sameDomain.environments.production.domains;
	assert.throws(() => validateEnvironmentIsolation(sameDomain), /ENVIRONMENT_DOMAIN_SHARED/);
	const sameStore = structuredClone(target);
	sameStore.environments.production.d1.id = "dev-db";
	assert.throws(() => validateEnvironmentIsolation(sameStore), /ENVIRONMENT_STORE_SHARED/);
});
