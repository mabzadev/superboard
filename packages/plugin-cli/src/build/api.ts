import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { PluginManifest, ResolvedPlugin } from "../bundle/types.js";
import { extractManifest } from "../bundle/utils.js";
import type { NormalisedManifest } from "../manifest/translate.js";
import {
	buildRuntime,
	probeAndAssemble,
	resolveSources,
	BuildPipelineError,
	type BuildPipelineErrorCode,
	type PipelineLogger,
	type ResolvedSources,
} from "./pipeline.js";

export type BuildErrorCode = BuildPipelineErrorCode;

export class BuildError extends Error {
	override readonly name = "BuildError";
	readonly code: BuildErrorCode;

	constructor(code: BuildErrorCode, message: string) {
		super(message);
		this.code = code;
	}
}

export type BuildLogger = PipelineLogger;

export interface BuildOptions {
	dir: string;
	outDir?: string;
	logger?: BuildLogger;
}

export interface BuildResult {
	manifest: NormalisedManifest;
	packageName: string | undefined;
	wireManifest: PluginManifest;
	resolvedPlugin: ResolvedPlugin;
	outDir: string;
	files: {
		runtime: string;
		runtimeTypes: string;
		manifestJson: string;
		descriptor: string | undefined;
		descriptorTypes: string | undefined;
	};
}

export async function buildPlugin(options: BuildOptions): Promise<BuildResult> {
	const log = options.logger ?? {};
	const pluginDir = resolve(options.dir);
	const outDir = resolve(pluginDir, options.outDir ?? "dist");

	log.start?.("Building plugin...");

	let sources: ResolvedSources;
	try {
		sources = await resolveSources(pluginDir, log);
	} catch (error) {
		if (error instanceof BuildPipelineError) {
			throw new BuildError(error.code, error.message);
		}
		throw error;
	}

	const tmpDir = await mkdtemp(join(tmpdir(), "emdash-build-"));

	try {
		const { build } = await import("tsdown");

		await mkdir(outDir, { recursive: true });

		log.start?.("Building runtime entry...");
		const runtimeFiles = await runPipelineStep(() =>
			buildRuntime({
				entries: sources,
				outDir,
				tmpDir,
				build,
			}),
		);
		log.success?.("Built plugin.mjs");

		log.start?.("Probing plugin surface...");
		const resolvedPlugin = await runPipelineStep(() =>
			probeAndAssemble({
				entries: sources,
				tmpDir,
				build,
			}),
		);

		const wireManifest = extractManifest(resolvedPlugin);
		log.info?.(
			`  Hooks: ${
				wireManifest.hooks.length > 0
					? wireManifest.hooks.map((h) => (typeof h === "string" ? h : h.name)).join(", ")
					: "(none)"
			}`,
		);
		log.info?.(
			`  Routes: ${
				wireManifest.routes.length > 0
					? wireManifest.routes.map((r) => (typeof r === "string" ? r : r.name)).join(", ")
					: "(none)"
			}`,
		);

		const manifestJson = join(outDir, "manifest.json");
		await writeFile(manifestJson, `${JSON.stringify(wireManifest, null, 2)}\n`, "utf-8");
		log.success?.("Wrote manifest.json");

		let descriptor: string | undefined;
		let descriptorTypes: string | undefined;
		if (sources.hasPackageJson && sources.packageName) {
			log.start?.("Generating descriptor module...");
			({ descriptor, descriptorTypes } = await writeDescriptor({
				outDir,
				manifest: sources.manifest,
				wireManifest,
				packageName: sources.packageName,
			}));
			log.success?.("Wrote index.mjs");
		} else {
			log.info?.("No package.json — skipping dist/index.mjs (registry-only plugin)");
		}

		log.success?.(`Plugin built: ${sources.manifest.slug}@${sources.manifest.version}`);

		return {
			manifest: sources.manifest,
			packageName: sources.packageName,
			wireManifest,
			resolvedPlugin,
			outDir,
			files: {
				runtime: runtimeFiles.runtime,
				runtimeTypes: runtimeFiles.runtimeTypes,
				manifestJson,
				descriptor,
				descriptorTypes,
			},
		};
	} finally {
		await rm(tmpDir, { recursive: true, force: true });
	}
}

async function runPipelineStep<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof BuildPipelineError) {
			throw new BuildError(error.code, error.message);
		}
		throw error;
	}
}

interface WriteDescriptorContext {
	outDir: string;
	manifest: NormalisedManifest;
	wireManifest: PluginManifest;
	packageName: string;
}

interface DescriptorFiles {
	descriptor: string;
	descriptorTypes: string;
}

async function writeDescriptor(ctx: WriteDescriptorContext): Promise<DescriptorFiles> {
	const { outDir, manifest, wireManifest, packageName } = ctx;

	const descriptorObject = {
		id: manifest.slug,
		version: manifest.version,
		format: "standard" as const,
		entrypoint: `${packageName}/sandbox`,
		capabilities: manifest.capabilities,
		allowedHosts: manifest.allowedHosts,
		storage: manifest.storage,
		...(wireManifest.mcp ? { mcp: wireManifest.mcp } : {}),
		...(manifest.admin.pages.length > 0 ? { adminPages: manifest.admin.pages } : {}),
		...(manifest.admin.widgets.length > 0 ? { adminWidgets: manifest.admin.widgets } : {}),
	};

	const descriptorLiteral = JSON.stringify(descriptorObject, null, "\t");

	const descriptorSource = `// Auto-generated by emdash-plugin build. Do not edit.
// Source: emdash-plugin.jsonc + package.json
//
// Default-exports a sandboxed plugin descriptor. Pass it directly into
// emdash's \`plugins:\` or \`sandboxed:\` array — no factory call needed.

/** @type {import("emdash").PluginDescriptor} */
const descriptor = Object.freeze(${descriptorLiteral});

export default descriptor;
`;

	const descriptorPath = join(outDir, "index.mjs");
	await writeFile(descriptorPath, descriptorSource, "utf-8");

	const descriptorTypesSource = `// Auto-generated by emdash-plugin build. Do not edit.
import type { PluginDescriptor } from "emdash";

declare const descriptor: PluginDescriptor;
export default descriptor;
`;
	const descriptorTypesPath = join(outDir, "index.d.mts");
	await writeFile(descriptorTypesPath, descriptorTypesSource, "utf-8");

	return { descriptor: descriptorPath, descriptorTypes: descriptorTypesPath };
}
