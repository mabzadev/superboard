#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	readdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TEMPLATES_DIR = join(ROOT, "templates");
const REPO = "emdash-cms/templates";

const TEMPLATES = [
	"blog",
	"blog-cloudflare",
	"marketing",
	"marketing-cloudflare",
	"portfolio",
	"portfolio-cloudflare",
	"starter",
	"starter-cloudflare",
];

const EXCLUDE = new Set([
	"node_modules",
	"dist",
	".astro",
	".emdash",
	"CHANGELOG.md",
	"AGENTS-template.md",
]);

const RE_NON_WHITESPACE_START = /^\S/;
const RE_CATALOG_ENTRY = /^\s+"?([^"]+)"?:\s+(.+)$/;

function parseCatalog() {
	const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
	const catalog = {};
	let inCatalog = false;
	for (const line of yaml.split("\n")) {
		if (line.startsWith("catalog:")) {
			inCatalog = true;
			continue;
		}
		if (inCatalog && RE_NON_WHITESPACE_START.test(line)) break;
		if (!inCatalog) continue;

		const match = line.match(RE_CATALOG_ENTRY);
		if (match) catalog[match[1]] = match[2];
	}
	return catalog;
}

function getRootPackageManager() {
	const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
	if (!pkg.packageManager) {
		throw new Error("Root package.json is missing a packageManager field");
	}
	return pkg.packageManager;
}

function collectWorkspaceVersions() {
	const versions = {};
	const dirs = [join(ROOT, "packages"), join(ROOT, "packages/plugins")];
	for (const base of dirs) {
		if (!existsSync(base)) continue;
		for (const entry of readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const pkgPath = join(base, entry.name, "package.json");
			if (!existsSync(pkgPath)) continue;
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			if (pkg.name && pkg.version) {
				versions[pkg.name] = pkg.version;
			}
		}
	}
	return versions;
}

function resolveDeps(deps, catalog, workspace) {
	if (!deps) return deps;
	const resolved = {};
	for (const [name, version] of Object.entries(deps)) {
		if (version === "catalog:") {
			resolved[name] = catalog[name] || version;
		} else if (version.startsWith("workspace:")) {
			resolved[name] = workspace[name] ? `^${workspace[name]}` : version;
		} else {
			resolved[name] = version;
		}
	}
	return resolved;
}

function transformPackageJson(srcPath, catalog, workspace, packageManager) {
	const pkg = JSON.parse(readFileSync(srcPath, "utf8"));
	pkg.packageManager = packageManager;
	pkg.dependencies = resolveDeps(pkg.dependencies, catalog, workspace);
	pkg.devDependencies = resolveDeps(pkg.devDependencies, catalog, workspace);
	if (pkg.peerDependencies) {
		pkg.peerDependencies = resolveDeps(pkg.peerDependencies, catalog, workspace);
		if (Object.keys(pkg.peerDependencies).length === 0) delete pkg.peerDependencies;
	}
	if (pkg.optionalDependencies) {
		pkg.optionalDependencies = resolveDeps(pkg.optionalDependencies, catalog, workspace);
		if (Object.keys(pkg.optionalDependencies).length === 0) delete pkg.optionalDependencies;
	}
	return JSON.stringify(pkg, null, 2) + "\n";
}

function pnpmWorkspaceYaml(template) {
	const allowBuilds = template.endsWith("-cloudflare")
		? "  esbuild: true\n  workerd: true\n  sharp: false"
		: "  esbuild: true\n  sharp: true\n  workerd: false";
	return `# Build scripts: allow only what each runtime needs; rest false so
# strictDepBuilds (pnpm >=10.26 / 11) passes.
allowBuilds:
${allowBuilds}

# Supply-chain hardening: cooldown on brand-new releases (EmDash exempt)
# and no non-registry transitive sources. (No trustPolicy: no-downgrade --
# it trips on upstream provenance regressions we don't control.)
minimumReleaseAge: 1440
minimumReleaseAgeExclude:
  - emdash
  - "@emdash-cms/*"
blockExoticSubdeps: true
`;
}

function lexists(p) {
	try {
		lstatSync(p);
		return true;
	} catch {
		return false;
	}
}

function copyDirRecursive(src, dest) {
	mkdirSync(dest, { recursive: true });
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		if (entry.isSymbolicLink()) {
			if (lexists(destPath)) unlinkSync(destPath);
			symlinkSync(readlinkSync(srcPath), destPath);
		} else if (entry.isDirectory()) {
			copyDirRecursive(srcPath, destPath);
		} else {
			cpSync(srcPath, destPath);
		}
	}
}

function copyTemplateDir(src, dest) {
	mkdirSync(dest, { recursive: true });

	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (EXCLUDE.has(entry.name)) continue;
		if (entry.name === "README.md") continue;
		if (entry.name === "package.json") continue;

		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);

		if (entry.isSymbolicLink()) {
			if (lexists(destPath)) unlinkSync(destPath);
			symlinkSync(readlinkSync(srcPath), destPath);
		} else if (entry.isDirectory()) {
			if (existsSync(destPath)) rmSync(destPath, { recursive: true });
			copyDirRecursive(srcPath, destPath);
		} else {
			cpSync(srcPath, destPath);
		}
	}

	const preserved = new Set(["README.md", "package.json", "pnpm-workspace.yaml"]);
	for (const entry of readdirSync(dest, { withFileTypes: true })) {
		if (preserved.has(entry.name)) continue;
		if (EXCLUDE.has(entry.name)) continue;
		const srcPath = join(src, entry.name);
		if (!existsSync(srcPath)) {
			const destPath = join(dest, entry.name);
			rmSync(destPath, { recursive: true, force: true });
		}
	}
}

