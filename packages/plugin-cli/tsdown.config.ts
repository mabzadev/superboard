import { defineConfig } from "tsdown";

const bundledPatchedDependencies = ["image-size"];

export default defineConfig([
	{
		entry: ["src/index.ts"],
		format: ["esm"],
		outExtensions: () => ({ js: ".mjs" }),
		dts: false,
		clean: true,
		platform: "node",
		target: "node22",
		shims: false,
		noExternal: bundledPatchedDependencies,
		inlineOnly: bundledPatchedDependencies,
	},
	{
		entry: ["src/api.ts"],
		format: ["esm"],
		dts: true,
		clean: false,
		platform: "node",
		target: "node22",
		noExternal: bundledPatchedDependencies,
		inlineOnly: bundledPatchedDependencies,
		external: [
			"@atcute/client",
			"@atcute/identity-resolver",
			"@atcute/lexicons",
			"@atcute/multibase",
			"@atcute/oauth-node-client",
			"@emdash-cms/plugin-types",
			"@emdash-cms/registry-client",
			"@emdash-cms/registry-lexicons",
			"@oslojs/crypto",
			"chokidar",
			"citty",
			"consola",
			"jsonc-parser",
			"modern-tar",
			"picocolors",
			"tsdown",
			"zod",
		],
	},
]);
