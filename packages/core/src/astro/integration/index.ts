import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import type { AstroIntegration, AstroIntegrationLogger, AstroIntegrationMiddleware } from "astro";
import { z } from "zod";

import { validateAllowedOrigins, validateOriginShape } from "../../auth/allowed-origins.js";
import { normalizeMigrationConfig } from "../../database/migrations/policy.js";
import { normalizeAstroI18n } from "../../i18n/normalize.js";
import { INTERNAL_MEDIA_PREFIX } from "../../media/normalize.js";
import { getCoreMigrationIdentity } from "../../migrations/identity.js";
import {
	createMigrationIntegrationMetadata,
	MIGRATION_CONFIG_SYMBOL,
} from "../../migrations/integration-metadata.js";
import { buildMigrationManifest } from "../../migrations/manifest-builder.js";
import { writeMigrationManifest } from "../../migrations/manifest-writer.js";
import type { ResolvedPlugin } from "../../plugins/types.js";
import { VERSION } from "../../version.js";
import { local } from "../storage/adapters.js";
import { notoSans } from "./font-provider.js";
import {
	injectCoreRoutes,
	injectBuiltinAuthRoutes,
	injectAuthProviderRoutes,
	injectMcpRoute,
} from "./routes.js";
import type { EmDashConfig } from "./runtime.js";
import { createViteConfig } from "./vite-config.js";

export type {
	EmDashConfig,
	PluginDescriptor,
	SandboxedPluginDescriptor,
	ResolvedPlugin,
} from "./runtime.js";
export { getStoredConfig } from "./runtime.js";

