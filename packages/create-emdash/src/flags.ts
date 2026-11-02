import { parseArgs } from "node:util";

import { PROJECT_NAME_PATTERN } from "./utils.js";

export interface ParsedFlags {
	name?: string;
	platform?: Platform;
	template?: TemplateKey;
	packageManager?: PackageManager;
	install?: boolean;
	yes: boolean;
	force: boolean;
	help: boolean;
}

export type Platform = "node" | "cloudflare";
export type TemplateKey = "blog" | "starter" | "marketing" | "portfolio";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const PLATFORMS: readonly Platform[] = ["node", "cloudflare"] as const;
const TEMPLATES: readonly TemplateKey[] = ["blog", "starter", "marketing", "portfolio"] as const;
const PACKAGE_MANAGERS: readonly PackageManager[] = ["pnpm", "npm", "yarn", "bun"] as const;

export class FlagError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FlagError";
	}
}

function isPlatform(value: string): value is Platform {
	return (PLATFORMS as readonly string[]).includes(value);
}

function isTemplate(value: string): value is TemplateKey {
	return (TEMPLATES as readonly string[]).includes(value);
}

function isPackageManager(value: string): value is PackageManager {
	return (PACKAGE_MANAGERS as readonly string[]).includes(value);
}

export function wantsHelp(argv: string[]): boolean {
	return argv.slice(2).some((arg) => arg === "--help" || arg === "-h");
}

export function parseFlags(argv: string[]): ParsedFlags {
	const { values, positionals } = parseArgs({
		args: argv.slice(2),
		options: {
			template: { type: "string" },
			platform: { type: "string" },
			pm: { type: "string" },
			"package-manager": { type: "string" },
			install: { type: "boolean" },
			"no-install": { type: "boolean" },
			yes: { type: "boolean", short: "y" },
			force: { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	const flags: ParsedFlags = {
		yes: values.yes === true,
		force: values.force === true,
		help: values.help === true,
	};

	if (positionals.length > 1) {
		throw new FlagError(
			`Unexpected extra argument "${positionals[1]}". Did you mean a hyphen instead of a space in the project name?`,
		);
	}
	const positional = positionals[0];
	if (positional !== undefined) {
		flags.name = positional;
	}

	let platformFromFlag: Platform | undefined;
	let platformFromTemplate: Platform | undefined;

	if (values.platform !== undefined) {
		if (!isPlatform(values.platform)) {
			throw new FlagError(
				`--platform must be one of ${PLATFORMS.join(", ")} (got "${values.platform}").`,
			);
		}
		platformFromFlag = values.platform;
	}

	if (values.template !== undefined) {
		const raw = values.template;
		const colon = raw.indexOf(":");
		if (colon !== -1) {
			const platformPart = raw.slice(0, colon);
			const templatePart = raw.slice(colon + 1);
			if (platformPart === "" || templatePart === "") {
				throw new FlagError(`--template must be "<key>" or "<platform>:<key>" (got "${raw}").`);
			}
			if (!isPlatform(platformPart)) {
				throw new FlagError(
					`--template platform prefix must be one of ${PLATFORMS.join(", ")} (got "${platformPart}").`,
				);
			}
			if (!isTemplate(templatePart)) {
				throw new FlagError(
					`--template name must be one of ${TEMPLATES.join(", ")} (got "${templatePart}").`,
				);
			}
			platformFromTemplate = platformPart;
			flags.template = templatePart;
		} else {
			if (!isTemplate(raw)) {
				throw new FlagError(`--template must be one of ${TEMPLATES.join(", ")} (got "${raw}").`);
			}
			flags.template = raw;
		}
	}

	if (platformFromFlag !== undefined && platformFromTemplate !== undefined) {
		if (platformFromFlag !== platformFromTemplate) {
			throw new FlagError(
				`--platform "${platformFromFlag}" conflicts with --template "${values.template}". Pass one or the other.`,
			);
		}
	}
	flags.platform = platformFromFlag ?? platformFromTemplate;

	const pmRaw = values.pm ?? values["package-manager"];
	if (values.pm !== undefined && values["package-manager"] !== undefined) {
		if (values.pm !== values["package-manager"]) {
			throw new FlagError(
				`--pm "${values.pm}" conflicts with --package-manager "${values["package-manager"]}". Pass one or the other.`,
			);
		}
	}
	if (pmRaw !== undefined) {
		if (!isPackageManager(pmRaw)) {
			throw new FlagError(`--pm must be one of ${PACKAGE_MANAGERS.join(", ")} (got "${pmRaw}").`);
		}
		flags.packageManager = pmRaw;
	}

	if (values.install === true && values["no-install"] === true) {
		throw new FlagError(`--install and --no-install cannot both be set.`);
	}
	if (values.install === true) flags.install = true;
	if (values["no-install"] === true) flags.install = false;

	return flags;
}

export function validateProjectName(name: string): string | undefined {
	if (name === ".") return undefined;
	if (!PROJECT_NAME_PATTERN.test(name)) {
		return "Project name can only contain lowercase letters, numbers, and hyphens";
	}
	return undefined;
}

export const HELP_TEXT = `Usage: npm create emdash@latest [name] [options]

Scaffold a new EmDash project.

When a flag is omitted, an interactive prompt is shown for that field.
With --yes, omitted fields fall back to defaults (cloudflare, blog, the
detected package manager, my-site for an unset name).

Arguments:
  [name]                       Project directory name, or "." for cwd

Options:
  --template <key>             blog | starter | marketing | portfolio
                               or "<platform>:<key>" (e.g. cloudflare:blog)
  --platform <key>             node | cloudflare
  --pm <key>                   pnpm | npm | yarn | bun
  --package-manager <key>      Alias of --pm
  --install                    Install dependencies after scaffolding
  --no-install                 Skip dependency install
  -y, --yes                    Accept defaults; skip confirmation prompts
  --force                      Allow overwriting a non-empty target dir
                               (required with --yes when the target is non-empty)
  -h, --help                   Show this help text

Examples:
  npm create emdash@latest
  npm create emdash@latest my-blog
  npm create emdash@latest my-blog -- --template cloudflare:blog --pm pnpm --yes
  npm create emdash@latest . -- --template starter --platform node --yes --force
`;
