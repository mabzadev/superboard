import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import type { AuthProviderDescriptor } from "../../auth/types.js";
import type { MediaProviderDescriptor } from "../../media/types.js";
import { defaultSeed } from "../../seed/default.js";
import type { PluginDescriptor } from "./runtime.js";

const TS_SOURCE_EXT_RE = /^\.(ts|tsx|mts|cts|jsx)$/;

const SCOPED_PREFIX_PATTERN = /^@[^/]+\/plugin-/;

const EMDASH_PREFIX_PATTERN = /^emdash-plugin-/;

export const VIRTUAL_CONFIG_ID = "virtual:emdash/config";
export const RESOLVED_VIRTUAL_CONFIG_ID = "\0" + VIRTUAL_CONFIG_ID;

export const VIRTUAL_DIALECT_ID = "virtual:emdash/dialect";
export const RESOLVED_VIRTUAL_DIALECT_ID = "\0" + VIRTUAL_DIALECT_ID;

export const VIRTUAL_STORAGE_ID = "virtual:emdash/storage";
export const RESOLVED_VIRTUAL_STORAGE_ID = "\0" + VIRTUAL_STORAGE_ID;

export const VIRTUAL_OBJECT_CACHE_ID = "virtual:emdash/object-cache";
export const RESOLVED_VIRTUAL_OBJECT_CACHE_ID = "\0" + VIRTUAL_OBJECT_CACHE_ID;

export const VIRTUAL_ADMIN_REGISTRY_ID = "virtual:emdash/admin-registry";
export const RESOLVED_VIRTUAL_ADMIN_REGISTRY_ID = "\0" + VIRTUAL_ADMIN_REGISTRY_ID;

export const VIRTUAL_PLUGINS_ID = "virtual:emdash/plugins";
export const RESOLVED_VIRTUAL_PLUGINS_ID = "\0" + VIRTUAL_PLUGINS_ID;

export const VIRTUAL_SANDBOX_RUNNER_ID = "virtual:emdash/sandbox-runner";
export const RESOLVED_VIRTUAL_SANDBOX_RUNNER_ID = "\0" + VIRTUAL_SANDBOX_RUNNER_ID;

export const VIRTUAL_SANDBOXED_PLUGINS_ID = "virtual:emdash/sandboxed-plugins";
export const RESOLVED_VIRTUAL_SANDBOXED_PLUGINS_ID = "\0" + VIRTUAL_SANDBOXED_PLUGINS_ID;

export const VIRTUAL_AUTH_ID = "virtual:emdash/auth";
export const RESOLVED_VIRTUAL_AUTH_ID = "\0" + VIRTUAL_AUTH_ID;

export const VIRTUAL_AUTH_PROVIDERS_ID = "virtual:emdash/auth-providers";
export const RESOLVED_VIRTUAL_AUTH_PROVIDERS_ID = "\0" + VIRTUAL_AUTH_PROVIDERS_ID;

export const VIRTUAL_MEDIA_PROVIDERS_ID = "virtual:emdash/media-providers";
export const RESOLVED_VIRTUAL_MEDIA_PROVIDERS_ID = "\0" + VIRTUAL_MEDIA_PROVIDERS_ID;

export const VIRTUAL_BLOCK_COMPONENTS_ID = "virtual:emdash/block-components";
export const RESOLVED_VIRTUAL_BLOCK_COMPONENTS_ID = "\0" + VIRTUAL_BLOCK_COMPONENTS_ID;

export const VIRTUAL_SEED_ID = "virtual:emdash/seed";
export const RESOLVED_VIRTUAL_SEED_ID = "\0" + VIRTUAL_SEED_ID;

export const VIRTUAL_WAIT_UNTIL_ID = "virtual:emdash/wait-until";
export const RESOLVED_VIRTUAL_WAIT_UNTIL_ID = "\0" + VIRTUAL_WAIT_UNTIL_ID;

export const VIRTUAL_SCHEDULER_ID = "virtual:emdash/scheduler";
export const RESOLVED_VIRTUAL_SCHEDULER_ID = "\0" + VIRTUAL_SCHEDULER_ID;

