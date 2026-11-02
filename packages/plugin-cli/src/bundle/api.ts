import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

import { buildPlugin, BuildError, type BuildLogger, type BuildResult } from "../build/api.js";
import { CAPABILITY_RENAMES, isDeprecatedCapability, type PluginManifest } from "./types.js";
import {
	collectBundleEntries,
	createTarball,
	fileExists,
	findNodeBuiltinImports,
	formatBytes,
	ICON_SIZE,
	MAX_SCREENSHOTS,
	MAX_SCREENSHOT_HEIGHT,
	MAX_SCREENSHOT_WIDTH,
	readImageDimensions,
	totalBundleBytes,
	validateBundleSize,
} from "./utils.js";

const SLASH_RE = /\//g;
const LEADING_AT_RE = /^@/;

export type BundleErrorCode =
	| "MISSING_MANIFEST"
	| "MISSING_PLUGIN_ENTRY"
	| "MANIFEST_INVALID"
	| "PACKAGE_JSON_INVALID"
	| "VERSION_MISMATCH"
	| "VERSION_MISSING"
	| "RUNTIME_BUILD_FAILED"
	| "PROBE_BUILD_FAILED"
	| "INVALID_PLUGIN_FORMAT"
	| "TRUSTED_ONLY_FEATURE"
	| "VALIDATION_FAILED";

export class BundleError extends Error {
	override readonly name = "BundleError";
	readonly code: BundleErrorCode;