function git(args, cwd) {
	return execFileSync("git", args, { encoding: "utf8", stdio: "pipe", cwd }).trim();
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const localIdx = args.indexOf("--local");
const localPath = localIdx !== -1 ? args[localIdx + 1] : null;
if (localIdx !== -1 && !localPath) {
	console.error("Error: --local requires a path argument");
	process.exit(1);
}

const catalog = parseCatalog();
const workspace = collectWorkspaceVersions();
const packageManager = getRootPackageManager();

console.log("Workspace packages:");
for (const [name, version] of Object.entries(workspace)) {
	console.log(`  ${name} = ${String(version)}`);
}
console.log("");

let targetDir;
let tempDir;

if (localPath) {
	targetDir = resolve(localPath);
	if (!existsSync(join(targetDir, ".git"))) {
		console.error(`Error: ${targetDir} is not a git repository`);
		process.exit(1);
	}
} else {
	tempDir = mkdtempSync(join(tmpdir(), "emdash-templates-"));
	console.log(`Cloning ${REPO} to ${tempDir}...`);
	execFileSync("gh", ["repo", "clone", REPO, tempDir, "--", "--depth", "1"], {
		stdio: "pipe",
	});
	execFileSync("gh", ["auth", "setup-git"], { stdio: "pipe" });
	targetDir = tempDir;
}

try {
	for (const template of TEMPLATES) {
		const srcDir = join(TEMPLATES_DIR, template);
		const destDir = join(targetDir, template);

		if (!existsSync(srcDir)) {
			console.log(`Skipping ${template} (not in monorepo)`);
			continue;
		}

		console.log(`Syncing ${template}`);
		copyTemplateDir(srcDir, destDir);

		const srcPkg = join(srcDir, "package.json");
		if (existsSync(srcPkg)) {
			writeFileSync(
				join(destDir, "package.json"),
				transformPackageJson(srcPkg, catalog, workspace, packageManager),
			);
			console.log("  Transformed package.json");
		}

		writeFileSync(join(destDir, "pnpm-workspace.yaml"), pnpmWorkspaceYaml(template));
		console.log("  Wrote pnpm-workspace.yaml");
	}

	const screenshotsJson = join(TEMPLATES_DIR, "screenshots.json");
	if (existsSync(screenshotsJson)) {
		cpSync(screenshotsJson, join(targetDir, "screenshots.json"));
		console.log("\nSynced screenshots.json");
	}

	console.log("");

	const diff = git(["diff", "--stat"], targetDir);
	const untracked = git(["ls-files", "--others", "--exclude-standard"], targetDir);
	if (!diff && !untracked) {
		console.log("No changes to sync.");
		process.exit(0);
	}

	console.log("Changes:");
	console.log(diff);
	console.log("");

	if (dryRun) {
		console.log("Dry run — not pushing.");
		if (tempDir) {
			console.log(`Temp dir preserved at: ${tempDir}`);
			tempDir = undefined;
		}
		process.exit(0);
	}

	const emdashVersion = workspace["emdash"] || "unknown";
	const branch = `sync/emdash-v${emdashVersion}`;

	if (process.env.CI) {
		git(["config", "user.name", "github-actions[bot]"], targetDir);
		git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"], targetDir);
	}

	git(["checkout", "-B", branch], targetDir);
	git(["add", "-A"], targetDir);
	git(["commit", "-m", `chore: sync templates from emdash v${emdashVersion}`], targetDir);
	git(["push", "--force", "-u", "origin", branch], targetDir);

	console.log(`Pushed branch: ${branch}`);

	const prBody = [
		"## Summary",
		"",
		`Synced templates from [emdash v${emdashVersion}](https://github.com/emdash-cms/emdash).`,
		"",
		"Auto-generated by `scripts/emdash/sync-templates-repo.mjs`.",
	].join("\n");

	const existingPrs = JSON.parse(
		execFileSync(
			"gh",
			["pr", "list", "--repo", REPO, "--head", branch, "--state", "open", "--json", "url"],
			{ encoding: "utf8", stdio: "pipe", cwd: targetDir },
		),
	);

	if (existingPrs.length > 0) {
		console.log(`PR already exists: ${existingPrs[0].url}`);
	} else {
		const prUrl = execFileSync(
			"gh",
			[
				"pr",
				"create",
				"--repo",
				REPO,
				"--head",
				branch,
				"--title",
				`chore: sync templates from emdash v${emdashVersion}`,
				"--body",
				prBody,
			],
			{ encoding: "utf8", stdio: "pipe", cwd: targetDir },
		).trim();

		console.log(`PR: ${prUrl}`);
	}
} finally {
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}
