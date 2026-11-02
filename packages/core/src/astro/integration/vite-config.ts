import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AstroConfig } from "astro";
import type { Plugin } from "vite";

import { COMMIT, VERSION } from "../../version.js";
import type { EmDashConfig, PluginDescriptor } from "./runtime.js";
import {
	VIRTUAL_CONFIG_ID,
	RESOLVED_VIRTUAL_CONFIG_ID,
	VIRTUAL_DIALECT_ID,
	RESOLVED_VIRTUAL_DIALECT_ID,
	VIRTUAL_STORAGE_ID,
	RESOLVED_VIRTUAL_STORAGE_ID,
	VIRTUAL_OBJECT_CACHE_ID,
	RESOLVED_VIRTUAL_OBJECT_CACHE_ID,
	VIRTUAL_ADMIN_REGISTRY_ID,
	RESOLVED_VIRTUAL_ADMIN_REGISTRY_ID,
	VIRTUAL_PLUGINS_ID,
	RESOLVED_VIRTUAL_PLUGINS_ID,
	VIRTUAL_SANDBOX_RUNNER_ID,
	RESOLVED_VIRTUAL_SANDBOX_RUNNER_ID,
	VIRTUAL_SANDBOXED_PLUGINS_ID,
	RESOLVED_VIRTUAL_SANDBOXED_PLUGINS_ID,
	VIRTUAL_AUTH_ID,
	RESOLVED_VIRTUAL_AUTH_ID,
	VIRTUAL_AUTH_PROVIDERS_ID,
	RESOLVED_VIRTUAL_AUTH_PROVIDERS_ID,
	VIRTUAL_MEDIA_PROVIDERS_ID,
	RESOLVED_VIRTUAL_MEDIA_PROVIDERS_ID,
	VIRTUAL_BLOCK_COMPONENTS_ID,
	RESOLVED_VIRTUAL_BLOCK_COMPONENTS_ID,
	VIRTUAL_SEED_ID,
	RESOLVED_VIRTUAL_SEED_ID,
	VIRTUAL_WAIT_UNTIL_ID,
	RESOLVED_VIRTUAL_WAIT_UNTIL_ID,
	VIRTUAL_SCHEDULER_ID,
	RESOLVED_VIRTUAL_SCHEDULER_ID,
	VIRTUAL_ENV_ID,
	RESOLVED_VIRTUAL_ENV_ID,
	VIRTUAL_BUILD_ID,
	RESOLVED_VIRTUAL_BUILD_ID,
	generateSeedModule,
	generateWaitUntilModule,
	generateSchedulerModule,
	generateEnvModule,
	generateBuildModule,
	generateConfigModule,
	generateDialectModule,
	generateStorageModule,
	generateObjectCacheModule,
	generateAuthModule,
	generateAuthProvidersModule,
	generatePluginsModule,
	generateAdminRegistryModule,
	generateSandboxRunnerModule,
	generateSandboxedPluginsModule,
	generateMediaProvidersModule,
	generateBlockComponentsModule,
} from "./virtual-modules.js";

const LOCALE_MESSAGES_RE = /[/\\]([a-z]{2}(?:-[A-Z]{2})?)[/\\]messages\.mjs$/;
function linguiMacroPlugin(adminSourcePath: string, adminDistPath: string): Plugin {
	const adminRequire = createRequire(resolve(adminDistPath, "index.js"));
	const babelCorePath = adminRequire.resolve("@babel/core");

	return {
		name: "emdash-lingui-macro",
		enforce: "pre",
		resolveId(id, importer) {
			if (!importer?.startsWith(adminSourcePath)) return;
			const match = id.match(LOCALE_MESSAGES_RE);
			if (match?.[1]) {
				return resolve(adminDistPath, "locales", match[1], "messages.mjs");
			}
		},
		async transform(code, id) {
			if (!id.startsWith(adminSourcePath) || !code.includes("@lingui")) return;
			const loaded: unknown = await import(babelCorePath);
			if (!isBabelTransform(loaded)) throw new Error("Babel transform is unavailable");
			const babelCore = loaded;
			const { transformAsync } = babelCore;
			const result = await transformAsync(code, {
				filename: id,
				plugins: ["@lingui/babel-plugin-lingui-macro"],
				parserOpts: { plugins: ["jsx", "typescript"] },
			});
			if (!result?.code) return;
			return { code: result.code, map: result.map ?? undefined };
		},
	};
}

function resolveAdminDist(): string {
	const require = createRequire(import.meta.url);
	const adminPath = require.resolve("@emdash-cms/admin");
	return dirname(adminPath);
}

