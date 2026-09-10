import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parse } from "yaml";

import {
	isIntegratedWorkspaceDirectory,
	isLintSourcePath,
	normalizeLocalWorkspaceDependencies,
	normalizePnpmScript,
	renderGitignore,
	renderIntegratedReadme,
	renderPnpmWorkspace,
	renderRootPackage,
	renderSuperboardCi,
} from "../../../scripts/emdash/overlay.mjs";

const TRAILING_WHITESPACE_PATTERN = /\s+$/;

test("central fixture seeds remain versionable while generated data stays ignored", (t) => {
	const directory = mkdtempSync(join(tmpdir(), "superboard-fixture-ignore-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const configuration = JSON.parse(
		readFileSync(
			new URL("../../../scripts/config/emdash-root.overlay.json", import.meta.url),
			"utf8",
		),
	);
	writeFileSync(join(directory, ".gitignore"), renderGitignore(".emdash/\n", configuration));
	const seed = "tests/fixtures/emdash-site/.emdash/seed.json";
	const uploads = "tests/fixtures/emdash-site/.emdash/uploads/image.png";
	mkdirSync(join(directory, "tests/fixtures/emdash-site/.emdash/uploads"), { recursive: true });
	writeFileSync(join(directory, seed), "{}");
	writeFileSync(join(directory, uploads), "generated");
	assert.equal(spawnSync("git", ["init", "--quiet"], { cwd: directory }).status, 0);
	const files = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
		cwd: directory,
		encoding: "utf8",
	});
	assert.equal(files.status, 0);
	assert.ok(files.stdout.split("\n").includes(seed));
	assert.ok(!files.stdout.split("\n").includes(uploads));
});

const overlay = {
	package: {
		metadata: { name: "superboard", private: true },
		scripts: { test: "superboard-test", "site:test": "site-test" },
		workspaces: ["apps/site", "packages/plugins/supbrd-core/api", "sdks/javascript"],
		overrides: { postcss: "8.5.26", "glob@12.0.0": { minimatch: "10.2.6" } },
		catalogs: { workers: { typescript: "5.9.3", hono: "4.13.5" } },
		devDependencies: { prettier: "overlay", eslint: "overlay-eslint" },
		optionalDependencies: {
			"@typescript/native-preview-darwin-arm64": "7.0.0-dev.20260421.2",
		},
	},
	gitignore: "node_modules/\n/pnpm-lock.yaml\n.backups/\n",
};

void test("root package keeps the EmDash base and composes colliding gates", () => {
	const result = renderRootPackage(
		{
			name: "emdash-workspace",
			type: "module",
			scripts: { test: "emdash-test", build: "emdash-build" },
			devDependencies: { prettier: "upstream", vitest: "upstream-vitest" },
		},
		overlay,
	);

	assert.equal(result.name, "superboard");
	assert.equal(result.type, "module");
	assert.equal(result.scripts["emdash:test"], "emdash-test");
	assert.equal(result.scripts["superboard:test"], "superboard-test");
	assert.equal(result.scripts.test, "pnpm run emdash:test && pnpm run superboard:test");
	assert.equal(result.scripts.build, "emdash-build");
	assert.equal(result.scripts["site:test"], "site-test");
	assert.equal(result.devDependencies.prettier, "upstream");
	assert.equal(result.devDependencies.eslint, "overlay-eslint");
	assert.equal(
		result.optionalDependencies["@typescript/native-preview-darwin-arm64"],
		"7.0.0-dev.20260421.2",
	);
});

test("regenerated lifecycle hooks execute their relocated script without the old directory", (context) => {
	const root = mkdtempSync(join(tmpdir(), "superboard-overlay-hook-"));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, "scripts/local"), { recursive: true });
	writeFileSync(
		join(root, "scripts/local/hook.mjs"),
		'import { writeFileSync } from "node:fs"; writeFileSync("completed", "yes");',
	);
	const result = renderRootPackage(
		{ scripts: { postbuild: "node scripts/old-hook.mjs" } },
		{
			...overlay,
			package: {
				...overlay.package,
				upstreamScripts: { postbuild: "node scripts/local/hook.mjs" },
			},
		},
	);
	writeFileSync(join(root, "package.json"), JSON.stringify(result));
	const execution = spawnSync(result.scripts.postbuild, {
		cwd: root,
		encoding: "utf8",
		shell: true,
	});
	assert.equal(execution.status, 0, execution.stdout + execution.stderr);
	assert.equal(readFileSync(join(root, "completed"), "utf8"), "yes");
});