export const VIRTUAL_ENV_ID = "virtual:emdash/env";
export const RESOLVED_VIRTUAL_ENV_ID = "\0" + VIRTUAL_ENV_ID;

export const VIRTUAL_BUILD_ID = "virtual:emdash/build";
export const RESOLVED_VIRTUAL_BUILD_ID = "\0" + VIRTUAL_BUILD_ID;

export function generateConfigModule(serializableConfig: Record<string, unknown>): string {
	return `export default ${JSON.stringify(serializableConfig)};`;
}

export function generateDialectModule(opts: {
	entrypoint?: string;
	type?: string;
	supportsRequestScope: boolean;
	supportsCoalescing: boolean;
	supportsCollectionDeletionGuard: boolean;
}): string {
	const { entrypoint, supportsRequestScope, supportsCoalescing, supportsCollectionDeletionGuard } =
		opts;
	if (!entrypoint) {
		return [
			`export const createDialect = undefined;`,
			`export const dialectType = "sqlite";`,
			`export const createRequestScopedDb = (_opts) => null;`,
			`export const createCoalescingDialect = undefined;`,
			`export const executeCollectionDeletionGuard = undefined;`,
		].join("\n");
	}
	const type = opts.type ?? "sqlite";

	const coalescingExport = supportsCoalescing
		? `import { createCoalescingDialect as _createCoalescingDialect } from "${entrypoint}";
export const createCoalescingDialect = _createCoalescingDialect;`
		: `export const createCoalescingDialect = undefined;`;
	const collectionDeletionExport = supportsCollectionDeletionGuard
		? `export { executeCollectionDeletionGuard } from "${entrypoint}";`
		: `export const executeCollectionDeletionGuard = undefined;`;

	if (supportsRequestScope) {
		return `
import { createDialect as _createDialect } from "${entrypoint}";
export { createRequestScopedDb } from "${entrypoint}";
${coalescingExport}
${collectionDeletionExport}
export const createDialect = _createDialect;
export const dialectType = ${JSON.stringify(type)};
`;
	}

	return `
import { createDialect as _createDialect } from "${entrypoint}";
${coalescingExport}
${collectionDeletionExport}
export const createDialect = _createDialect;
export const dialectType = ${JSON.stringify(type)};
export const createRequestScopedDb = (_opts) => null;
`;
}

export function generateStorageModule(storageEntrypoint?: string): string {
	if (!storageEntrypoint) {
		return `export const createStorage = undefined;`;
	}
	return `
import { createStorage as _createStorage } from "${storageEntrypoint}";
export const createStorage = _createStorage;
`;
}

export function generateObjectCacheModule(
	entrypoint?: string,
	config?: Record<string, unknown>,
): string {
	if (!entrypoint) {
		return [
			`export const createObjectCache = undefined;`,
			`export const objectCacheConfig = undefined;`,
		].join("\n");
	}
	return `
import { createObjectCache as _createObjectCache } from "${entrypoint}";
export const createObjectCache = _createObjectCache;
export const objectCacheConfig = ${JSON.stringify(config ?? {})};
`;
}

export function generateAuthModule(authEntrypoint?: string): string {
	if (!authEntrypoint) {
		return `export const authenticate = undefined;`;
	}
	return `
import { authenticate as _authenticate } from "${authEntrypoint}";
export const authenticate = _authenticate;
`;
}

export function generateAuthProvidersModule(descriptors: AuthProviderDescriptor[]): string {
	const withAdmin = descriptors.filter((d) => d.adminEntry);

	if (withAdmin.length === 0) {
		return `export const authProviders = {};`;
	}

	const imports: string[] = [];
	const entries: string[] = [];

	withAdmin.forEach((descriptor, index) => {
		const varName = `authProvider${index}`;
		imports.push(`import * as ${varName} from ${JSON.stringify(descriptor.adminEntry)};`);
		entries.push(
			`  ${JSON.stringify(descriptor.id)}: { ...${varName}, id: ${JSON.stringify(descriptor.id)}, label: ${JSON.stringify(descriptor.label)} },`,
		);
	});

	return `
// Auto-generated auth provider registry
${imports.join("\n")}

export const authProviders = {
${entries.join("\n")}
};
`;
}