function isInside(parent: string, child: string): boolean {
	const relativePath = relative(parent, child);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveAdminSource(projectRoot: string): string | undefined {
	const require = createRequire(import.meta.url);
	const adminPath = require.resolve("@emdash-cms/admin");
	const packageRoot = resolve(dirname(adminPath), "..");
	const repoRoot = resolve(packageRoot, "..", "..");
	const srcEntry = resolve(packageRoot, "src", "index.ts");

	try {
		if (existsSync(srcEntry) && isInside(repoRoot, projectRoot)) {
			return resolve(packageRoot, "src");
		}
	} catch {}
	return undefined;
}

function resolveIntegrationShim(fileName: string): string {
	const currentDir = dirname(fileURLToPath(import.meta.url));
	const sourceShimPath = resolve(currentDir, "shims", fileName);
	if (existsSync(sourceShimPath)) {
		return sourceShimPath;
	}
	return resolve(currentDir, "..", "..", "src", "astro", "integration", "shims", fileName);
}

export interface VitePluginOptions {
	serializableConfig: Record<string, unknown>;
	resolvedConfig: EmDashConfig;
	pluginDescriptors: PluginDescriptor[];
	astroConfig: AstroConfig;
}

export function createVirtualModulesPlugin(
	options: VitePluginOptions,
	astroCommand: "dev" | "build" | "preview" | "sync",
): Plugin {
	const { serializableConfig, resolvedConfig, pluginDescriptors, astroConfig } = options;

	let viteCommand: "build" | "serve" | undefined;

	const buildTime = Date.now();

	return {
		name: "emdash-virtual-modules",
		configResolved(config) {
			viteCommand = config.command;
		},
		resolveId(id: string) {
			if (id === VIRTUAL_CONFIG_ID) {
				return RESOLVED_VIRTUAL_CONFIG_ID;
			}
			if (id === VIRTUAL_DIALECT_ID) {
				return RESOLVED_VIRTUAL_DIALECT_ID;
			}
			if (id === VIRTUAL_STORAGE_ID) {
				return RESOLVED_VIRTUAL_STORAGE_ID;
			}
			if (id === VIRTUAL_OBJECT_CACHE_ID) {
				return RESOLVED_VIRTUAL_OBJECT_CACHE_ID;
			}
			if (id === VIRTUAL_ADMIN_REGISTRY_ID) {
				return RESOLVED_VIRTUAL_ADMIN_REGISTRY_ID;
			}
			if (id === VIRTUAL_PLUGINS_ID) {
				return RESOLVED_VIRTUAL_PLUGINS_ID;
			}
			if (id === VIRTUAL_SANDBOX_RUNNER_ID) {
				return RESOLVED_VIRTUAL_SANDBOX_RUNNER_ID;
			}
			if (id === VIRTUAL_SANDBOXED_PLUGINS_ID) {
				return RESOLVED_VIRTUAL_SANDBOXED_PLUGINS_ID;
			}
			if (id === VIRTUAL_AUTH_ID) {
				return RESOLVED_VIRTUAL_AUTH_ID;
			}
			if (id === VIRTUAL_AUTH_PROVIDERS_ID) {
				return RESOLVED_VIRTUAL_AUTH_PROVIDERS_ID;
			}
			if (id === VIRTUAL_MEDIA_PROVIDERS_ID) {
				return RESOLVED_VIRTUAL_MEDIA_PROVIDERS_ID;
			}
			if (id === VIRTUAL_BLOCK_COMPONENTS_ID) {
				return RESOLVED_VIRTUAL_BLOCK_COMPONENTS_ID;
			}
			if (id === VIRTUAL_SEED_ID) {
				return RESOLVED_VIRTUAL_SEED_ID;
			}
			if (id === VIRTUAL_WAIT_UNTIL_ID) {
				return RESOLVED_VIRTUAL_WAIT_UNTIL_ID;
			}
			if (id === VIRTUAL_SCHEDULER_ID) {
				return RESOLVED_VIRTUAL_SCHEDULER_ID;
			}
			if (id === VIRTUAL_ENV_ID) {
				return RESOLVED_VIRTUAL_ENV_ID;
			}
			if (id === VIRTUAL_BUILD_ID) {
				return RESOLVED_VIRTUAL_BUILD_ID;
			}
		},
		load(id: string) {
			if (id === RESOLVED_VIRTUAL_CONFIG_ID) {
				return generateConfigModule(serializableConfig);
			}
			if (id === RESOLVED_VIRTUAL_DIALECT_ID) {
				return generateDialectModule({
					entrypoint: resolvedConfig.database?.entrypoint,
					type: resolvedConfig.database?.type,
					supportsRequestScope: resolvedConfig.database?.supportsRequestScope ?? false,
					supportsCoalescing: resolvedConfig.database?.supportsCoalescing ?? false,
					supportsCollectionDeletionGuard:
						resolvedConfig.database?.supportsCollectionDeletionGuard ?? false,
				});
			}
			if (id === RESOLVED_VIRTUAL_STORAGE_ID) {
				return generateStorageModule(resolvedConfig.storage?.entrypoint);
			}
			if (id === RESOLVED_VIRTUAL_OBJECT_CACHE_ID) {
				return generateObjectCacheModule(
					resolvedConfig.objectCache?.entrypoint,
					resolvedConfig.objectCache?.config,
				);
			}
			if (id === RESOLVED_VIRTUAL_PLUGINS_ID) {
				return generatePluginsModule(pluginDescriptors);
			}
			if (id === RESOLVED_VIRTUAL_ADMIN_REGISTRY_ID) {
				const allDescriptors = [...pluginDescriptors, ...(resolvedConfig.sandboxed ?? [])];
				return generateAdminRegistryModule(allDescriptors);
			}
			if (id === RESOLVED_VIRTUAL_SANDBOX_RUNNER_ID) {
				return generateSandboxRunnerModule(resolvedConfig.sandboxRunner, resolvedConfig.sandbox);
			}
			if (id === RESOLVED_VIRTUAL_SANDBOXED_PLUGINS_ID) {
				const projectRoot = fileURLToPath(astroConfig.root);
				return generateSandboxedPluginsModule(
					resolvedConfig.sandboxed ?? [],
					projectRoot,
					(filePath) => this.addWatchFile(filePath),
				);
			}
			if (id === RESOLVED_VIRTUAL_AUTH_ID) {
				const authDescriptor = resolvedConfig.auth;
				if (!authDescriptor || !("entrypoint" in authDescriptor)) {
					return generateAuthModule(undefined);
				}
				return generateAuthModule(authDescriptor.entrypoint);
			}
			if (id === RESOLVED_VIRTUAL_AUTH_PROVIDERS_ID) {
				return generateAuthProvidersModule(resolvedConfig.authProviders ?? []);
			}
			if (id === RESOLVED_VIRTUAL_MEDIA_PROVIDERS_ID) {
				return generateMediaProvidersModule(resolvedConfig.mediaProviders ?? []);
			}
			if (id === RESOLVED_VIRTUAL_BLOCK_COMPONENTS_ID) {
				return generateBlockComponentsModule(pluginDescriptors);
			}
			if (id === RESOLVED_VIRTUAL_SEED_ID) {
				const projectRoot = fileURLToPath(astroConfig.root);
				return generateSeedModule(projectRoot, viteCommand === "serve");
			}
			if (id === RESOLVED_VIRTUAL_WAIT_UNTIL_ID) {
				return generateWaitUntilModule(astroConfig.adapter?.name);
			}
			if (id === RESOLVED_VIRTUAL_SCHEDULER_ID) {
				const schedulerCommand = astroCommand === "dev" ? "serve" : "build";
				return generateSchedulerModule(astroConfig.adapter?.name, schedulerCommand);
			}
			if (id === RESOLVED_VIRTUAL_ENV_ID) {
				return generateEnvModule(astroConfig.adapter?.name);
			}
			if (id === RESOLVED_VIRTUAL_BUILD_ID) {
				return generateBuildModule(buildTime);
			}
		},
	};
}

const ADMIN_STYLES_ALIAS = /^@emdash-cms\/admin\/styles\.css/;

const NODE_NATIVE_EXTERNALS = ["@libsql/kysely-libsql", "pg"];

function isCloudflareAdapter(astroConfig: AstroConfig): boolean {
	return astroConfig.adapter?.name === "@astrojs/cloudflare";
}

export function createViteConfig(
	options: VitePluginOptions,
	command: "dev" | "build" | "preview" | "sync",
): NonNullable<AstroConfig["vite"]> {
	const adminDistPath = resolveAdminDist();
	const cloudflare = isCloudflareAdapter(options.astroConfig);
	const isDev = command === "dev";
	const projectRoot = fileURLToPath(options.astroConfig.root);

	const adminSourcePath = isDev ? resolveAdminSource(projectRoot) : undefined;
	const useSource = adminSourcePath !== undefined;
	const useSyncExternalStoreShimPath = resolveIntegrationShim("use-sync-external-store.js");
	const useSyncExternalStoreWithSelectorShimPath = resolveIntegrationShim(
		"use-sync-external-store-with-selector.js",
	);

	return {
		define: {
			__EMDASH_VERSION__: JSON.stringify(VERSION),
			__EMDASH_COMMIT__: JSON.stringify(COMMIT),
			__EMDASH_PSEUDO_LOCALE__: JSON.stringify(
				isDev && process.env["EMDASH_PSEUDO_LOCALE"] === "1",
			),
		},
		resolve: {
			dedupe: ["@emdash-cms/admin", "react", "react-dom"],
			alias: [
				{ find: ADMIN_STYLES_ALIAS, replacement: resolve(adminDistPath, "styles.css") },
				{ find: "@emdash-cms/admin", replacement: useSource ? adminSourcePath : adminDistPath },
				{
					find: "use-sync-external-store/shim/with-selector.js",
					replacement: useSyncExternalStoreWithSelectorShimPath,
				},
				{
					find: "use-sync-external-store/shim/with-selector",
					replacement: useSyncExternalStoreWithSelectorShimPath,
				},
				{
					find: "use-sync-external-store/shim/index.js",
					replacement: useSyncExternalStoreShimPath,
				},
				{
					find: "use-sync-external-store/shim",
					replacement: useSyncExternalStoreShimPath,
				},
			],
		},
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Monorepo has both vite 6 (docs) and vite 7 (core). tsgo resolves correctly.
		plugins: [
			createVirtualModulesPlugin(options, command),
			...(useSource ? [linguiMacroPlugin(adminSourcePath, adminDistPath)] : []),
		] as NonNullable<AstroConfig["vite"]>["plugins"],
		ssr: cloudflare
			? {
					noExternal: ["emdash", "@emdash-cms/admin"],
					optimizeDeps: {
						exclude: ["virtual:emdash", "emdash", "@emdash-cms/admin", "@emdash-cms/cloudflare"],
						include: [
							"emdash > @portabletext/toolkit",
							"emdash > @unpic/placeholder",
							"emdash > blurhash",
							"emdash > croner",
							"emdash > jose",
							"emdash > jpeg-js",
							"emdash > kysely",
							"emdash > kysely/migration",
							"emdash > mime/lite",
							"emdash > modern-tar",
							"emdash > sanitize-html",
							"emdash > ulidx",
							"emdash > upng-js",
							"emdash > astro-portabletext",
							"emdash > sax",
							"emdash > sanitize-html > parse5",
							"emdash > @emdash-cms/gutenberg-to-portable-text > @wordpress/block-serialization-default-parser",
							"emdash > @emdash-cms/auth > @oslojs/crypto/ecdsa",
							"emdash > @emdash-cms/auth > @oslojs/crypto/sha2",
							"emdash > @emdash-cms/auth > @oslojs/webauthn",
							"emdash > @oslojs/crypto/hmac",
							"emdash > @oslojs/crypto/subtle",
							"emdash > @oslojs/crypto/rsa",
							"emdash > arctic",
							"emdash > @modelcontextprotocol/sdk > ajv",
							"emdash > @modelcontextprotocol/sdk > ajv-formats",
							"emdash > @modelcontextprotocol/sdk/server/mcp.js",
							"emdash > @modelcontextprotocol/sdk/server/webStandardStreamableHttp.js",
							"emdash > @emdash-cms/admin > @lingui/react",
							"emdash > @emdash-cms/admin > @cloudflare/kumo/primitives",
							"react",
							"react/jsx-dev-runtime",
							"react/jsx-runtime",
							"react-dom",
							"react-dom/server",
							"astro > zod/v4",
							"astro > zod/v4/core",
							"astro/zod",
							"emdash > zod",
							"@emdash-cms/cloudflare > kysely-d1",
							"astro/virtual-modules/middleware.js",
							"astro/virtual-modules/live-config",
							"astro/content/runtime",
							"astro/assets/utils/inferRemoteSize.js",
							"astro/assets/fonts/runtime.js",
							"astro/assets/services/noop",
							"@astrojs/cloudflare/image-service",
							"@astrojs/cloudflare/image-transform-endpoint",
						],
					},
				}
			: {
					external: NODE_NATIVE_EXTERNALS,
					noExternal: ["emdash", "@emdash-cms/admin"],
				},
		optimizeDeps: {
			include: useSource
				? ["@astrojs/react/client.js"]
				: ["@emdash-cms/admin", "@astrojs/react/client.js"],
			exclude: cloudflare ? ["virtual:emdash"] : [...NODE_NATIVE_EXTERNALS, "virtual:emdash"],
		},
	};
}

function isBabelTransform(
	value: unknown,
): value is Pick<typeof import("@babel/core"), "transformAsync"> {
	return (
		value !== null &&
		typeof value === "object" &&
		"transformAsync" in value &&
		typeof value.transformAsync === "function"
	);
}