void test("pnpm workspace retains upstream projects and adds uncovered SuperBoard projects", () => {
	const upstream =
		"verifyDepsBeforeRun: error\ntrustPolicyExclude:\n  - vite@6.4.1\nallowBuilds:\n  esbuild: true\npackages:\n  - apps/*\n  - packages/*\n  - demos/*\n  - infra/*\ncatalog:\n  zod: 4.4.1\noverrides:\n  zod: 4.4.1\npatchedDependencies:\n  image-size@2.0.2: patches/image-size.patch\n";
	const compatibility = {
		eslintImportResolverTypescript: "4.4.5",
		allowBuilds: {
			"@swc/core": true,
			"core-js": false,
			"unrs-resolver": true,
		},
		additionalOverrides: {
			"eslint-config-prettier": "10.1.8",
			"image-size@^1.0.2": "1.2.1",
		},
		patchedDependencies: {
			"image-size@1.2.1": "sdks/react-native/.yarn/patches/image-size.patch",
		},
		trustPolicyExclude: ["semver@5.7.2"],
		virtualStoreType: "project",
		verifyDepsBeforeRun: "warn",
		hoistPattern: ["*", "!@cloudflare/workers-types"],
		resolvePeersFromWorkspaceRoot: false,
		dedupePeerDependents: false,
		packageExtensions: {
			"@cloudflare/vitest-plugin@1.0.0": {
				dependencies: {
					"@cloudflare/workers-types": "4.20260305.1",
					jsdom: "26.1.0",
				},
			},
		},
		supportedArchitectures: {
			os: ["current", "darwin", "linux"],
			cpu: ["x64", "arm64"],
		},
	};
	const result = renderPnpmWorkspace(upstream, overlay, compatibility);

	assert.ok(result.includes("  - apps/*"));
	const workspace = parse(result);
	assert.equal(workspace.catalog.zod, "4.4.1");
	assert.deepEqual(workspace.catalogs, overlay.package.catalogs);
	assert.ok(!result.includes("  - apps/site\n"));
	assert.ok(result.includes("  - packages/plugins/supbrd-core/api"));
	assert.ok(result.includes("  - sdks/javascript"));
	assert.ok(result.includes('"eslint-import-resolver-typescript": "4.4.5"'));
	assert.ok(result.includes('"glob@12.0.0>minimatch": "10.2.6"'));
	assert.ok(!result.includes('"glob@12.0.0": \n'));
	assert.ok(result.includes('"@swc/core": true'));
	assert.ok(result.includes('"core-js": false'));
	assert.ok(result.includes('"unrs-resolver": true'));
	assert.ok(result.includes('"eslint-config-prettier": "10.1.8"'));
	assert.ok(
		result.includes('"image-size@1.2.1": sdks/react-native/.yarn/patches/image-size.patch'),
	);
	assert.ok(result.includes('- "semver@5.7.2"'));
	assert.ok(result.includes("virtualStoreType: project"));
	assert.ok(result.includes("verifyDepsBeforeRun: warn"));
	assert.ok(!result.includes("verifyDepsBeforeRun: error"));
	assert.ok(result.includes('  - "!@cloudflare/workers-types"'));
	assert.ok(result.includes("resolvePeersFromWorkspaceRoot: false"));
	assert.ok(result.includes("dedupePeerDependents: false"));
	assert.ok(result.includes('"@cloudflare/vitest-plugin@1.0.0":'));
	assert.ok(result.includes('"@cloudflare/workers-types": "4.20260305.1"'));
	assert.ok(result.includes('"jsdom": "26.1.0"'));
	assert.ok(result.includes("supportedArchitectures:"));
	assert.ok(result.includes('    - "arm64"'));
	assert.equal(
		result.split("\n").some((line) => TRAILING_WHITESPACE_PATTERN.test(line)),
		false,
	);
	const withoutDemos = renderPnpmWorkspace(
		upstream,
		{
			...overlay,
			package: { ...overlay.package, removedWorkspaces: ["demos/*"] },
		},
		compatibility,
	);
	assert.ok(parse(result).packages.includes("demos/*"));
	assert.ok(!parse(withoutDemos).packages.includes("demos/*"));
	assert.ok(parse(withoutDemos).packages.includes("apps/*"));
});

void test("gitignore keeps the pnpm lock authoritative", () => {
	const result = renderGitignore("node_modules/\n", overlay);

	const lines = result.split("\n");
	assert.ok(!lines.includes("pnpm-lock.yaml"));
	assert.ok(!lines.includes("/pnpm-lock.yaml"));
	assert.ok(lines.includes("package-lock.json"));
	assert.ok(lines.includes("!apps/mcp/package-lock.json"));
	assert.ok(lines.includes("!sdks/javascript/package-lock.json"));
	assert.ok(lines.includes("!.dev.vars.example"));
	assert.ok(lines.includes(".backups/"));
});

void test("local SuperBoard packages cannot fall back to the npm registry", () => {
	const packageJson = {
		dependencies: {
			"@superboard/contracts": "*",
			zod: "^4.0.0",
		},
		devDependencies: {
			"@superboard/email-transport": "1.0.0",
		},
	};
	const changed = normalizeLocalWorkspaceDependencies(
		packageJson,
		new Set(["@superboard/contracts", "@superboard/email-transport"]),
	);

	assert.equal(changed, true);
	assert.equal(packageJson.dependencies["@superboard/contracts"], "workspace:*");
	assert.equal(packageJson.devDependencies["@superboard/email-transport"], "workspace:*");
	assert.equal(packageJson.dependencies.zod, "^4.0.0");
	assert.equal(
		normalizeLocalWorkspaceDependencies(packageJson, new Set(["@superboard/contracts"])),
		false,
	);
});

