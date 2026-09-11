import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

test("production module catalogs format raw and compiled messages without warnings", async () => {
	const bundle = await build({
		entryPoints: [
			fileURLToPath(new URL("../../../../packages/supbrd-front-ui/src/i18n.ts", import.meta.url)),
		],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		define: { "process.env.NODE_ENV": '"production"' },
	});
	const result = spawnSync(process.execPath, ["--input-type=module"], {
		encoding: "utf8",
		input: `${bundle.outputFiles[0].text}
			const runtimeTestCatalog = createFrontI18n({locale: "fr", messages: {fr: {
				refresh: "Actualiser",
				remove: ["Supprimer ", ["name"]],
				items: "{count, plural, one {# élément} other {# éléments}}"
			}}});
			console.log(JSON.stringify([runtimeTestCatalog._("refresh"), runtimeTestCatalog._("remove", {name: "Rapport"}), runtimeTestCatalog._("items", {count: 2})]));
		`,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), ["Actualiser", "Supprimer Rapport", "2 éléments"]);
	assert.doesNotMatch(result.stderr, /Uncompiled message/);
});
