import assert from "node:assert/strict";
import test from "node:test";

import { siteDeploymentArtifact, siteEmailBuildEnvironment } from "./cloudflare-site-build.mjs";
import { loadTarget } from "./cloudflare-target.mjs";

test("Site deployment uses the built Astro Wrangler artifact without claiming traffic", () => {
	const artifact = siteDeploymentArtifact({
		$schema: "../../node_modules/wrangler/config-schema.json",
		main: "../../apps/site/dist/server/entry.mjs",
		assets: { binding: "ASSETS", directory: "../../apps/site/dist/client" },
		vars: { SUPERBOARD_RELEASE_OPERATIONS: "disabled" },
		d1_databases: [{ binding: "DB", migrations_dir: "../../apps/site/migrations" }],
	});
	assert.equal(artifact.main, "entry.mjs");
	assert.equal(artifact.assets.directory, "../client");
	assert.equal(artifact.d1_databases[0].migrations_dir, "../../migrations");
	assert.equal(artifact.routes, undefined);
	assert.throws(
		() =>
			siteDeploymentArtifact({
				vars: { SUPERBOARD_RELEASE_OPERATIONS: "enabled" },
				d1_databases: [],
			}),
		/must keep release operations disabled/u,
	);
});

test("Site deployment preserves only the explicitly approved development preview route", () => {
	const config = {
		$schema: "../../node_modules/wrangler/config-schema.json",
		main: "../../apps/site/dist/server/entry.mjs",
		assets: { binding: "ASSETS", directory: "../../apps/site/dist/client" },
		vars: { SUPERBOARD_RELEASE_OPERATIONS: "disabled" },
		d1_databases: [{ binding: "DB", migrations_dir: "../../apps/site/migrations" }],
		routes: [{ pattern: "site.mbza.dev", custom_domain: true }],
	};
	assert.deepEqual(siteDeploymentArtifact(config, { previewHostname: "site.mbza.dev" }).routes, [
		{ pattern: "site.mbza.dev", custom_domain: true },
	]);
	assert.throws(() => siteDeploymentArtifact(config), /must not acquire a public route/u);
	assert.throws(
		() =>
			siteDeploymentArtifact(config, {
				previewHostname: "board.mbza.dev",
			}),
		/approved preview hostname/u,
	);
});

test("Site email plugin build settings come from the selected target", async () => {
	const development = (await loadTarget("mbza-development")).target;
	const production = (await loadTarget("vocostar")).target;
	expectSiteEmailEnvironment(siteEmailBuildEnvironment(development, {}), {
		SUPERBOARD_SITE_EMAIL_FROM_ADDRESS: "noreply@mbza.dev",
		SUPERBOARD_SITE_EMAIL_FROM_NAME: "SuperBoard Development",
		SUPERBOARD_SITE_EMAIL_REPLY_TO: "support@mbza.dev",
	});
	expectSiteEmailEnvironment(siteEmailBuildEnvironment(production, {}), {
		SUPERBOARD_SITE_EMAIL_FROM_ADDRESS: "noreply@vocostar.com",
		SUPERBOARD_SITE_EMAIL_FROM_NAME: "SuperBoard",
	});
});

test("Site deployment preserves enabled Release operations only for the approved preview build", () => {
	const config = {
		main: "../../apps/site/dist/server/entry.mjs",
		assets: { binding: "ASSETS", directory: "../../apps/site/dist/client" },
		vars: { SUPERBOARD_RELEASE_OPERATIONS: "enabled" },
		d1_databases: [{ binding: "DB", migrations_dir: "../../apps/site/migrations" }],
		routes: [{ pattern: "site.mbza.dev", custom_domain: true }],
	};
	assert.equal(
		siteDeploymentArtifact(config, {
			previewHostname: "site.mbza.dev",
			releaseOperations: true,
		}).vars.SUPERBOARD_RELEASE_OPERATIONS,
		"enabled",
	);
	assert.throws(
		() => siteDeploymentArtifact(config, { previewHostname: "site.mbza.dev" }),
		/must keep release operations disabled/u,
	);
});

function expectSiteEmailEnvironment(actual, expected) {
	assert.deepEqual(actual, expected);
}
