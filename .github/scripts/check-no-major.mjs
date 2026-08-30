#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { glob } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const stableSuperBoardPackagePaths = new Set([
	"apps/mcp/package.json",
	"sdks/flows/upstream/packages/js-components/package.json",
	"sdks/flows/upstream/packages/js/package.json",
	"sdks/flows/upstream/packages/react-components/package.json",
	"sdks/flows/upstream/packages/react/package.json",
	"sdks/flows/upstream/product/shared/package.json",
	"sdks/flows/upstream/product/types/package.json",
	"sdks/identity/angular/package.json",
	"sdks/identity/react/package.json",
	"sdks/identity/vue/package.json",
	"sdks/identity/web/package.json",
	"sdks/javascript/package.json",
	"sdks/react-native/package.json",
]);

export function isVersionCheckExempt(file) {
	return stableSuperBoardPackagePaths.has(file);
}

export async function checkVersions() {
	const offenders = [];
	const seen = [];
	for await (const file of glob("**/package.json", {
		exclude: (path) =>
			path.includes("node_modules") || path.includes("/dist/") || path.includes("/.git/"),
	})) {
		let pkg;
		try {
			pkg = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			continue;
		}
		if (pkg.private || !pkg.name || !pkg.version || isVersionCheckExempt(file)) continue;
		seen.push(`${pkg.name}@${pkg.version}`);
		const major = Number.parseInt(pkg.version.split(".")[0], 10);
		if (Number.isFinite(major) && major >= 1) {
			offenders.push(`${pkg.name}@${pkg.version} (${file})`);
		}
	}

	if (offenders.length > 0) {
		console.error(
			"::error::Non-0.x versions detected. Releases must stay in 0.x while in pre-1.0:",
		);
		for (const offender of offenders) console.error(`  ${offender}`);
		return 1;
	}

	console.log(
		`Checked ${seen.length} non-private pre-1.0 packages; ${stableSuperBoardPackagePaths.size} reviewed SuperBoard packages retain published stable versions.`,
	);
	return 0;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
	process.exitCode = await checkVersions();
}