	constructor(code: BundleErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

export type BundleLogger = BuildLogger;

export interface BundleOptions {
	dir: string;
	outDir?: string;
	validateOnly?: boolean;
	logger?: BundleLogger;
}

export interface BundleResult {
	manifest: PluginManifest;
	tarballPath: string | null;
	tarballBytes: number | null;
	sha256: string | null;
	warnings: string[];
}

export async function bundlePlugin(options: BundleOptions): Promise<BundleResult> {
	const log = options.logger ?? {};
	const pluginDir = resolve(options.dir);
	const outDir = resolve(pluginDir, options.outDir ?? "dist");
	const validateOnly = options.validateOnly ?? false;
	const warnings: string[] = [];
	const warn = (msg: string) => {
		warnings.push(msg);
		log.warn?.(msg);
	};

	log.start?.(validateOnly ? "Validating plugin..." : "Bundling plugin...");

	let build: BuildResult;
	try {
		build = await buildPlugin({ dir: pluginDir, outDir, logger: log });
	} catch (error) {
		if (error instanceof BuildError) {
			throw new BundleError(error.code, error.message);
		}
		throw error;
	}

	const manifest = build.wireManifest;
	const resolvedPlugin = build.resolvedPlugin;

	log.success?.(`Plugin: ${manifest.id}@${manifest.version}`);
	log.info?.(
		`  Capabilities: ${
			manifest.capabilities.length > 0 ? manifest.capabilities.join(", ") : "(none)"
		}`,
	);

	const tmpDir = await mkdtemp(join(tmpdir(), "emdash-bundle-"));
	try {
		const bundleDir = join(tmpDir, "bundle");
		await mkdir(bundleDir, { recursive: true });

		await copyFile(build.files.runtime, join(bundleDir, "backend.js"));

		await copyFile(build.files.manifestJson, join(bundleDir, "manifest.json"));

		log.start?.("Validating bundle...");
		const validationErrors: string[] = [];

		const backendCode = await readFile(join(bundleDir, "backend.js"), "utf-8");
		const builtins = findNodeBuiltinImports(backendCode);
		if (builtins.length > 0) {
			validationErrors.push(
				`backend.js imports Node.js built-in modules: ${builtins.join(", ")}. Sandboxed plugins cannot use Node.js APIs.`,
			);
		}

		const declaresUnrestricted =
			manifest.capabilities.includes("network:request:unrestricted") ||
			manifest.capabilities.includes("network:fetch:any");
		const declaresHostRestricted =
			manifest.capabilities.includes("network:request") ||
			manifest.capabilities.includes("network:fetch");
		if (declaresUnrestricted) {
			warn(
				"Plugin declares unrestricted network access (network:request:unrestricted) — it can make requests to any host.",
			);
		} else if (declaresHostRestricted && manifest.allowedHosts.length === 0) {
			warn(
				"Plugin declares network:request capability but no allowedHosts. The lexicon treats this as `unrestricted` access. Add specific host patterns to allowedHosts, or upgrade the capability to network:request:unrestricted. `publish` will refuse this combination.",
			);
		}

		const deprecatedCaps = manifest.capabilities.filter(isDeprecatedCapability);
		if (deprecatedCaps.length > 0) {
			warn("Plugin uses deprecated capability names. Rename them before publishing:");
			for (const cap of deprecatedCaps) {
				warn(`  ${cap} -> ${CAPABILITY_RENAMES[cap]}`);
			}
		}

		if (
			resolvedPlugin.admin?.portableTextBlocks &&
			resolvedPlugin.admin.portableTextBlocks.length > 0
		) {
			warn(
				"Plugin declares portableTextBlocks — these require trusted mode and will be ignored in sandboxed plugins.",
			);
		}
		if (resolvedPlugin.admin?.entry) {
			warn(
				"Plugin declares admin.entry — custom React components require trusted mode. Use Block Kit for sandboxed admin pages.",
			);
		}
		if (resolvedPlugin.hooks["page:fragments"]) {
			warn(
				"Plugin declares page:fragments hook — this is trusted-only and will not work in sandboxed mode.",
			);
		}

		const hasAdminPages = (manifest.admin?.pages?.length ?? 0) > 0;
		const hasAdminWidgets = (manifest.admin?.widgets?.length ?? 0) > 0;
		if (hasAdminPages || hasAdminWidgets) {
			const routeNames = manifest.routes.map((r) => (typeof r === "string" ? r : r.name));
			if (!routeNames.includes("admin")) {
				const declared =
					hasAdminPages && hasAdminWidgets
						? "adminPages and adminWidgets"
						: hasAdminPages
							? "adminPages"
							: "adminWidgets";
				validationErrors.push(
					`Plugin declares ${declared} but the sandbox entry has no "admin" route. Add an admin route handler to serve Block Kit pages.`,
				);
			}
		}

		log.start?.("Collecting assets...");
		await collectAssets({ pluginDir, bundleDir, log, warn });

		const bundleEntries = await collectBundleEntries(bundleDir);
		const sizeViolations = validateBundleSize(bundleEntries);
		if (sizeViolations.length > 0) {
			validationErrors.push(...sizeViolations);
		} else {
			log.info?.(
				`Bundle size: ${formatBytes(totalBundleBytes(bundleEntries))} across ${bundleEntries.length} file${bundleEntries.length === 1 ? "" : "s"}`,
			);
		}

		if (validationErrors.length > 0) {
			throw new BundleError(
				"VALIDATION_FAILED",
				`Bundle validation failed:\n  - ${validationErrors.join("\n  - ")}`,
			);
		}

		log.success?.("Validation passed");

		if (validateOnly) {
			return {
				manifest,
				tarballPath: null,
				tarballBytes: null,
				sha256: null,
				warnings,
			};
		}

		await mkdir(outDir, { recursive: true });
		const tarballName = `${manifest.id.replace(SLASH_RE, "-").replace(LEADING_AT_RE, "")}-${manifest.version}.tar.gz`;
		const tarballPath = join(outDir, tarballName);

		log.start?.("Creating tarball...");
		await createTarball(bundleDir, tarballPath);

		const tarballStat = await stat(tarballPath);
		const tarballBuf = await readFile(tarballPath);
		const sha256 = createHash("sha256").update(tarballBuf).digest("hex");

		log.success?.(`Created ${tarballName} (${(tarballStat.size / 1024).toFixed(1)}KB)`);
		log.info?.(`  SHA-256: ${sha256}`);
		log.info?.(`  Path: ${tarballPath}`);

		return {
			manifest,
			tarballPath,
			tarballBytes: tarballStat.size,
			sha256,
			warnings,
		};
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}

interface CollectAssetsContext {
	pluginDir: string;
	bundleDir: string;
	log: BundleLogger;
	warn: (msg: string) => void;
}

async function collectAssets(ctx: CollectAssetsContext): Promise<void> {
	const { pluginDir, bundleDir, log, warn } = ctx;

	const readmePath = join(pluginDir, "README.md");
	if (await fileExists(readmePath)) {
		await copyFile(readmePath, join(bundleDir, "README.md"));
		log.success?.("Included README.md");
	}

	const iconPath = join(pluginDir, "icon.png");
	if (await fileExists(iconPath)) {
		const iconBuf = await readFile(iconPath);
		const dims = readImageDimensions(iconBuf);
		if (!dims) {
			warn("icon.png is not a valid PNG — skipping");
		} else {
			if (dims[0] !== ICON_SIZE || dims[1] !== ICON_SIZE) {
				warn(
					`icon.png is ${dims[0]}x${dims[1]}, expected ${ICON_SIZE}x${ICON_SIZE} — including anyway`,
				);
			}
			await copyFile(iconPath, join(bundleDir, "icon.png"));
			log.success?.("Included icon.png");
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
					warn(`screenshots/${file} — cannot read dimensions, skipping`);
					continue;
				}
				if (dims[0] > MAX_SCREENSHOT_WIDTH || dims[1] > MAX_SCREENSHOT_HEIGHT) {
					warn(
						`screenshots/${file} is ${dims[0]}x${dims[1]}, max ${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT} — including anyway`,
					);
				}
				await copyFile(filePath, join(bundleDir, "screenshots", file));
			}
			log.success?.(`Included ${screenshotFiles.length} screenshot(s)`);
		}
	}
}
