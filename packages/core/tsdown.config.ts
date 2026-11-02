import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve as resolvePath } from "node:path";

import { defineConfig } from "tsdown";

import { routeArtifactName } from "./src/astro/integration/route-naming.ts";

const srcDir = resolvePath(import.meta.dirname, "src");
const TS_EXT = /\.tsx?$/;

function entryFileName(facadeModuleId: string | null, ext: string): string {
	if (facadeModuleId) {
		const rel = relative(srcDir, facadeModuleId);
		if (!rel.startsWith("..")) return routeArtifactName(rel.replace(TS_EXT, "")) + ext;
	}
	return `[name]${ext}`;
}

function routeInputMap(): Record<string, string> {
	const routesDir = resolvePath(srcDir, "astro/routes");
	const map: Record<string, string> = {};
	for (const d of readdirSync(routesDir, { recursive: true, withFileTypes: true })) {
		if (!d.isFile() || !TS_EXT.test(d.name)) continue;
		const abs = resolvePath(d.parentPath, d.name);
		const key = relative(srcDir, abs).replaceAll("\\", "/").replace(TS_EXT, "");
		map[key] = abs;
	}
	return map;
}

function readPackageVersion(): string {
	const parsed: unknown = JSON.parse(readFileSync("package.json", "utf-8"));
	if (
		typeof parsed === "object" &&
		parsed !== null &&
		"version" in parsed &&
		typeof parsed.version === "string"
	) {
		return parsed.version;
	}
	throw new Error("package.json is missing a string `version` field");
}
const pkg = { version: readPackageVersion() };
const commit = (() => {
	try {
		return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
	} catch {
		return "unknown";
	}
})();

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/request-context.ts",
		"src/astro/index.ts",
		"src/astro/middleware.ts",
		"src/astro/middleware/setup.ts",
		"src/astro/middleware/auth.ts",
		"src/astro/middleware/media-usage-write-fence.ts",
		"src/astro/middleware/redirect.ts",
		"src/astro/middleware/request-context.ts",
		"src/astro/types.ts",
		"src/db/index.ts",
		"src/db/sqlite.ts",
		"src/db/sqlite-migrations.ts",
		"src/db/libsql.ts",
		"src/db/libsql-migrations.ts",
		"src/db/postgres.ts",
		"src/db/postgres-migrations.ts",
		"src/migrations/index.ts",
		"src/database/instrumentation.ts",
		"src/database/pg-migration-lock.ts",
		"src/storage/local.ts",
		"src/storage/s3.ts",
		"src/object-cache/memory.ts",
		"src/media/index.ts",
		"src/media/local-runtime.ts",
		"src/media/image-endpoint.ts",
		"src/astro/image-endpoint.ts",
		"src/runtime.ts",
		"src/seed/index.ts",
		"src/cli/index.ts",
		"src/client/index.ts",
		"src/client/cf-access.ts",
		"src/seo/index.ts",
		"src/page/index.ts",
		"src/plugin-utils.ts",
		"src/plugin-types.ts",
		"src/plugins/adapt-sandbox-entry.ts",
		"src/api/route-utils.ts",
		"src/api/error.ts",
		"src/api/plugin-settings.ts",
		"src/api/schemas/index.ts",
		"src/auth/providers/github.ts",
		"src/auth/providers/google.ts",
	],
	format: "esm",
	dts: true,
	clean: true,
	noExternal: ["image-size"],
	inlineOnly: false,
	inputOptions: (options) => {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- normalized input record at the inputOptions hook
		options.input = { ...(options.input as Record<string, string>), ...routeInputMap() };
		return options;
	},
	outputOptions: {
		entryFileNames: (chunk) => entryFileName(chunk.facadeModuleId, ".mjs"),
	},
	define: {
		__EMDASH_VERSION__: JSON.stringify(pkg.version),
		__EMDASH_COMMIT__: JSON.stringify(commit),
	},
	external: [
		"@libsql/kysely-libsql",
		"pg",
		/^@aws-sdk\//,
		"tsdown",
		"emdash",
		/^astro:/,
		/\.astro$/,
		/^virtual:emdash\//,
	],
});