export function generatePluginsModule(descriptors: PluginDescriptor[]): string {
	if (descriptors.length === 0) {
		return `export const plugins = [];`;
	}

	const imports: string[] = [];
	const instantiations: string[] = [];

	let needsAdapter = false;

	descriptors.forEach((descriptor, index) => {
		if (!descriptor.entrypoint) {
			throw new Error(
				`[emdash] Plugin "${descriptor.id}" has no \`entrypoint\`. The astro integration's ` +
					`\`plugins: []\` requires plugins that resolve to a file/package entrypoint so they can be ` +
					`bundled at build time; an in-process \`definePlugin({...})\` result passed directly is not ` +
					`supported. Move the plugin into its own module and reference it via a factory that returns ` +
					`a descriptor with an \`entrypoint\` (e.g. \`plugins: [myPlugin()]\`).`,
			);
		}
		if (descriptor.format === "standard") {
			needsAdapter = true;
			const varName = `pluginDef${index}`;
			imports.push(`import ${varName} from "${descriptor.entrypoint}";`);
			instantiations.push(
				`adaptSandboxEntry(${varName}, ${JSON.stringify({
					id: descriptor.id,
					version: descriptor.version,
					capabilities: descriptor.capabilities,
					allowedHosts: descriptor.allowedHosts,
					storage: descriptor.storage,
					adminPages: descriptor.adminPages,
					adminWidgets: descriptor.adminWidgets,
					settingsSchema: descriptor.settingsSchema,
					portableTextBlocks: descriptor.portableTextBlocks,
					fieldWidgets: descriptor.fieldWidgets,
				})})`,
			);
		} else {
			const varName = `createPlugin${index}`;
			imports.push(`import { createPlugin as ${varName} } from "${descriptor.entrypoint}";`);
			instantiations.push(`${varName}(${JSON.stringify(descriptor.options ?? {})})`);
		}
	});

	const adapterImport = needsAdapter
		? `import { adaptSandboxEntry } from "emdash/plugins/adapt-sandbox-entry";\n`
		: "";

	return `
// Auto-generated plugins module
// Imports and instantiates all configured plugins at runtime

${adapterImport}${imports.join("\n")}

/** Resolved plugins array */
export const plugins = [
  ${instantiations.join(",\n  ")}
];
`;
}

export function generateAdminRegistryModule(descriptors: PluginDescriptor[]): string {
	const adminDescriptors = descriptors.filter((d) => d.adminEntry);

	if (adminDescriptors.length === 0) {
		return `export const pluginAdmins = {};`;
	}

	const imports: string[] = [];
	const entries: string[] = [];

	adminDescriptors.forEach((descriptor, index) => {
		const varName = `admin${index}`;
		const pluginId =
			descriptor.id ??
			descriptor.entrypoint.replace(SCOPED_PREFIX_PATTERN, "").replace(EMDASH_PREFIX_PATTERN, "");

		imports.push(`import * as ${varName} from "${descriptor.adminEntry}";`);
		entries.push(`  "${pluginId}": ${varName},`);
	});

	return `
// Auto-generated plugin admin registry
${imports.join("\n")}

export const pluginAdmins = {
${entries.join("\n")}
};
`;
}

export function generateSandboxRunnerModule(sandboxRunner?: string, sandbox?: boolean): string {
	if (!sandboxRunner) {
		return `
// No sandbox runner configured - sandboxed plugins disabled
import { createNoopSandboxRunner } from "emdash";

export const createSandboxRunner = createNoopSandboxRunner;
export const sandboxEnabled = false;
`;
	}

	if (sandbox === false) {
		return `
// Sandbox explicitly disabled (sandbox: false) - plugins run in-process
import { createNoopSandboxRunner } from "emdash";

export const createSandboxRunner = createNoopSandboxRunner;
export const sandboxEnabled = true;
export const sandboxBypassed = true;
`;
	}

	return `
// Auto-generated sandbox runner module
import { createSandboxRunner as _createSandboxRunner } from "${sandboxRunner}";

export const createSandboxRunner = _createSandboxRunner;
export const sandboxEnabled = true;
`;
}

