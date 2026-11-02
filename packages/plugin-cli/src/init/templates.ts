import type { ManifestAuthor, ManifestSecurityContact } from "../manifest/schema.js";

export interface ScaffoldInputs {
	slug: string;
	publisher: string | undefined;
	publisherHandle: string | undefined;
	license: string | undefined;
	author: ManifestAuthor | undefined;
	security: ManifestSecurityContact | undefined;
	description: string | undefined;
	repo: string | undefined;
}

export function renderManifest(input: ScaffoldInputs): string {
	const lines: string[] = [];
	lines.push("{");
	lines.push(
		'\t"$schema": "./node_modules/@emdash-cms/plugin-cli/schemas/emdash-plugin.schema.json",',
	);
	lines.push("");
	lines.push(`\t"slug": ${jsonString(input.slug)},`);

	if (!input.publisher) {
		lines.push(
			'\t// TODO: set your atproto handle (e.g. "example.com") or DID before running `emdash-plugin bundle` or any local-dev integration. The plugin cannot load without it.',
		);
		lines.push('\t"publisher": "",');
	} else {
		const trailer = input.publisherHandle ? ` // ${input.publisherHandle}` : "";
		lines.push(`\t"publisher": ${jsonString(input.publisher)},${trailer}`);
	}

	lines.push("");
	lines.push(`\t"license": ${jsonString(input.license ?? "MIT")},`);

	if (input.author) {
		lines.push(`\t"author": ${renderAuthor(input.author)},`);
	} else {
		lines.push(
			"\t// TODO: replace the placeholder with your real name and (optionally) url/email before publishing.",
		);
		lines.push(
			`\t"author": { "name": ${jsonString(`TODO: replace with your name (${input.slug} author)`)} },`,
		);
	}

	if (input.security) {
		lines.push(`\t"security": ${renderSecurityContact(input.security)},`);
	} else {
		lines.push(
			"\t// TODO: replace the placeholder with a real security contact email or url before publishing. The lexicon mandates at least one.",
		);
		lines.push('\t"security": { "email": "TODO@example.com" },');
	}

	if (input.description) {
		lines.push(`\t"description": ${jsonString(input.description)},`);
	}
	if (input.repo) {
		lines.push(`\t"repo": ${jsonString(input.repo)},`);
	}

	lines.push("");
	lines.push("\t// Trust contract — what runtime APIs the plugin asks for.");
	lines.push("\t// Empty arrays mean no extra privileges beyond logging,");
	lines.push("\t// KV, and route/hook registration. Changing these between");
	lines.push("\t// releases requires a version bump because installed");
	lines.push("\t// users have consented to the old contract.");
	lines.push('\t"capabilities": [],');
	lines.push('\t"allowedHosts": [],');
	lines.push('\t"storage": {}');
	lines.push("}");
	lines.push("");
	return lines.join("\n");
}

function renderAuthor(author: ManifestAuthor): string {
	const parts: string[] = [`"name": ${jsonString(author.name)}`];
	if (author.url) parts.push(`"url": ${jsonString(author.url)}`);
	if (author.email) parts.push(`"email": ${jsonString(author.email)}`);
	return `{ ${parts.join(", ")} }`;
}

function renderSecurityContact(contact: ManifestSecurityContact): string {
	const parts: string[] = [];
	if (contact.email) parts.push(`"email": ${jsonString(contact.email)}`);
	if (contact.url) parts.push(`"url": ${jsonString(contact.url)}`);
	return `{ ${parts.join(", ")} }`;
}

export function renderPluginEntry(): string {
	return `import type { SandboxedPlugin } from "emdash/plugin";

/**
 * Sandboxed plugin entry. The default export is a bare object; the
 * \`satisfies SandboxedPlugin\` annotation gives TypeScript per-hook /
 * per-route inference (\`ctx\` is \`PluginContext\` automatically; hook
 * \`event\` parameters are typed by hook name).
 */
export default {
\troutes: {
\t\thello: {
\t\t\thandler: async (_routeCtx, ctx) => {
\t\t\t\tctx.log.info("hello route called", { pluginId: ctx.plugin.id });
\t\t\t\treturn { greeting: "hello", pluginId: ctx.plugin.id };
\t\t\t},
\t\t},
\t},
} satisfies SandboxedPlugin;
`;
}