function resolveAstroVersion(): string | undefined {
	try {
		const require = createRequire(import.meta.url);
		const pkg = require("astro/package.json") as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

const DEFAULT_STORAGE = local({
	directory: "./.emdash/uploads",
	baseUrl: "/_emdash/api/media/file",
});

interface ImageRemotePattern {
	protocol?: "http" | "https";
	hostname?: string;
	pathname?: string;
}

export function buildImageRemotePatterns(
	storage: { config?: unknown } | undefined,
	siteUrl: string | undefined,
	command: "dev" | "build" | "preview" | "sync",
): ImageRemotePattern[] {
	const patterns: ImageRemotePattern[] = [];

	const config = storage?.config;
	const publicUrl =
		config && typeof config === "object"
			? (config as { publicUrl?: unknown }).publicUrl
			: undefined;
	if (typeof publicUrl === "string" && publicUrl) {
		try {
			const url = new URL(publicUrl);
			if (url.protocol === "http:" || url.protocol === "https:") {
				const pattern: ImageRemotePattern = {
					protocol: url.protocol === "http:" ? "http" : "https",
					hostname: url.hostname,
				};
				const prefix = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
				if (prefix && prefix !== "/") {
					pattern.pathname = `${prefix}/**`;
				}
				patterns.push(pattern);
			}
		} catch {}
	}

	if (siteUrl) {
		try {
			patterns.push({
				hostname: new URL(siteUrl).hostname,
				pathname: `${INTERNAL_MEDIA_PREFIX}**`,
			});
		} catch {}
	}

	if (command === "dev") {
		patterns.push({ pathname: `${INTERNAL_MEDIA_PREFIX}**` });
	}

	return patterns;
}

const OVERRIDABLE_IMAGE_ENDPOINTS = new Set([
	"astro/assets/endpoint/generic",
	"astro/assets/endpoint/node",
	"astro/assets/endpoint/dev",
	"@astrojs/cloudflare/image-transform-endpoint",
]);

const PASSTHROUGH_IMAGE_ENDPOINTS = new Set(["@astrojs/cloudflare/image-passthrough-endpoint"]);

export function resolveImageEndpoint(opts: {
	imagesDisabled: boolean;
	currentEntrypoint: string | undefined;
	isCloudflare: boolean;
}): { entrypoint?: string; warn?: string } {
	if (opts.imagesDisabled) return {};
	const current = opts.currentEntrypoint;
	if (current === undefined || OVERRIDABLE_IMAGE_ENDPOINTS.has(current)) {
		return {
			entrypoint: opts.isCloudflare
				? "@emdash-cms/cloudflare/image-endpoint"
				: "emdash/image-endpoint",
		};
	}
	if (PASSTHROUGH_IMAGE_ENDPOINTS.has(current)) return {};
	return {
		warn:
			`A custom image.endpoint (${current}) is configured; EmDash will not wrap ` +
			`it, so storage-backed media may render unoptimized.`,
	};
}

export function missingReactIntegrationWarning(
	integrations: readonly { name: string }[],
): string | undefined {
	if (integrations.some((integration) => integration.name === "@astrojs/react")) {
		return undefined;
	}
	return (
		`@astrojs/react is not registered in your Astro config. The EmDash admin UI ` +
		`will not hydrate without it (the page stays on "Loading EmDash..."). ` +
		`Add it to your integrations:\n\n` +
		`  import react from "@astrojs/react";\n` +
		`  export default defineConfig({\n` +
		`    integrations: [react(), emdash({ ... })],\n` +
		`  });`
	);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;

function printBanner(_logger: AstroIntegrationLogger): void {
	const banner = `

  ${bold(cyan("— E M D A S H —"))}  ${dim(`v${VERSION}`)}
   `;
	console.log(banner);
}

function printDevServerInfo(baseUrl: string, mcpEnabled: boolean): void {
	const devBypassUrl = `${baseUrl}/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin`;
	console.log(`\n  ${dim("›")} Admin UI    ${cyan(`${baseUrl}/_emdash/admin`)}`);
	if (mcpEnabled) {
		console.log(`  ${dim("›")} MCP server  ${cyan(`${baseUrl}/_emdash/api/mcp`)}`);
	}
	console.log(`  ${dim("›")} Dev bypass  ${cyan(devBypassUrl)}`);
	console.log(`    ${dim("Skips passkey setup/auth and signs you in as a dev admin")}`);
	console.log("");
}

export function buildMiddlewareEntries(
	config: Pick<EmDashConfig, "middleware" | "playground">,
	root: URL,
): AstroIntegrationMiddleware[] {
	const entries: AstroIntegrationMiddleware[] = [];

	if (config.middleware !== undefined) {
		const configuredEntrypoint = config.middleware?.outer;
		if (
			(typeof configuredEntrypoint !== "string" && !(configuredEntrypoint instanceof URL)) ||
			(typeof configuredEntrypoint === "string" && configuredEntrypoint.trim() === "")
		) {
			throw new Error("middleware.outer must be a non-empty module specifier string or URL.");
		}
		const entrypoint =
			typeof configuredEntrypoint === "string" &&
			(configuredEntrypoint.startsWith("./") || configuredEntrypoint.startsWith("../"))
				? new URL(configuredEntrypoint, root)
				: configuredEntrypoint;
		entries.push({
			entrypoint,
			order: "pre",
		});
	}

	if (config.playground) {
		entries.push({
			entrypoint: config.playground.middlewareEntrypoint,
			order: "pre",
		});
	}

	entries.push(
		{ entrypoint: "emdash/middleware", order: "pre" },
		{ entrypoint: "emdash/middleware/redirect", order: "pre" },
	);

	if (!config.playground) {
		entries.push(
			{ entrypoint: "emdash/middleware/setup", order: "pre" },
			{ entrypoint: "emdash/middleware/auth", order: "pre" },
		);
	}

	entries.push(
		{ entrypoint: "emdash/middleware/media-usage-write-fence", order: "pre" },
		{ entrypoint: "emdash/middleware/request-context", order: "pre" },
	);

	return entries;
}

export function emdash(config: EmDashConfig = {}): AstroIntegration {
	const resolvedConfig: EmDashConfig = {
		...config,
		storage: config.storage ?? DEFAULT_STORAGE,
		migrations: normalizeMigrationConfig(config.migrations),
	};

	if (resolvedConfig.marketplace) {
		const url = resolvedConfig.marketplace;
		try {
			const parsed = new URL(url);
			const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
			if (parsed.protocol !== "https:" && !isLocalhost) {
				throw new Error(
					`Marketplace URL must use HTTPS (got ${parsed.protocol}). ` +
						`Only localhost URLs are allowed over HTTP.`,
				);
			}
		} catch (e) {
			if (e instanceof TypeError) {
				throw new Error(`Invalid marketplace URL: "${url}"`, { cause: e });
			}
			throw e;
		}
		if (!resolvedConfig.sandboxRunner) {
			throw new Error(
				"Marketplace requires `sandboxRunner` to be configured. " +
					"Marketplace plugins run in sandboxed V8 isolates.",
			);
		}
	}

	if (resolvedConfig.siteUrl) {
		const raw = resolvedConfig.siteUrl;
		try {
			const parsed = new URL(raw);
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new Error(`siteUrl must be http or https (got ${parsed.protocol})`);
			}
			resolvedConfig.siteUrl = parsed.origin;
		} catch (e) {
			if (e instanceof TypeError) {
				throw new Error(`Invalid siteUrl: "${raw}"`, { cause: e });
			}
			throw e;
		}
	}

	if (resolvedConfig.allowedOrigins?.length) {
		const tagged = resolvedConfig.allowedOrigins.map((origin) => ({
			origin,
			source: "config.allowedOrigins" as const,
		}));
		resolvedConfig.allowedOrigins = resolvedConfig.siteUrl
			? validateAllowedOrigins(resolvedConfig.siteUrl, tagged)
			: validateOriginShape(tagged);
	}

	const pluginDescriptors = resolvedConfig.plugins ?? [];
	const sandboxedDescriptors = resolvedConfig.sandboxed ?? [];

	for (const descriptor of [...pluginDescriptors, ...sandboxedDescriptors]) {
		if (descriptor.format === "standard") {
			if (descriptor.adminEntry) {
				throw new Error(
					`Plugin "${descriptor.id}" is standard format but declares adminEntry. ` +
						`Standard plugins use Block Kit for admin UI, not React components. ` +
						`Remove adminEntry or change format to "native".`,
				);
			}
			if (descriptor.componentsEntry) {
				throw new Error(
					`Plugin "${descriptor.id}" is standard format but declares componentsEntry. ` +
						`Portable Text block components require native format. ` +
						`Remove componentsEntry or change format to "native".`,
				);
			}
		}
	}

	for (const descriptor of sandboxedDescriptors) {
		if (descriptor.format !== "standard") {
			throw new Error(
				`Plugin "${descriptor.id}" uses the native format and cannot be placed in ` +
					`\`sandboxed: []\`. Native plugins can only run in \`plugins: []\`. ` +
					`To sandbox this plugin, convert it to the standard format.`,
			);
		}
	}

	let _resolvedPlugins: ResolvedPlugin[] = [];

	const serializableConfig: Record<string, unknown> = {
		database: resolvedConfig.database,
		migrations: resolvedConfig.migrations,
		storage: resolvedConfig.storage,
		auth: resolvedConfig.auth,
		authProviders: resolvedConfig.authProviders,
		marketplace: resolvedConfig.marketplace,
		experimental: resolvedConfig.experimental,
		siteUrl: resolvedConfig.siteUrl,
		trustedProxyHeaders: resolvedConfig.trustedProxyHeaders,
		maxUploadSize: resolvedConfig.maxUploadSize,
		admin: resolvedConfig.admin,
		toolbar: resolvedConfig.toolbar,
	};

	const useExternalAuth = !!(resolvedConfig.auth && "entrypoint" in resolvedConfig.auth);

	let astroCommand: "dev" | "build" | "preview" | "sync" | undefined;
	let normalizedI18n: ReturnType<typeof normalizeAstroI18n> = null;
	const migrationMetadata = createMigrationIntegrationMetadata(resolvedConfig.database);

	const integration: AstroIntegration = {
		name: "emdash",
		hooks: {
			"astro:config:setup": ({
				injectRoute,
				addMiddleware,
				logger,
				updateConfig,
				config: astroConfig,
				command,
			}) => {
				astroCommand = command;
				printBanner(logger);
				const astroVersion = resolveAstroVersion();
				if (astroVersion !== undefined) {
					serializableConfig.astroVersion = astroVersion;
				}
				serializableConfig.astroCspEnabled = Boolean(astroConfig.security.csp);
				serializableConfig.trailingSlash = astroConfig.trailingSlash;
				normalizedI18n = normalizeAstroI18n(astroConfig.i18n);
				if (normalizedI18n) serializableConfig.i18n = normalizedI18n;

				const securityConfig: Record<string, unknown> = {
					checkOrigin: false,
					...(resolvedConfig.siteUrl
						? {
								allowedDomains: [{ hostname: new URL(resolvedConfig.siteUrl).hostname }],
							}
						: {}),
				};

				const fontsConfig = resolvedConfig.fonts;
				const emdashFonts =
					fontsConfig === false
						? []
						: [
								{
									provider: notoSans({
										scripts: fontsConfig?.scripts,
									}),
									name: "Noto Sans",
									cssVariable: "--font-emdash",
									weights: ["100 900" as const],
									styles: ["normal" as const, "italic" as const],
									subsets: [
										"latin" as const,
										"latin-ext" as const,
										"cyrillic" as const,
										"cyrillic-ext" as const,
										"devanagari" as const,
										"greek" as const,
										"greek-ext" as const,
										"vietnamese" as const,
									],
									fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
								},
							];

				const imageRemotePatterns = buildImageRemotePatterns(
					resolvedConfig.storage,
					resolvedConfig.siteUrl,
					command,
				);

				const { entrypoint: imageEndpoint, warn: imageEndpointWarning } = resolveImageEndpoint({
					imagesDisabled: resolvedConfig.images === false,
					currentEntrypoint: astroConfig.image?.endpoint?.entrypoint,
					isCloudflare: astroConfig.adapter?.name === "@astrojs/cloudflare",
				});
				if (imageEndpointWarning) logger.warn(imageEndpointWarning);

				const imageConfig: Record<string, unknown> = {};
				if (imageRemotePatterns.length) imageConfig.remotePatterns = imageRemotePatterns;
				if (imageEndpoint) imageConfig.endpoint = { entrypoint: imageEndpoint };

				updateConfig({
					security: securityConfig,
					...(Object.keys(imageConfig).length ? { image: imageConfig } : {}),
					...({ fonts: emdashFonts } as Record<string, unknown>),
					vite: createViteConfig(
						{
							serializableConfig,
							resolvedConfig,
							pluginDescriptors,
							astroConfig,
						},
						command,
					),
				});

				injectCoreRoutes(injectRoute, { srcDir: astroConfig.srcDir });

				if (resolvedConfig.authProviders?.length) {
					injectAuthProviderRoutes(injectRoute, resolvedConfig.authProviders);
				}

				if (!useExternalAuth) {
					injectBuiltinAuthRoutes(injectRoute);
				}

				if (resolvedConfig.mcp !== false) {
					injectMcpRoute(injectRoute);
				}

				for (const middleware of buildMiddlewareEntries(resolvedConfig, astroConfig.root)) {
					addMiddleware(middleware);
				}
			},
			"astro:config:done": async ({ config: finalConfig, logger }) => {
				const warning = missingReactIntegrationWarning(finalConfig.integrations);
				if (warning) logger.warn(warning);

				if (astroCommand !== "build" && astroCommand !== "sync") return;
				if (!migrationMetadata.database) {
					logger.warn(
						"EmDash migration manifest was not written because no database adapter is configured.",
					);
					return;
				}
				if (!migrationMetadata.database.migrations) {
					logger.warn(
						"EmDash migration manifest was not written because the configured database adapter does not support deployment migrations.",
					);
					return;
				}

				const identity = await getCoreMigrationIdentity();
				const manifest = await buildMigrationManifest({
					identity,
					i18n: normalizedI18n,
					database: migrationMetadata.database,
				});
				await writeMigrationManifest(fileURLToPath(finalConfig.root), manifest);
			},
			"astro:server:setup": ({ server, logger }) => {
				if (astroCommand === "dev") {
					server.httpServer?.once("listening", () => {
						const address = server.httpServer?.address();
						if (!address || typeof address === "string") return;
						let host = address.address;
						if (host === "::1" || host === "::" || host === "0.0.0.0") {
							host = "localhost";
						} else if (address.family === "IPv6") {
							host = `[${host}]`;
						}
						printDevServerInfo(`http://${host}:${address.port}`, resolvedConfig.mcp !== false);
					});
				}

				server.httpServer?.once("listening", async () => {
					const { writeFile, readFile } = await import("node:fs/promises");
					const { resolve } = await import("node:path");

					const address = server.httpServer?.address();
					if (!address || typeof address === "string") return;

					const port = address.port;
					const typegenUrl = `http://localhost:${port}/_emdash/api/typegen`;
					const outputPath = resolve(process.cwd(), "emdash-env.d.ts");

					try {
						const response = await fetch(typegenUrl, {
							method: "POST",
							headers: { "Content-Type": "application/json" },
						});

						if (!response.ok) {
							const body = await response.text().catch(() => "");
							logger.warn(`Typegen failed: ${response.status} ${body.slice(0, 200)}`);
							return;
						}

						const { data: result } = z
							.object({
								data: z.object({ types: z.string(), hash: z.string(), collections: z.number() }),
							})
							.parse(await response.json());

						let needsWrite = true;
						try {
							const existing = await readFile(outputPath, "utf-8");
							if (existing === result.types) needsWrite = false;
						} catch {}

						if (needsWrite) {
							await writeFile(outputPath, result.types, "utf-8");
							logger.info(`Generated emdash-env.d.ts (${result.collections} collections)`);
						}
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						logger.warn(`Typegen failed: ${msg}`);
					}
				});
			},
			"astro:build:done": ({ logger }) => {
				logger.info("Build complete");
			},
		},
	};

	Object.defineProperty(integration, MIGRATION_CONFIG_SYMBOL, {
		value: migrationMetadata,
		enumerable: false,
	});
	return integration;
}

export default emdash;
