import assert from "node:assert/strict";
import test from "node:test";

import { siteDeploymentArtifact } from "./cloudflare-site-build.mjs";

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
