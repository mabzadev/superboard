import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalFrontPath } from "../../../packages/contracts/src/front-paths.ts";

for (const legacyLocale of [false, true]) {
	test(`seed generation resolves localized plugin ownership from ${legacyLocale ? "historical" : "canonical"} route patterns without a Dashboard checkout`, async () => {
		const root = await mkdtemp(join(tmpdir(), "superboard-seed-"));
		try {
			await mkdir(join(root, "scripts/emdash"), { recursive: true });
			await mkdir(join(root, "scripts/config"));
			await mkdir(join(root, "packages/contracts/src"), { recursive: true });
			await cp(
				new URL("../../../packages/contracts/src/front-paths.ts", import.meta.url),
				join(root, "packages/contracts/src/front-paths.ts"),
			);
			await cp(
				new URL("../../../scripts/emdash/seed.mjs", import.meta.url),
				join(root, "scripts/emdash/seed.mjs"),
			);
			for (const name of [
				"superboard-dashboard-navigation.json",
				"emdash-plugin-topology.json",
				"superboard-front-menu-seed.json",
				"superboard-parity-release.json",
			])
				await cp(
					new URL(`../../../scripts/config/${name}`, import.meta.url),
					join(root, "scripts/config", name),
				);
			const parity = JSON.parse(
				await readFile(
					new URL("../../../scripts/config/emdash-parity-matrix.json", import.meta.url),
					"utf8",
				),
			);
			if (legacyLocale)
				for (const row of parity.rows)
					if (row.kind === "dashboard")
						row.id = row.id.replace("/identity/:lang", "/identity/[lang]");
			await writeFile(
				join(root, "scripts/config/emdash-parity-matrix.json"),
				JSON.stringify(parity),
			);
			const result = spawnSync(
				process.execPath,
				[join(root, "scripts/emdash/seed.mjs"), "--write"],
				{ encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			const seed = JSON.parse(await readFile(join(root, "apps/site/seed/seed.json"), "utf8"));
			for (const view of seed.content.views)
				assert.deepEqual(view.data.bindings, { data_sources: [], commands: [] });
			const menus = JSON.parse(
				await readFile(join(root, "scripts/config/superboard-front-menu-seed.json"), "utf8"),
			);
			assert.deepEqual(seed.menus, menus);
			const navigation = JSON.parse(
				await readFile(join(root, "scripts/config/superboard-dashboard-navigation.json"), "utf8"),
			);
			const paths = new Set(seed.content.views.map((view) => view.data.path));
			assert.equal(paths.size, seed.content.views.length);
			for (const page of navigation.sections.flatMap((section) => section.pages))
				assert.ok(paths.has(canonicalFrontPath(page.href)), page.href);
			const identity = seed.content.views.find((view) => view.data.path === "/auth/settings");
			assert.equal(identity.data.plugin_id, "supbrd-plug-user");
			assert.equal(identity.data.route_id, "superboard.auth_settings");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
