import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGINS_DIR = "packages/plugins";
const BUNDLER = "packages/plugin-cli/dist/index.mjs";

const SLASH_RE = /\//g;
const LEADING_AT_RE = /^@/;

const repo = process.env.GITHUB_REPOSITORY;
const dryRun = process.env.DRY_RUN === "1";

if (!dryRun && !repo) {
	console.error("GITHUB_REPOSITORY is not set; cannot target `gh release upload`.");
	process.exit(1);
}

const raw = process.env.PUBLISHED_PACKAGES?.trim() || "[]";
let published;
try {
	published = JSON.parse(raw);
} catch (error) {
	console.error(`Could not parse PUBLISHED_PACKAGES as JSON: ${error.message}`);
	process.exit(1);
}

if (!Array.isArray(published) || published.length === 0) {
	console.log("No published packages to process.");
	process.exit(0);
}

const publishedVersions = new Map(published.map((p) => [p.name, p.version]));

const slugify = (id) => id.replace(SLASH_RE, "-").replace(LEADING_AT_RE, "");

const failures = [];
let attached = 0;

for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;

	const dir = join(PLUGINS_DIR, entry.name);
	const pkgPath = join(dir, "package.json");
	if (!existsSync(pkgPath)) continue;

	let pkg;
	try {
		pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
	} catch {
		console.warn(`Skipping ${entry.name}: could not read/parse package.json`);
		continue;
	}

	if (!publishedVersions.has(pkg.name)) continue;
	if (pkg.private === true) continue;
	if (!pkg.exports?.["./sandbox"]) {
		console.log(`Skipping ${pkg.name}: no ./sandbox export (not a sandboxed plugin).`);
		continue;
	}

	const version = publishedVersions.get(pkg.name);
	const tag = `${pkg.name}@${version}`;
	console.log(`\n=== ${pkg.name}@${version} ===`);

	try {
		execFileSync("node", [BUNDLER, "bundle", "--dir", dir], { stdio: "inherit" });

		const manifest = JSON.parse(readFileSync(join(dir, "dist", "manifest.json"), "utf-8"));
		const tarball = join(dir, "dist", `${slugify(manifest.id)}-${manifest.version}.tar.gz`);
		if (!existsSync(tarball)) {
			throw new Error(`Expected tarball not found: ${tarball}`);
		}

		if (dryRun) {
			console.log(`[dry-run] would upload ${tarball} to release ${tag}`);
		} else {
			execFileSync("gh", ["release", "upload", tag, tarball, "--clobber", "--repo", repo], {
				stdio: "inherit",
			});
			console.log(`Attached ${tarball} to ${tag}`);
		}
		attached++;
	} catch (error) {
		console.error(`Failed to attach tarball for ${pkg.name}: ${error.message}`);
		failures.push(pkg.name);
	}
}

console.log(`\nAttached ${attached} plugin tarball(s).`);
if (failures.length > 0) {
	console.error(`Failed: ${failures.join(", ")}`);
	process.exit(1);
}
