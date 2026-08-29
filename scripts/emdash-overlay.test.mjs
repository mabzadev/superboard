import assert from "node:assert/strict";
import test from "node:test";

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
} from "./emdash-overlay.mjs";

const TRAILING_WHITESPACE_PATTERN = /\s+$/;

const overlay = {
	package: {
		metadata: { name: "superboard", private: true },
		scripts: { test: "superboard-test", "dashboard:test": "dashboard-test" },
		workspaces: ["apps/dashboard", "workers/api", "sdks/javascript"],
		overrides: { postcss: "8.5.26", "glob@12.0.0": { minimatch: "10.2.6" } },
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
	assert.equal(result.scripts["dashboard:test"], "dashboard-test");
	assert.equal(result.devDependencies.prettier, "upstream");
	assert.equal(result.devDependencies.eslint, "overlay-eslint");
	assert.equal(
		result.optionalDependencies["@typescript/native-preview-darwin-arm64"],
		"7.0.0-dev.20260421.2",
	);
});

void test("pnpm workspace retains upstream projects and adds uncovered SuperBoard projects", () => {
	const upstream = "trustPolicyExclude:\n  - vite@6.4.1\nallowBuilds:\n  esbuild: true\npackages:\n  - apps/*\n  - packages/*\n  - infra/*\ncatalog:\n  zod: 4.4.1\noverrides:\n  zod: 4.4.1\npatchedDependencies:\n  image-size@2.0.2: patches/image-size.patch\n";
	const result = renderPnpmWorkspace(upstream, overlay, {
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
	});

	assert.ok(result.includes("  - apps/*"));
	assert.ok(!result.includes("  - apps/dashboard\n"));
	assert.ok(result.includes("  - workers/api"));
	assert.ok(result.includes("  - sdks/javascript"));
	assert.ok(result.includes('"eslint-import-resolver-typescript": "4.4.5"'));
	assert.ok(result.includes('"glob@12.0.0>minimatch": "10.2.6"'));
	assert.ok(!result.includes('"glob@12.0.0": \n'));
	assert.ok(result.includes('"@swc/core": true'));
	assert.ok(result.includes('"core-js": false'));
	assert.ok(result.includes('"unrs-resolver": true'));
	assert.ok(result.includes('"eslint-config-prettier": "10.1.8"'));
	assert.ok(result.includes('"image-size@1.2.1": sdks/react-native/.yarn/patches/image-size.patch'));
	assert.ok(result.includes('- "semver@5.7.2"'));
	assert.ok(result.includes("virtualStoreType: project"));
	assert.ok(result.includes('  - "!@cloudflare/workers-types"'));
	assert.ok(result.includes("resolvePeersFromWorkspaceRoot: false"));
	assert.ok(result.includes("dedupePeerDependents: false"));
	assert.ok(result.includes('"@cloudflare/vitest-plugin@1.0.0":'));
	assert.ok(result.includes('"@cloudflare/workers-types": "4.20260305.1"'));
	assert.ok(result.includes('"jsdom": "26.1.0"'));
	assert.ok(result.includes("supportedArchitectures:"));
	assert.ok(result.includes('    - "arm64"'));
	assert.equal(result.split("\n").some((line) => TRAILING_WHITESPACE_PATTERN.test(line)), false);
});

void test("gitignore keeps the pnpm lock authoritative", () => {
	const result = renderGitignore("node_modules/\n", overlay);

	const lines = result.split("\n");
	assert.ok(!lines.includes("pnpm-lock.yaml"));
	assert.ok(!lines.includes("/pnpm-lock.yaml"));
	assert.ok(lines.includes("package-lock.json"));
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
	const changed = normalizeLocalWorkspaceDependencies(packageJson, new Set([
		"@superboard/contracts",
		"@superboard/email-transport",
	]));

	assert.equal(changed, true);
	assert.equal(packageJson.dependencies["@superboard/contracts"], "workspace:*");
	assert.equal(packageJson.devDependencies["@superboard/email-transport"], "workspace:*");
	assert.equal(packageJson.dependencies.zod, "^4.0.0");
	assert.equal(normalizeLocalWorkspaceDependencies(packageJson, new Set(["@superboard/contracts"])), false);
});

void test("workspace dependency normalization excludes vendored examples", () => {
	const exact = new Set([
		"workers/api",
		"sdks/flows/upstream/packages/js",
	]);

	assert.equal(isIntegratedWorkspaceDirectory("apps/dashboard", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("packages/contracts", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("workers/api", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("sdks/flows/upstream/packages/js", exact), true);
	assert.equal(isIntegratedWorkspaceDirectory("sdks/flows/upstream/reference/framework-examples/astro", exact), false);
});

void test("SuperBoard root scripts execute through pnpm", () => {
	assert.equal(normalizePnpmScript("npm run worker:test"), "pnpm run worker:test");
	assert.equal(
		normalizePnpmScript("npm --prefix workers/support run typecheck"),
		"pnpm --dir workers/support run typecheck",
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
	assert.ok(result.includes("pnpm check"));
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