void test("workspace dependency normalization excludes vendored examples", () => {
	const exact = new Set(["packages/plugins/supbrd-core/api", "sdks/flows/upstream/packages/js"]);

	assert.equal(isIntegratedWorkspaceDirectory("apps/site", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("packages/contracts", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("packages/plugins/supbrd-core/api", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("sdks/flows/upstream/packages/js", exact), true);
	assert.equal(
		isIntegratedWorkspaceDirectory("sdks/flows/upstream/reference/framework-examples/astro", exact),
		false,
	);
});

void test("SuperBoard root scripts execute through pnpm", () => {
	assert.equal(normalizePnpmScript("npm run worker:test"), "pnpm run worker:test");
	assert.equal(
		normalizePnpmScript("npm --prefix packages/plugins/supbrd-plug-support/worker run typecheck"),
		"pnpm --dir packages/plugins/supbrd-plug-support/worker run typecheck",
	);
	assert.equal(
		normalizePnpmScript("npm --prefix apps/reference ci"),
		"pnpm --dir apps/reference install --frozen-lockfile",
	);
	assert.equal(
		normalizePnpmScript("npx vitest run && npm test"),
		"pnpm exec vitest run && pnpm test",
	);
});

void test("integrated README keeps SuperBoard authoritative and documents the pinned foundation", () => {
	const result = renderIntegratedReadme(
		"# SuperBoard\n\nCanonical product.\n\n## Layout\n\nCurrent layout.\n\n```bash\nnpm ci\nnpm run test:all\n```\n",
		{
			remote: "https://github.com/emdash-cms/emdash.git",
			commit: "1717d31b351164a5f78e95fe004ee582c7c50f40",
			version: "0.35.0",
		},
	);

	assert.ok(result.startsWith("# SuperBoard"));
	assert.ok(result.includes("EmDash 0.35.0"));
	assert.ok(result.includes("1717d31b351164a5f78e95fe004ee582c7c50f40"));
	assert.ok(result.includes("pnpm install --frozen-lockfile"));
	assert.ok(result.includes("pnpm run test:all"));
	assert.ok(result.includes("pnpm site:check"));
	assert.ok(result.indexOf("## Integrated EmDash foundation") < result.indexOf("## Layout"));
});

void test("recapturing a generated README does not duplicate the foundation section", () => {
	const upstream = {
		remote: "https://github.com/emdash-cms/emdash.git",
		commit: "pinned",
		version: "0.35.0",
	};
	const once = renderIntegratedReadme(
		"# SuperBoard\n\n## Layout\n\nProject directories.\n",
		upstream,
	);
	assert.equal(renderIntegratedReadme(once, upstream), once);
});

void test("SuperBoard CI is preserved as a separate pnpm workflow", () => {
	const result = renderSuperboardCi(`name: CI

jobs:
  plan:
    steps:
      - uses: actions/setup-node@node-sha
        with:
          cache: npm
          cache-dependency-path: apps/reference/package-lock.json
      - run: npm ci
      - run: npm run worker:check
      - run: yarn install --immutable
      - run: yarn check
`);

	assert.ok(result.startsWith("name: SuperBoard CI"));
	assert.ok(result.includes("uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093"));
	assert.ok(result.includes("cache: pnpm"));
	assert.ok(result.includes("cache-dependency-path: pnpm-lock.yaml"));
	assert.ok(result.includes("pnpm install --frozen-lockfile"));
	assert.ok(result.includes("pnpm run worker:check"));
	assert.ok(result.includes("yarn install --immutable"));
	assert.ok(result.includes("yarn check"));
	assert.ok(result.includes("pnpm emdash:overlay:check"));
	assert.ok(result.includes("pnpm site:check"));
});

void test("upstream lint inventory contains executable source only", () => {
	assert.equal(isLintSourcePath("packages/core/src/index.ts"), true);
	assert.equal(isLintSourcePath("packages/admin/src/App.tsx"), true);
	assert.equal(isLintSourcePath("scripts/check.mjs"), true);
	assert.equal(isLintSourcePath("README.md"), false);
	assert.equal(isLintSourcePath("assets/screenshot.png"), false);
	assert.equal(isLintSourcePath("packages/plugins/forms/src/admin.tsx"), false);
});

void test("removed upstream commands do not return through composed script aliases", () => {
	const result = renderRootPackage(
		{ scripts: { "typecheck:demos": "upstream-demo-check", build: "build-packages" } },
		{
			...overlay,
			package: {
				...overlay.package,
				scripts: { "typecheck:demos": "demo-check", "site:test": "site-test" },
				removedScripts: ["typecheck:demos"],
			},
		},
	);
	assert.ok(!Object.keys(result.scripts).some((name) => name.endsWith("typecheck:demos")));
	assert.equal(result.scripts["site:test"], "site-test");
	assert.equal(result.scripts.build, "build-packages");
});
