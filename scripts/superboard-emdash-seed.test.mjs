import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const legacyLocale of [false, true]) {
	test(`seed generation resolves localized plugin ownership from ${legacyLocale ? "historical" : "canonical"} route patterns without a Dashboard checkout`, async () => {
		const root = await mkdtemp(join(tmpdir(), "superboard-seed-"));
		try {
			await mkdir(join(root, "scripts"));
			await mkdir(join(root, "config"));
			await cp(
				new URL("./superboard-emdash-seed.mjs", import.meta.url),
				join(root, "scripts/superboard-emdash-seed.mjs"),
			);
			for (const name of ["superboard-dashboard-navigation.json", "emdash-plugin-topology.json"])
				await cp(new URL(`../config/${name}`, import.meta.url), join(root, "config", name));
			const parity = JSON.parse(
				await readFile(new URL("../config/emdash-parity-matrix.json", import.meta.url), "utf8"),
			);
			if (legacyLocale)
				for (const row of parity.rows)
					if (row.kind === "dashboard")
						row.id = row.id.replace("/identity/:lang", "/identity/[lang]");
			await writeFile(join(root, "config/emdash-parity-matrix.json"), JSON.stringify(parity));
			const result = spawnSync(
				process.execPath,
				[join(root, "scripts/superboard-emdash-seed.mjs"), "--write"],
				{ encoding: "utf8" },
			);
			assert.equal(result.status, 0, result.stderr);
			const seed = JSON.parse(await readFile(join(root, "apps/site/seed/seed.json"), "utf8"));
			const navigation = JSON.parse(
				await readFile(join(root, "config/superboard-dashboard-navigation.json"), "utf8"),
			);
			assert.equal(
				seed.content.views.length,
				navigation.sections.flatMap((section) => section.pages).length,
			);
			const identity = seed.content.views.find(
				(view) => view.data.path === "/identity/en/dashboard",
			);
			assert.equal(identity.data.plugin_id, "supbrd-plug-user");
			assert.equal(identity.data.route_id, "superboard.identity_by_lang_dashboard");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
