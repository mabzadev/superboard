import { createHash } from "node:crypto";
import { readFile, stat, mkdir, writeFile, rm, copyFile, symlink, readdir } from "node:fs/promises";
import { resolve, join, extname, basename } from "node:path";

import { defineCommand } from "citty";
import consola from "consola";

import { CAPABILITY_RENAMES, isDeprecatedCapability } from "../../plugins/types.js";
import type { ResolvedPlugin } from "../../plugins/types.js";
import {
	collectBundleEntries,
	createTarball,
	extractManifest,
	fileExists,
	findBuildOutput,
	findNodeBuiltinImports,
	findSourceExports,
	formatBytes,
	ICON_SIZE,
	MAX_SCREENSHOTS,
	MAX_SCREENSHOT_WIDTH,
	MAX_SCREENSHOT_HEIGHT,
	readImageDimensions,
	resolveSourceEntry,
	toFileImportSpecifier,
	totalBundleBytes,
	validateBundleSize,
} from "./bundle-utils.js";

const TS_EXT_RE = /\.(tsx?|[mc]?js)$/;
const SLASH_RE = /\//g;
const LEADING_AT_RE = /^@/;
const emdash_SCOPE_RE = /^@emdash-cms\//;

export const bundleCommand = defineCommand({
	meta: {
		name: "bundle",
		description: "Bundle a plugin for marketplace distribution",
	},
	args: {
		dir: {
			type: "string",
			description: "Plugin directory (default: current directory)",
			default: process.cwd(),
		},
		outDir: {
			type: "string",
			alias: "o",
			description: "Output directory for the tarball (default: ./dist)",
			default: "dist",
		},
		validateOnly: {
			type: "boolean",
			description: "Run validation only, skip tarball creation",
			default: false,
		},
	},
	async run({ args }) {
		const pluginDir = resolve(args.dir);
		const outDir = resolve(pluginDir, args.outDir);
		const validateOnly = args.validateOnly;

		consola.start(validateOnly ? "Validating plugin..." : "Bundling plugin...");

		const pkgPath = join(pluginDir, "package.json");
		if (!(await fileExists(pkgPath))) {
			consola.error("No package.json found in", pluginDir);
			process.exit(1);
		}

		const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
			name?: string;
			main?: string;
			exports?: Record<string, unknown>;
		};

		let backendEntry: string | undefined;
		let adminEntry: string | undefined;

		if (pkg.exports) {
			const sandboxExport = pkg.exports["./sandbox"];
			if (typeof sandboxExport === "string") {
				backendEntry = await resolveSourceEntry(pluginDir, sandboxExport);
			} else if (sandboxExport && typeof sandboxExport === "object" && "import" in sandboxExport) {
				backendEntry = await resolveSourceEntry(
					pluginDir,
					(sandboxExport as { import: string }).import,
				);
			}

			const adminExport = pkg.exports["./admin"];
			if (typeof adminExport === "string") {
				adminEntry = await resolveSourceEntry(pluginDir, adminExport);
			} else if (adminExport && typeof adminExport === "object" && "import" in adminExport) {
				adminEntry = await resolveSourceEntry(
					pluginDir,
					(adminExport as { import: string }).import,
				);
			}
		}

		if (!backendEntry) {
			const defaultSandbox = join(pluginDir, "src/sandbox-entry.ts");
			if (await fileExists(defaultSandbox)) {
				backendEntry = defaultSandbox;
			}
		}

		let mainEntry: string | undefined;
		if (pkg.exports?.["."] !== undefined) {
			const mainExport = pkg.exports["."];
			if (typeof mainExport === "string") {
				mainEntry = await resolveSourceEntry(pluginDir, mainExport);
			} else if (mainExport && typeof mainExport === "object" && "import" in mainExport) {
				mainEntry = await resolveSourceEntry(pluginDir, (mainExport as { import: string }).import);
			}
		}
		if (!mainEntry && pkg.main) {
			mainEntry = await resolveSourceEntry(pluginDir, pkg.main);
		}
		if (!mainEntry) {
			const defaultMain = join(pluginDir, "src/index.ts");
			if (await fileExists(defaultMain)) {
				mainEntry = defaultMain;
			}
		}

		if (!mainEntry) {
			consola.error(
				"Cannot find plugin entrypoint. Expected src/index.ts or main/exports in package.json",
			);
			process.exit(1);
		}

		consola.info(`Main entry: ${mainEntry}`);
		if (backendEntry) consola.info(`Backend entry: ${backendEntry}`);
		if (adminEntry) consola.info(`Admin entry: ${adminEntry}`);

		consola.start("Extracting plugin manifest...");

		const { build } = await import("tsdown");
		const tmpDir = join(pluginDir, ".emdash-bundle-tmp");

		try {
			await rm(tmpDir, { recursive: true, force: true });
			await mkdir(tmpDir, { recursive: true });

			const mainOutDir = join(tmpDir, "main");
			await build({
				config: false,
				entry: [mainEntry],
				format: "esm",
				outDir: mainOutDir,
				dts: false,
				platform: "node",
				external: ["emdash", emdash_SCOPE_RE],
			});

			const pluginNodeModules = join(pluginDir, "node_modules");
			const tmpNodeModules = join(mainOutDir, "node_modules");
			if (await fileExists(pluginNodeModules)) {
				await symlink(pluginNodeModules, tmpNodeModules, "junction");
			}

			const mainBaseName = basename(mainEntry).replace(TS_EXT_RE, "");
			const mainOutputPath = await findBuildOutput(mainOutDir, mainBaseName);

			if (!mainOutputPath) {
				consola.error("Failed to build main entry — no output found in", mainOutDir);
				process.exit(1);
			}

			const pluginModule = (await import(toFileImportSpecifier(mainOutputPath))) as Record<
				string,
				unknown
			>;

			let resolvedPlugin: ResolvedPlugin | undefined;

			if (typeof pluginModule.createPlugin === "function") {
				resolvedPlugin = pluginModule.createPlugin() as ResolvedPlugin;
			} else if (typeof pluginModule.default === "function") {
				resolvedPlugin = pluginModule.default() as ResolvedPlugin;
			} else if (typeof pluginModule.default === "object" && pluginModule.default !== null) {
				const defaultExport = pluginModule.default as Record<string, unknown>;
				if ("id" in defaultExport && "version" in defaultExport) {
					resolvedPlugin = defaultExport as unknown as ResolvedPlugin;
				}
			}

			if (!resolvedPlugin) {
				for (const [key, value] of Object.entries(pluginModule)) {
					if (key === "default" || typeof value !== "function") continue;
					try {
						const result = (value as () => unknown)() as Record<string, unknown> | null;
						if (result && typeof result === "object" && "id" in result && "version" in result) {
							resolvedPlugin = {
								id: result.id,
								version: result.version,
								capabilities: result.capabilities ?? [],
								allowedHosts: result.allowedHosts ?? [],
								storage: result.storage ?? {},
								hooks: {},
								routes: {},
								admin: {
									pages: result.adminPages,
									widgets: result.adminWidgets,
								},
							} as ResolvedPlugin;

							if (backendEntry) {
								const backendProbeDir = join(tmpDir, "backend-probe");
								const probeShimDir = join(tmpDir, "probe-shims");
								await mkdir(probeShimDir, { recursive: true });
								await writeFile(
									join(probeShimDir, "emdash.mjs"),
									"export const definePlugin = (d) => d;\n",
								);
								await build({
									config: false,
									entry: [backendEntry],
									format: "esm",
									outDir: backendProbeDir,
									dts: false,
									platform: "neutral",
									external: [],
									alias: { emdash: join(probeShimDir, "emdash.mjs") },
									treeshake: true,
								});
								const backendBaseName = basename(backendEntry).replace(TS_EXT_RE, "");
								const backendProbePath = await findBuildOutput(backendProbeDir, backendBaseName);
								if (backendProbePath) {
									const backendModule = (await import(
										toFileImportSpecifier(backendProbePath)
									)) as Record<string, unknown>;
									const standardDef = (backendModule.default ?? {}) as Record<string, unknown>;
									const hooks = standardDef.hooks as Record<string, unknown> | undefined;
									const routes = standardDef.routes as Record<string, unknown> | undefined;
									if (hooks) {
										for (const hookName of Object.keys(hooks)) {
											const hookEntry = hooks[hookName];
											const isConfig =
												typeof hookEntry === "object" &&
												hookEntry !== null &&
												"handler" in hookEntry;
											const config = isConfig ? (hookEntry as Record<string, unknown>) : {};
											(resolvedPlugin.hooks as Record<string, unknown>)[hookName] = {
												handler: isConfig
													? (hookEntry as Record<string, unknown>).handler
													: hookEntry,
												priority: (config.priority as number) ?? 100,
												timeout: (config.timeout as number) ?? 5000,
												dependencies: (config.dependencies as string[]) ?? [],
												errorPolicy: (config.errorPolicy as string) ?? "abort",
												exclusive: (config.exclusive as boolean) ?? false,
												pluginId: result.id,
											};
										}
									}
									if (routes) {
										for (const [name, route] of Object.entries(routes)) {
											const routeObj = route as Record<string, unknown>;
											(resolvedPlugin.routes as Record<string, unknown>)[name] = {
												handler: routeObj.handler,
												public: routeObj.public,
												cacheControl: routeObj.cacheControl,
											};
										}
									}
								}
							}
							break;
						}
					} catch {}
				}
			}

			if (!resolvedPlugin?.id || !resolvedPlugin?.version) {
				consola.error(
					"Could not extract plugin definition. Expected one of:\n" +
						"  - createPlugin() export (native format)\n" +
						"  - Descriptor factory function returning { id, version, ... } (standard format)",
				);
				process.exit(1);
			}

			const manifest = extractManifest(resolvedPlugin);

			if (resolvedPlugin.admin?.entry) {
				consola.error(
					`Plugin declares adminEntry — React admin components require native/trusted mode. ` +
						`Use Block Kit for sandboxed admin pages, or remove adminEntry.`,
				);
				process.exit(1);
			}
			if (
				resolvedPlugin.admin?.portableTextBlocks &&
				resolvedPlugin.admin.portableTextBlocks.length > 0
			) {
				consola.error(
					`Plugin declares portableTextBlocks — these require native/trusted mode ` +
						`and cannot be bundled for the marketplace.`,
				);
				process.exit(1);
			}

			consola.success(`Plugin: ${manifest.id}@${manifest.version}`);
			consola.info(
				`  Capabilities: ${manifest.capabilities.length > 0 ? manifest.capabilities.join(", ") : "(none)"}`,
			);
			consola.info(
				`  Hooks: ${manifest.hooks.length > 0 ? manifest.hooks.map((h) => (typeof h === "string" ? h : h.name)).join(", ") : "(none)"}`,
			);
			consola.info(
				`  Routes: ${manifest.routes.length > 0 ? manifest.routes.map((r) => (typeof r === "string" ? r : r.name)).join(", ") : "(none)"}`,
			);

			const bundleDir = join(tmpDir, "bundle");
			await mkdir(bundleDir, { recursive: true });

			if (backendEntry) {
				consola.start("Bundling backend...");

				const shimDir = join(tmpDir, "shims");
				await mkdir(shimDir, { recursive: true });
				await writeFile(join(shimDir, "emdash.mjs"), "export const definePlugin = (d) => d;\n");

				await build({
					config: false,
					entry: [backendEntry],
					format: "esm",
					outDir: join(tmpDir, "backend"),
					dts: false,
					platform: "neutral",
					external: [],
					alias: { emdash: join(shimDir, "emdash.mjs") },
					minify: true,
					treeshake: true,
				});

				const backendBaseName = basename(backendEntry).replace(TS_EXT_RE, "");
				const backendOutputPath = await findBuildOutput(join(tmpDir, "backend"), backendBaseName);

				if (backendOutputPath) {
					await copyFile(backendOutputPath, join(bundleDir, "backend.js"));
					consola.success("Built backend.js");
				} else {
					consola.error("Backend build produced no output");
					process.exit(1);
				}
			} else {
				consola.warn("No sandbox entry found — bundle will have no backend.js");
				consola.warn('  Add a "sandbox-entry.ts" in src/ or a "./sandbox" export in package.json');
			}

			if (adminEntry) {
				consola.start("Bundling admin...");
				await build({
					config: false,
					entry: [adminEntry],
					format: "esm",
					outDir: join(tmpDir, "admin"),
					dts: false,
					platform: "neutral",
					external: [],
					minify: true,
					treeshake: true,
				});

				const adminBaseName = basename(adminEntry).replace(TS_EXT_RE, "");
				const adminOutputPath = await findBuildOutput(join(tmpDir, "admin"), adminBaseName);

				if (adminOutputPath) {
					await copyFile(adminOutputPath, join(bundleDir, "admin.js"));
					consola.success("Built admin.js");
				}
			}

			await writeFile(join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));

			consola.start("Collecting assets...");

			const readmePath = join(pluginDir, "README.md");
			if (await fileExists(readmePath)) {
				await copyFile(readmePath, join(bundleDir, "README.md"));
				consola.success("Included README.md");
			}

			const iconPath = join(pluginDir, "icon.png");
			if (await fileExists(iconPath)) {
				const iconBuf = await readFile(iconPath);
				const dims = readImageDimensions(iconBuf);
				if (!dims) {
					consola.warn("icon.png is not a valid PNG — skipping");
				} else if (dims[0] !== ICON_SIZE || dims[1] !== ICON_SIZE) {
					consola.warn(
						`icon.png is ${dims[0]}x${dims[1]}, expected ${ICON_SIZE}x${ICON_SIZE} — including anyway`,
					);
					await copyFile(iconPath, join(bundleDir, "icon.png"));
				} else {
					await copyFile(iconPath, join(bundleDir, "icon.png"));
					consola.success("Included icon.png");
				}
			}

			const screenshotsDir = join(pluginDir, "screenshots");
			if (await fileExists(screenshotsDir)) {
				const screenshotFiles = (await readdir(screenshotsDir))
					.filter((f) => {
						const ext = extname(f).toLowerCase();
						return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
					})
					.toSorted()
					.slice(0, MAX_SCREENSHOTS);

				if (screenshotFiles.length > 0) {
					await mkdir(join(bundleDir, "screenshots"), { recursive: true });

					for (const file of screenshotFiles) {
						const filePath = join(screenshotsDir, file);
						const buf = await readFile(filePath);

						const dims = readImageDimensions(buf);

						if (!dims) {
							consola.warn(`screenshots/${file} — cannot read dimensions, skipping`);
							continue;
						}

						if (dims[0] > MAX_SCREENSHOT_WIDTH || dims[1] > MAX_SCREENSHOT_HEIGHT) {
							consola.warn(
								`screenshots/${file} is ${dims[0]}x${dims[1]}, max ${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT} — including anyway`,
							);
						}

						await copyFile(filePath, join(bundleDir, "screenshots", file));
					}

					consola.success(`Included ${screenshotFiles.length} screenshot(s)`);
				}
			}

			consola.start("Validating bundle...");
			let hasErrors = false;

			if (pkg.exports) {
				for (const issue of findSourceExports(pkg.exports)) {
					consola.error(
						`Export "${issue.exportPath}" points to source (${issue.resolvedPath}). ` +
							`Package exports must point to built files (e.g. dist/*.mjs). ` +
							`Add a build step and update the exports map.`,
					);
					hasErrors = true;
				}
			}

			const backendPath = join(bundleDir, "backend.js");
			if (await fileExists(backendPath)) {
				const backendCode = await readFile(backendPath, "utf-8");
				const builtins = findNodeBuiltinImports(backendCode);
				if (builtins.length > 0) {
					consola.error(`backend.js imports Node.js built-in modules: ${builtins.join(", ")}`);
					consola.error("Sandboxed plugins cannot use Node.js APIs");
					hasErrors = true;
				}
			}

			const declaresUnrestricted =
				manifest.capabilities.includes("network:request:unrestricted") ||
				manifest.capabilities.includes("network:fetch:any");
			const declaresHostRestricted =
				manifest.capabilities.includes("network:request") ||
				manifest.capabilities.includes("network:fetch");
			if (declaresUnrestricted) {
				consola.warn(
					"Plugin declares unrestricted network access (network:request:unrestricted) — it can make requests to any host",
				);
			} else if (declaresHostRestricted && manifest.allowedHosts.length === 0) {
				consola.warn(
					"Plugin declares network:request capability but no allowedHosts — all requests will be blocked",
				);
			}

			const deprecatedCaps = manifest.capabilities.filter(isDeprecatedCapability);
			if (deprecatedCaps.length > 0) {
				consola.warn("Plugin uses deprecated capability names. Rename them before publishing:");
				for (const cap of deprecatedCaps) {
					const replacement = CAPABILITY_RENAMES[cap];
					consola.warn(`  ${cap} → ${replacement}`);
				}
			}

			if (
				resolvedPlugin.admin?.portableTextBlocks &&
				resolvedPlugin.admin.portableTextBlocks.length > 0
			) {
				consola.warn(
					"Plugin declares portableTextBlocks — these require trusted mode and will be ignored in sandboxed plugins",
				);
			}
			if (resolvedPlugin.admin?.entry) {
				consola.warn(
					"Plugin declares admin.entry — custom React components require trusted mode. Use Block Kit for sandboxed admin pages",
				);
			}
			if (resolvedPlugin.hooks["page:fragments"]) {
				consola.warn(
					"Plugin declares page:fragments hook — this is trusted-only and will not work in sandboxed mode",
				);
			}

			const hasAdminPages = (manifest.admin?.pages?.length ?? 0) > 0;
			const hasAdminWidgets = (manifest.admin?.widgets?.length ?? 0) > 0;
			if (hasAdminPages || hasAdminWidgets) {
				const routeNames = manifest.routes.map((r: string | { name: string }) =>
					typeof r === "string" ? r : r.name,
				);
				if (!routeNames.includes("admin")) {
					consola.error(
						`Plugin declares ${hasAdminPages ? "adminPages" : ""}${hasAdminPages && hasAdminWidgets ? " and " : ""}${hasAdminWidgets ? "adminWidgets" : ""} ` +
							`but the sandbox entry has no "admin" route. ` +
							`Add an admin route handler to serve Block Kit pages.`,
					);
					hasErrors = true;
				}
			}

			const bundleEntries = await collectBundleEntries(bundleDir);
			const sizeViolations = validateBundleSize(bundleEntries);
			if (sizeViolations.length > 0) {
				for (const v of sizeViolations) consola.error(v);
				hasErrors = true;
			} else {
				consola.info(
					`Bundle size: ${formatBytes(totalBundleBytes(bundleEntries))} across ${bundleEntries.length} file${bundleEntries.length === 1 ? "" : "s"}`,
				);
			}

			if (hasErrors) {
				consola.error("Bundle validation failed");
				process.exit(1);
			}

			consola.success("Validation passed");

			if (validateOnly) {
				return;
			}

			await mkdir(outDir, { recursive: true });
			const tarballName = `${manifest.id.replace(SLASH_RE, "-").replace(LEADING_AT_RE, "")}-${manifest.version}.tar.gz`;
			const tarballPath = join(outDir, tarballName);

			consola.start("Creating tarball...");
			await createTarball(bundleDir, tarballPath);

			const tarballStat = await stat(tarballPath);
			const tarballSizeKB = (tarballStat.size / 1024).toFixed(1);

			const tarballBuf = await readFile(tarballPath);
			const checksum = createHash("sha256").update(tarballBuf).digest("hex");

			consola.success(`Created ${tarballName} (${tarballSizeKB}KB)`);
			consola.info(`  SHA-256: ${checksum}`);
			consola.info(`  Path: ${tarballPath}`);
		} finally {
			if (tmpDir.endsWith(".emdash-bundle-tmp")) {
				await rm(tmpDir, { recursive: true, force: true });
			}
		}
	},
});
