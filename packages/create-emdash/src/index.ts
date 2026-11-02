import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

import * as p from "@clack/prompts";
import { downloadTemplate } from "giget";
import pc from "picocolors";

import {
	FlagError,
	HELP_TEXT,
	type PackageManager,
	type ParsedFlags,
	type Platform,
	type TemplateKey,
	parseFlags,
	validateProjectName,
	wantsHelp,
} from "./flags.js";
import { isDirNonEmpty, sanitizePackageName, writeEncryptionKey } from "./utils.js";

const GITHUB_REPO = "emdash-cms/templates";

interface TemplateConfig {
	name: string;
	description: string;
	dir: string;
}

const NODE_TEMPLATES = {
	blog: {
		name: "Blog",
		description: "A blog with posts, pages, and authors",
		dir: "blog",
	},
	starter: {
		name: "Starter",
		description: "A general-purpose starter with posts and pages",
		dir: "starter",
	},
	marketing: {
		name: "Marketing",
		description: "A marketing site with landing pages and CTAs",
		dir: "marketing",
	},
	portfolio: {
		name: "Portfolio",
		description: "A portfolio site with projects and case studies",
		dir: "portfolio",
	},
} as const satisfies Record<TemplateKey, TemplateConfig>;

const CLOUDFLARE_TEMPLATES = {
	blog: {
		name: "Blog",
		description: "A blog with posts, pages, and authors",
		dir: "blog-cloudflare",
	},
	starter: {
		name: "Starter",
		description: "A general-purpose starter with posts and pages",
		dir: "starter-cloudflare",
	},
	marketing: {
		name: "Marketing",
		description: "A marketing site with landing pages and CTAs",
		dir: "marketing-cloudflare",
	},
	portfolio: {
		name: "Portfolio",
		description: "A portfolio site with projects and case studies",
		dir: "portfolio-cloudflare",
	},
} as const satisfies Record<TemplateKey, TemplateConfig>;

const DEFAULT_PLATFORM: Platform = "cloudflare";
const DEFAULT_TEMPLATE: TemplateKey = "blog";
const DEFAULT_PROJECT_NAME = "my-site";

function detectPackageManager(): PackageManager {
	const agent = process.env.npm_config_user_agent ?? "";
	if (agent.startsWith("pnpm")) return "pnpm";
	if (agent.startsWith("yarn")) return "yarn";
	if (agent.startsWith("bun")) return "bun";
	return "npm";
}

function selectOptions<K extends string>(
	obj: Readonly<Record<K, Readonly<{ name: string; description: string }>>>,
): { value: K; label: string; hint: string }[] {
	const keys: K[] = Object.keys(obj).filter((k): k is K => k in obj);
	return keys.map((key) => ({
		value: key,
		label: obj[key].name,
		hint: obj[key].description,
	}));
}

const NEWLINE_PATTERN = /\r?\n/;

function ensureGitignored(projectDir: string, fileName: string): void {
	const target = resolve(projectDir, ".gitignore");
	const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
	const lines = existing.split(NEWLINE_PATTERN);
	if (lines.some((line) => line.trim() === fileName)) {
		return;
	}
	const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n";
	const next = `${existing}${sep}${fileName}\n`;
	writeFileSync(target, next);
}

function getTemplateConfig(platform: Platform, key: TemplateKey): TemplateConfig {
	return platform === "node" ? NODE_TEMPLATES[key] : CLOUDFLARE_TEMPLATES[key];
}

async function selectTemplate(platform: Platform): Promise<TemplateKey> {
	const map = platform === "node" ? NODE_TEMPLATES : CLOUDFLARE_TEMPLATES;
	const key = await p.select<TemplateKey>({
		message: "Which template?",
		options: selectOptions(map),
		initialValue: "blog",
	});
	if (p.isCancel(key)) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	return key;
}

async function resolveProjectLocation(
	flags: ParsedFlags,
): Promise<{ projectName: string; projectDir: string; isCurrentDir: boolean } | null> {
	if (flags.name !== undefined) {
		const error = validateProjectName(flags.name);
		if (error) {
			p.cancel(`${error}.`);
			process.exit(1);
		}
	}

	let target = flags.name;

	if (target === undefined) {
		if (flags.yes) {
			target = DEFAULT_PROJECT_NAME;
		} else {
			const name = await p.text({
				message: 'Project name? (use "." for current directory)',
				placeholder: DEFAULT_PROJECT_NAME,
				defaultValue: DEFAULT_PROJECT_NAME,
				validate: (value) => {
					if (!value) return "Project name is required";
					return validateProjectName(value);
				},
			});
			if (p.isCancel(name)) return null;
			target = name;
		}
	}

	if (target === ".") {
		const projectDir = process.cwd();
		const projectName = sanitizePackageName(basename(projectDir));
		if (isDirNonEmpty(projectDir)) {
			if (flags.yes && !flags.force) {
				p.cancel("Current directory is not empty. Re-run with --force to allow overwriting.");
				process.exit(1);
			}
			if (!flags.yes) {
				const proceed = await p.confirm({
					message: "Current directory is not empty. Files may be overwritten. Continue?",
					initialValue: false,
				});
				if (p.isCancel(proceed) || !proceed) return null;
			}
		}
		return { projectName, projectDir, isCurrentDir: true };
	}

	const projectName = target;
	const projectDir = resolve(process.cwd(), projectName);
	if (isDirNonEmpty(projectDir)) {
		if (flags.yes && !flags.force) {
			p.cancel(
				`Directory ${projectName} already exists and is not empty. Re-run with --force to allow overwriting.`,
			);
			process.exit(1);
		}
		if (!flags.yes) {
			const overwrite = await p.confirm({
				message: `Directory ${projectName} already exists and is not empty. Files may be overwritten. Continue?`,
				initialValue: false,
			});
			if (p.isCancel(overwrite) || !overwrite) return null;
		}
	}
	return { projectName, projectDir, isCurrentDir: false };
}

