import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/db/d1.ts",
		"src/db/d1-migrations.ts",
		"src/db/hyperdrive.ts",
		"src/db/hyperdrive-migrations.ts",
		"src/db/do.ts",
		"src/db/do-sql.ts",
		"src/db/playground.ts",
		"src/db/playground-middleware.ts",
		"src/storage/r2.ts",
		"src/image-endpoint.ts",
		"src/auth/index.ts",
		"src/sandbox/index.ts",
		"src/worker.ts",
		"src/plugins/index.ts",
		"src/plugins/cloudflare-email.ts",
		"src/plugins/ai-search.ts",
		"src/plugins/ai-search-admin.tsx",

		"src/media/images-runtime.ts",
		"src/media/stream-runtime.ts",
		"src/cache/runtime.ts",
		"src/cache/config.ts",
		"src/cache/kv.ts",
	],
	format: ["esm"],
	dts: true,
	clean: true,
	external: ["cloudflare:workers", "cloudflare:email", /^@astrojs\/cloudflare/, /^astro($|\/)/],
});