export function generateMediaProvidersModule(descriptors: MediaProviderDescriptor[]): string {
	const localDisabled = descriptors.some((d) => d.id === "local" && d.config.enabled === false);

	const imports: string[] = [];
	const entries: string[] = [];

	if (!localDisabled) {
		imports.push(
			`import { createMediaProvider as createLocalProvider } from "emdash/media/local-runtime";`,
		);
		entries.push(`{
	id: "local",
	name: "Library",
	icon: "folder",
	capabilities: { browse: true, search: false, upload: true, delete: true },
	createProvider: (ctx) => createLocalProvider({ ...ctx, enabled: true }),
}`);
	}

	descriptors
		.filter((d) => d.id !== "local" || d.config.enabled !== false)
		.filter((d) => d.id !== "local")
		.forEach((descriptor, index) => {
			const varName = `createProvider${index}`;
			imports.push(`import { createMediaProvider as ${varName} } from "${descriptor.entrypoint}";`);
			entries.push(`{
	id: ${JSON.stringify(descriptor.id)},
	name: ${JSON.stringify(descriptor.name)},
	icon: ${JSON.stringify(descriptor.icon)},
	capabilities: ${JSON.stringify(descriptor.capabilities)},
	createProvider: (ctx) => ${varName}({ ...${JSON.stringify(descriptor.config)}, ...ctx }),
}`);
		});

	return `
// Auto-generated media providers module
${imports.join("\n")}

/** Media provider descriptors with factory functions */
export const mediaProviders = [
  ${entries.join(",\n  ")}
];
`;
}

export function generateBlockComponentsModule(descriptors: PluginDescriptor[]): string {
	const withComponents = descriptors.filter((d) => d.componentsEntry);
	if (withComponents.length === 0) {
		return `export const pluginBlockComponents = {};`;
	}

	const imports: string[] = [];
	const spreads: string[] = [];
	withComponents.forEach((d, i) => {
		imports.push(`import { blockComponents as bc${i} } from "${d.componentsEntry}";`);
		spreads.push(`...bc${i}`);
	});

	return `${imports.join("\n")}\nexport const pluginBlockComponents = { ${spreads.join(", ")} };`;
}

export function generateWaitUntilModule(adapterName: string | undefined): string {
	if (adapterName === "@astrojs/cloudflare") {
		return `export { waitUntil } from "cloudflare:workers";`;
	}
	return `export const waitUntil = undefined;`;
}

export function generateEnvModule(adapterName: string | undefined): string {
	if (adapterName === "@astrojs/cloudflare") {
		return `export { env } from "cloudflare:workers";`;
	}
	return `export const env = undefined;`;
}

export function generateBuildModule(buildTime: number): string {
	return `export const buildTime = ${buildTime};`;
}

export function generateSchedulerModule(
	adapterName: string | undefined,
	command: "build" | "serve" | undefined,
): string {
	if (adapterName === "@astrojs/cloudflare" && command !== "serve") {
		return `// Serverless build: an external Cron Trigger drives scheduled work.
export const createScheduler = null;
`;
	}
	return `// Long-lived runtime (or local dev): drive scheduled work from an in-process timer.
import { NodeCronScheduler } from "emdash";

export function createScheduler(executor) {
	return new NodeCronScheduler(executor);
}
`;
}

export function generateSeedModule(projectRoot: string, warnOnFallback = false): string {
	let userSeedJson: string | null = null;

	try {
		const seedPath = resolve(projectRoot, ".emdash", "seed.json");
		const content = readFileSync(seedPath, "utf-8");
		JSON.parse(content);
		userSeedJson = content;
	} catch {}

	if (!userSeedJson) {
		try {
			const pkgPath = resolve(projectRoot, "package.json");
			const pkgContent = readFileSync(pkgPath, "utf-8");
			const pkg: { emdash?: { seed?: string } } = JSON.parse(pkgContent);

			if (pkg.emdash?.seed) {
				const seedPath = resolve(projectRoot, pkg.emdash.seed);
				const content = readFileSync(seedPath, "utf-8");
				JSON.parse(content);
				userSeedJson = content;
			}
		} catch {}
	}

	if (!userSeedJson) {
		try {
			const seedPath = resolve(projectRoot, "seed", "seed.json");
			const content = readFileSync(seedPath, "utf-8");
			JSON.parse(content);
			userSeedJson = content;
		} catch {}
	}

	if (userSeedJson) {
		return [`export const userSeed = ${userSeedJson};`, `export const seed = userSeed;`].join("\n");
	}

	if (warnOnFallback) {
		console.warn(
			"[emdash] No user seed found at .emdash/seed.json, package.json#emdash.seed, or seed/seed.json. Falling back to the built-in default seed; the setup wizard will not offer demo content for this site.",
		);
	}
	return [
		`export const userSeed = null;`,
		`export const seed = ${JSON.stringify(defaultSeed)};`,
	].join("\n");
}

