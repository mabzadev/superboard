import { createWriteStream } from "node:fs";
import { readdir, stat, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

import { imageSize } from "image-size";
import { packTar } from "modern-tar/fs";
import { z } from "zod";

import { capabilitiesToDeclaredAccess } from "../../plugins/types.js";
import type {
	PluginManifest,
	ResolvedPlugin,
	HookName,
	ManifestHookEntry,
	ManifestMcpTool,
	ManifestRouteEntry,
} from "../../plugins/types.js";

export const MAX_BUNDLE_SIZE = 256 * 1024;
export const MAX_FILE_SIZE = 128 * 1024;
export const MAX_FILE_COUNT = 20;

export const MAX_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_WIDTH = 1920;
export const MAX_SCREENSHOT_HEIGHT = 1080;
export const ICON_SIZE = 256;
const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const NODE_BUILTIN_IMPORT_RE =
	/(?:import|export|require)\s*(?:\(|[^(]*?\bfrom\s+)["'](?:node:)?([a-z_]+)(?:\/[^"']*)?\s*["']\)?/g;
const LEADING_DOT_SLASH_RE = /^\.\//;
const DIST_PREFIX_RE = /^dist\//;
const MJS_EXT_RE = /\.m?js$/;
const TS_TO_TSX_RE = /\.ts$/;

const NODE_BUILTINS = new Set([
	"assert",
	"buffer",
	"child_process",
	"cluster",
	"crypto",
	"dgram",
	"dns",
	"domain",
	"events",
	"fs",
	"http",
	"http2",
	"https",
	"inspector",
	"module",
	"net",
	"os",
	"path",
	"perf_hooks",
	"process",
	"punycode",
	"querystring",
	"readline",
	"repl",
	"stream",
	"string_decoder",
	"sys",
	"timers",
	"tls",
	"trace_events",
	"tty",
	"url",
	"util",
	"v8",
	"vm",
	"wasi",
	"worker_threads",
	"zlib",
]);

export async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export function toFileImportSpecifier(path: string): string {
	return pathToFileURL(path).href;
}

export function readImageDimensions(buf: Uint8Array): [number, number] | null {
	try {
		const result = imageSize(buf);
		if (result.width != null && result.height != null) {
			return [result.width, result.height];
		}
		return null;
	} catch {
		return null;
	}
}

export function extractManifest(plugin: ResolvedPlugin): PluginManifest {
	const hooks: Array<ManifestHookEntry | HookName> = [];
	for (const [name, resolved] of Object.entries(plugin.hooks)) {
		if (!resolved) continue;
		const hasMetadata =
			resolved.exclusive || resolved.priority !== 100 || resolved.timeout !== 5000;
		if (hasMetadata) {
			const entry: ManifestHookEntry = { name };
			if (resolved.exclusive) entry.exclusive = true;
			if (resolved.priority !== 100) entry.priority = resolved.priority;
			if (resolved.timeout !== 5000) entry.timeout = resolved.timeout;
			hooks.push(entry);
		} else {
			hooks.push(name as HookName);
		}
	}

	const routes: Array<ManifestRouteEntry | string> = Object.entries(plugin.routes).map(
		([name, route]) => {
			if (
				route.public === undefined &&
				route.permission === undefined &&
				route.cacheControl === undefined
			) {
				return name;
			}

			const entry: ManifestRouteEntry = { name };
			if (route.public !== undefined) entry.public = route.public;
			if (route.permission !== undefined) entry.permission = route.permission;
			if (route.cacheControl !== undefined) entry.cacheControl = route.cacheControl;
			return entry;
		},
	);
	const tools: ManifestMcpTool[] = Object.entries(plugin.mcp?.tools ?? {}).map(([name, tool]) => {
		if (!MCP_TOOL_NAME_PATTERN.test(name)) throw new Error(`Invalid MCP tool name "${name}"`);
		const route = plugin.routes[tool.route];
		if (!route?.permission || route.public) {
			throw new Error(`MCP tool "${name}" must reference a private route with a permission`);
		}
		return {
			name,
			description: tool.description,
			route: tool.route,
			permission: route.permission,
			destructive: tool.destructive ?? false,
			inputSchema: z.toJSONSchema(tool.input, { target: "draft-7" }),
			...(tool.output
				? {
						outputSchema: z.toJSONSchema(tool.output, { target: "draft-7" }),
					}
				: {}),
		};
	});

	return {
		id: plugin.id,
		version: plugin.version,
		declaredAccess: capabilitiesToDeclaredAccess(plugin.capabilities, plugin.allowedHosts),
		capabilities: plugin.capabilities,
		allowedHosts: plugin.allowedHosts,
		storage: plugin.storage,
		hooks,
		routes,
		...(tools.length > 0 ? { mcp: { tools } } : {}),
		admin: {
			settingsSchema: plugin.admin.settingsSchema,
			pages: plugin.admin.pages,
			widgets: plugin.admin.widgets,
		},
	};
}

export function findNodeBuiltinImports(code: string): string[] {
	const found: string[] = [];
	NODE_BUILTIN_IMPORT_RE.lastIndex = 0;
	let match;
	while ((match = NODE_BUILTIN_IMPORT_RE.exec(code)) !== null) {
		const mod = match[1];
		if (NODE_BUILTINS.has(mod)) {
			found.push(mod);
		}
	}
	return [...new Set(found)];
}

export async function findBuildOutput(dir: string, baseName: string): Promise<string | undefined> {
	for (const ext of [".mjs", ".js", ".cjs"]) {
		const candidate = join(dir, `${baseName}${ext}`);
		if (await fileExists(candidate)) return candidate;
	}
	return undefined;
}

export async function resolveSourceEntry(
	pluginDir: string,
	distPath: string,
): Promise<string | undefined> {
	const cleaned = distPath.replace(LEADING_DOT_SLASH_RE, "");

	const srcPath = cleaned.replace(DIST_PREFIX_RE, "src/").replace(MJS_EXT_RE, ".ts");
	const srcFull = resolve(pluginDir, srcPath);
	if (await fileExists(srcFull)) return srcFull;

	const tsxPath = srcPath.replace(TS_TO_TSX_RE, ".tsx");
	const tsxFull = resolve(pluginDir, tsxPath);
	if (await fileExists(tsxFull)) return tsxFull;

	const direct = resolve(pluginDir, cleaned);
	if (await fileExists(direct)) return direct;

	return undefined;
}

const TS_SOURCE_EXPORT_RE = /\.(?:ts|tsx|mts|cts|jsx)$/;

export function findSourceExports(
	exports: Record<string, unknown>,
): Array<{ exportPath: string; resolvedPath: string }> {
	const issues: Array<{ exportPath: string; resolvedPath: string }> = [];
	for (const [exportPath, exportValue] of Object.entries(exports)) {
		const resolved =
			typeof exportValue === "string"
				? exportValue
				: exportValue && typeof exportValue === "object" && "import" in exportValue
					? (exportValue as { import: string }).import
					: null;
		if (resolved && TS_SOURCE_EXPORT_RE.test(resolved)) {
			issues.push({ exportPath, resolvedPath: resolved });
		}
	}
	return issues;
}

export interface BundleFileEntry {
	name: string;
	bytes: number;
}

export async function collectBundleEntries(dir: string): Promise<BundleFileEntry[]> {
	const entries: BundleFileEntry[] = [];
	await walkBundle(dir, "", entries);
	return entries;
}

async function walkBundle(dir: string, prefix: string, into: BundleFileEntry[]): Promise<void> {
	const items = await readdir(dir, { withFileTypes: true });
	for (const item of items) {
		const fullPath = join(dir, item.name);
		const relPath = prefix ? `${prefix}/${item.name}` : item.name;
		if (item.isFile()) {
			const s = await stat(fullPath);
			into.push({ name: relPath, bytes: s.size });
		} else if (item.isDirectory()) {
			await walkBundle(fullPath, relPath, into);
		}
	}
}

export function totalBundleBytes(entries: readonly BundleFileEntry[]): number {
	let total = 0;
	for (const e of entries) total += e.bytes;
	return total;
}

export function validateBundleSize(entries: readonly BundleFileEntry[]): string[] {
	const violations: string[] = [];
	const total = totalBundleBytes(entries);
	if (total > MAX_BUNDLE_SIZE) {
		violations.push(
			`Bundle size ${formatBytes(total)} exceeds maximum of ${formatBytes(MAX_BUNDLE_SIZE)}.`,
		);
	}
	if (entries.length > MAX_FILE_COUNT) {
		violations.push(
			`Bundle contains ${entries.length} files, exceeds maximum of ${MAX_FILE_COUNT}.`,
		);
	}
	const oversized = entries
		.filter((e) => e.bytes > MAX_FILE_SIZE)
		.toSorted((a, b) => a.name.localeCompare(b.name));
	for (const e of oversized) {
		violations.push(
			`File ${e.name} is ${formatBytes(e.bytes)}, exceeds per-file maximum of ${formatBytes(MAX_FILE_SIZE)}.`,
		);
	}
	return violations;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export async function createTarball(sourceDir: string, outputPath: string): Promise<void> {
	const { createGzip } = await import("node:zlib");
	const tarStream = packTar(sourceDir);
	const gzip = createGzip({ level: 9 });
	const out = createWriteStream(outputPath);
	await pipeline(tarStream, gzip, out);
}