export function renderPackageJson(input: ScaffoldInputs): string {
	const pkg = {
		name: input.slug,
		version: "0.1.0",
		private: true,
		type: "module",
		main: "dist/index.mjs",
		exports: {
			".": {
				import: "./dist/index.mjs",
				types: "./dist/index.d.mts",
			},
			"./sandbox": "./dist/plugin.mjs",
		},
		files: ["dist", "emdash-plugin.jsonc"],
		scripts: {
			build: "emdash-plugin build",
			dev: "emdash-plugin dev",
			typecheck: "tsc --noEmit",
			test: "vitest run",
		},
		peerDependencies: {
			emdash: ">=0.12.0",
		},
		devDependencies: {
			"@emdash-cms/plugin-cli": ">=0.1.0",
			emdash: ">=0.12.0",
			typescript: "^5.9.0",
			vitest: "^4.1.0",
		},
	};
	return `${JSON.stringify(pkg, null, "\t")}\n`;
}

export function renderTsconfig(): string {
	const config = {
		compilerOptions: {
			target: "ES2022",
			module: "preserve",
			moduleResolution: "bundler",
			strict: true,
			esModuleInterop: true,
			verbatimModuleSyntax: true,
			skipLibCheck: true,
			types: [],
		},
		include: ["src/**/*", "tests/**/*"],
		exclude: ["node_modules"],
	};
	return `${JSON.stringify(config, null, "\t")}\n`;
}

export function renderGitignore(): string {
	return "node_modules/\ndist/\n";
}

export function renderReadme(input: ScaffoldInputs): string {
	const title = input.slug;
	const importBinding = toCamelCase(input.slug);
	return `# ${title}

A sandboxed plugin for [EmDash CMS](https://emdashcms.com).

## Develop

\`\`\`sh
pnpm install
pnpm typecheck
pnpm test
\`\`\`

To test against a running EmDash site, run \`pnpm dev\` in this
directory (rebuilds on save) and \`pnpm add file:../path/to/this\`
in the site. Then \`import ${importBinding} from "${input.slug}"\` and pass
it into \`emdash({ sandboxed: [${importBinding}] })\`.

## Publish

\`\`\`sh
emdash-plugin login        # if you're not already logged in
emdash-plugin bundle       # produces dist/${title}-<version>.tar.gz
# upload that tarball to a public URL, then:
emdash-plugin publish --url https://your-host/...
\`\`\`

## Version bumps

Bump \`version\` in \`package.json\` when you ship a release. The
scaffold's \`emdash-plugin.jsonc\` deliberately omits \`version\` —
the build pipeline reads it from \`package.json\` so there's a single
source of truth. **Bump major** for breaking changes, **bump minor**
for new routes or hooks, **bump patch** for fixes.

You MUST bump version whenever you change \`capabilities\`, \`allowedHosts\`,
or \`storage\` in the manifest. Installed users have consented to the
old trust contract; a change without a version bump would let new
behaviour slip past consent.
`;
}

export function renderTest(): string {
	return `import { describe, expect, it } from "vitest";

import plugin from "../src/plugin.js";

describe("hello route", () => {
\tit("returns a greeting", async () => {
\t\tconst handler = plugin.routes?.hello;
\t\tif (!handler || typeof handler !== "object" || !("handler" in handler)) {
\t\t\tthrow new Error("hello route handler not found");
\t\t}
\t\tconst result = await handler.handler({} as never, makeTestContext());
\t\texpect(result).toEqual({ greeting: "hello", pluginId: "test-plugin" });
\t});
});

function makeTestContext() {
\t// Minimal stub PluginContext: the hello route only reads
\t// \`ctx.log.info\` and \`ctx.plugin.id\`. Real PluginContext has many
\t// more methods; add them as your plugin grows.
\treturn {
\t\tplugin: { id: "test-plugin", version: "0.1.0" },
\t\tlog: {
\t\t\tinfo: () => {},
\t\t\twarn: () => {},
\t\t\terror: () => {},
\t\t\tdebug: () => {},
\t\t},
\t} as unknown as import("emdash").PluginContext;
}
`;
}

function jsonString(value: string): string {
	return JSON.stringify(value);
}

const SLUG_SEPARATOR_RE = /[-_]([a-z0-9])/g;

function toCamelCase(slug: string): string {
	return slug.replace(SLUG_SEPARATOR_RE, (_, ch: string) => ch.toUpperCase());
}