function resolveModulePathFromProject(specifier: string, projectRoot: string): string {
	const projectPackageJson = resolve(projectRoot, "package.json");
	const require = createRequire(projectPackageJson);
	return require.resolve(specifier);
}

export function generateSandboxedPluginsModule(
	sandboxed: PluginDescriptor[],
	projectRoot: string,
	onEntryResolved?: (filePath: string) => void,
): string {
	if (sandboxed.length === 0) {
		return `
// No sandboxed plugins configured
export const sandboxedPlugins = [];
`;
	}

	const pluginEntries: string[] = [];

	for (const descriptor of sandboxed) {
		const bundleSpecifier = descriptor.entrypoint;

		const filePath = resolveModulePathFromProject(bundleSpecifier, projectRoot);

		const ext = filePath.slice(filePath.lastIndexOf("."));
		if (TS_SOURCE_EXT_RE.test(ext)) {
			throw new Error(
				`Sandboxed plugin "${descriptor.id}" entrypoint "${bundleSpecifier}" resolves to ` +
					`unbuilt source (${filePath}). Sandbox entries must be pre-built JavaScript. ` +
					`Ensure the plugin's package.json exports point to built files (e.g. dist/*.mjs) ` +
					`and run the plugin's build step before building the site.`,
			);
		}

		onEntryResolved?.(filePath);

		const code = readFileSync(filePath, "utf-8");

		pluginEntries.push(`{
    id: ${JSON.stringify(descriptor.id)},
    version: ${JSON.stringify(descriptor.version)},
    defaultEnabled: ${JSON.stringify(descriptor.defaultEnabled ?? true)},
    lifecycleManaged: ${JSON.stringify(descriptor.lifecycleManaged ?? false)},
    lifecycleEnablePath: ${JSON.stringify(descriptor.lifecycleEnablePath)},
    lifecycleDisablePath: ${JSON.stringify(descriptor.lifecycleDisablePath)},
    options: ${JSON.stringify(descriptor.options ?? {})},
    capabilities: ${JSON.stringify(descriptor.capabilities ?? [])},
    allowedHosts: ${JSON.stringify(descriptor.allowedHosts ?? [])},
    storage: ${JSON.stringify(descriptor.storage ?? {})},
    mcp: ${JSON.stringify(descriptor.mcp)},
    routes: ${JSON.stringify(descriptor.routes ?? [])},
    hooks: ${JSON.stringify(descriptor.hooks ?? [])},
    adminPages: ${JSON.stringify(descriptor.adminPages ?? [])},
    adminWidgets: ${JSON.stringify(descriptor.adminWidgets ?? [])},
    settingsSchema: ${JSON.stringify(descriptor.settingsSchema)},
    portableTextBlocks: ${JSON.stringify(descriptor.portableTextBlocks ?? [])},
    fieldWidgets: ${JSON.stringify(descriptor.fieldWidgets ?? [])},
    adminEntry: ${JSON.stringify(descriptor.adminEntry)},
    // Code read from: ${filePath}
    code: ${JSON.stringify(code)},
  }`);
	}

	return `
// Auto-generated sandboxed plugins module
// Plugin code is embedded at build time

/**
 * Sandboxed plugin entries with embedded code.
 * Loaded at runtime via SandboxRunner.
 */
export const sandboxedPlugins = [
  ${pluginEntries.join(",\n  ")}
];
`;
}