async function resolvePlatform(flags: ParsedFlags): Promise<Platform> {
	if (flags.platform !== undefined) return flags.platform;
	if (flags.yes) return DEFAULT_PLATFORM;
	const platform = await p.select<Platform>({
		message: "Where will you deploy?",
		options: [
			{ value: "cloudflare", label: "Cloudflare Workers", hint: "D1 + R2" },
			{ value: "node", label: "Node.js", hint: "SQLite + local file storage" },
		],
		initialValue: "cloudflare",
	});
	if (p.isCancel(platform)) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	return platform;
}

async function resolveTemplate(flags: ParsedFlags, platform: Platform): Promise<TemplateKey> {
	if (flags.template !== undefined) return flags.template;
	if (flags.yes) return DEFAULT_TEMPLATE;
	return selectTemplate(platform);
}

async function resolvePackageManager(flags: ParsedFlags): Promise<PackageManager> {
	if (flags.packageManager !== undefined) return flags.packageManager;
	const detected = detectPackageManager();
	if (flags.yes) return detected;
	const pm = await p.select<PackageManager>({
		message: "Which package manager?",
		options: [
			{ value: "pnpm", label: "pnpm" },
			{ value: "npm", label: "npm" },
			{ value: "yarn", label: "yarn" },
			{ value: "bun", label: "bun" },
		],
		initialValue: detected,
	});
	if (p.isCancel(pm)) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	return pm;
}

async function resolveShouldInstall(flags: ParsedFlags): Promise<boolean> {
	if (flags.install !== undefined) return flags.install;
	if (flags.yes) return true;
	const shouldInstall = await p.confirm({
		message: "Install dependencies?",
		initialValue: true,
	});
	if (p.isCancel(shouldInstall)) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	return shouldInstall;
}

async function main() {
	if (wantsHelp(process.argv)) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	let flags: ParsedFlags;
	try {
		flags = parseFlags(process.argv);
	} catch (error) {
		const message =
			error instanceof FlagError || error instanceof Error ? error.message : String(error);
		console.error(`\n${pc.red("Error:")} ${message}\n`);
		console.error(HELP_TEXT);
		process.exit(1);
	}

	console.clear();
	console.log(`\n  ${pc.bold(pc.cyan("— E M D A S H —"))}\n`);
	p.intro("Create a new EmDash project");

	const location = await resolveProjectLocation(flags);
	if (location === null) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	const { projectName, projectDir, isCurrentDir } = location;

	const platform = await resolvePlatform(flags);
	const templateKey = await resolveTemplate(flags, platform);
	const templateConfig = getTemplateConfig(platform, templateKey);
	const pm = await resolvePackageManager(flags);
	const shouldInstall = await resolveShouldInstall(flags);

	const installCmd = `${pm} install`;
	const runCmd = (script: string) => (pm === "npm" ? `npm run ${script}` : `${pm} ${script}`);

	const s = p.spinner();
	s.start("Creating project...");

	try {
		await downloadTemplate(`github:${GITHUB_REPO}/${templateConfig.dir}`, {
			dir: projectDir,
			force: true,
		});

		const pkgPath = resolve(projectDir, "package.json");
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
			pkg.name = projectName;

			if (pm !== "pnpm") {
				delete pkg.packageManager;
			}

			const seedPath = resolve(projectDir, "seed", "seed.json");
			if (existsSync(seedPath)) {
				pkg.emdash = {
					label: templateConfig.name,
					seed: "seed/seed.json",
				};
			}

			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
		}

		const secretsFile = ".env";
		const keyResult = writeEncryptionKey(projectDir, secretsFile);
		ensureGitignored(projectDir, secretsFile);

		s.stop("Project created!");

		if (platform === "cloudflare" && existsSync(resolve(projectDir, ".dev.vars"))) {
			p.log.warn(
				`Found an existing ${pc.cyan(".dev.vars")}. Wrangler ignores ${pc.cyan(".env")} while ` +
					`${pc.cyan(".dev.vars")} is present — move your secrets into ${pc.cyan(".env")} and delete ` +
					`${pc.cyan(".dev.vars")} so the encryption key loads.`,
			);
		}

		if (keyResult === "skipped") {
			p.log.info(
				`Existing ${pc.cyan("EMDASH_ENCRYPTION_KEY")} found in ${pc.cyan(secretsFile)}; leaving it alone.`,
			);
		} else {
			p.log.info(`Wrote ${pc.cyan("EMDASH_ENCRYPTION_KEY")} to ${pc.cyan(secretsFile)}.`);
		}

		if (shouldInstall) {
			s.start(`Installing dependencies with ${pc.cyan(pm)}...`);
			try {
				await execAsync(installCmd, { cwd: projectDir });
				s.stop("Dependencies installed!");
			} catch {
				s.stop("Failed to install dependencies");
				p.log.warn(
					isCurrentDir
						? `Run ${pc.cyan(installCmd)} manually`
						: `Run ${pc.cyan(`cd ${projectName} && ${installCmd}`)} manually`,
				);
			}
		}

		const steps: string[] = [];
		if (!isCurrentDir) steps.push(`cd ${projectName}`);
		if (!shouldInstall) steps.push(installCmd);
		steps.push(runCmd("dev"));

		p.note(steps.join("\n"), "Next steps");

		p.outro(
			isCurrentDir
				? `${pc.green("Done!")} Your EmDash project is ready in the current directory`
				: `${pc.green("Done!")} Your EmDash project is ready at ${pc.cyan(projectName)}`,
		);
	} catch (error) {
		s.stop("Failed to create project");
		p.log.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
