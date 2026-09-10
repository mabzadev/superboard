import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { expectedGeneratedFiles } from "../../../scripts/emdash/overlay.mjs";
import {
	loadDeploymentMatrix,
	selectDeployments,
	validateDeploymentConfiguration,
} from "../../../scripts/github/deployment-matrix.mjs";

test("root regeneration preserves the explicitly disabled automatic CI", async () => {
	const files = await expectedGeneratedFiles();
	assert.ok(![...files.keys()].some((path) => path.startsWith(".github/workflows/")));
	const manifest = JSON.parse(files.get("package.json"));
	for (const command of Object.values(manifest.scripts))
		assert.doesNotMatch(command, /apps\/dashboard|dashboard-cloudflare/u);
	assert.ok(manifest.scripts["front:test"]);
	assert.ok(manifest.scripts["site:build"]);
});

test("configured development builds deploy the Site without an application deployment", async () => {
	const configuration = await loadDeploymentMatrix();
	assert.equal(validateDeploymentConfiguration(configuration), true);
	const targets = selectDeployments(configuration, "dev");
	assert.ok(targets.matrix.include.every((entry) => entry.cloudflareEnvironment === "development"));
	assert.throws(
		() => selectDeployments(configuration, "main", { authority: "github-actions" }),
		/No Cloudflare deployment/,
	);
	const definitions = JSON.stringify(configuration);
	assert.doesNotMatch(definitions, /apps\/dashboard|opennextjs/u);
	const root = JSON.parse(
		await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
	);
	assert.equal(
		Object.keys(root.scripts).some((name) => name.startsWith("dashboard:")),
		false,
	);
});
