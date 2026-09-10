import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { assertNativeFrontRenderer } from "../../../../apps/site/src/lib/native-front-plugins.js";

test("a published renderer remains usable after the navigation upgrade while unknown builds are rejected", () => {
	const migration = readFileSync(
		new URL("../../../../apps/site/migrations/0026_previous_plugin_manifests.sql", import.meta.url),
		"utf8",
	);
	const row = [
		...migration.matchAll(
			/VALUES \('(sha256:[a-f0-9]{64})', 'supbrd-plugmod-analytics', '((?:[^']|'')*)', '[^']+'\)/gu,
		),
	][0];
	if (!row) throw new Error("Published Analytics manifest is missing");
	const manifest = JSON.parse(row[2].replaceAll("''", "'"));
	const renderer = manifest.renderers[0];
	const lock = [
		{
			plugin_id: manifest.plugin_id,
			version: manifest.plugin_version,
			artifact_checksum: manifest.artifact_checksum,
			native: false,
		},
	];
	expect(assertNativeFrontRenderer(renderer, lock).plugin_id).toBe("supbrd-plugmod-analytics");
	expect(() =>
		assertNativeFrontRenderer({ ...renderer, build_checksum: `sha256:${"0".repeat(64)}` }, lock),
	).toThrow("Native renderer build is unavailable");
});
