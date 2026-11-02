import { basename, resolve } from "node:path";

import { isDid, isHandle } from "@atcute/lexicons/syntax";
import * as clack from "@clack/prompts";
import { isPluginSlug } from "@emdash-cms/plugin-types";
import { FileCredentialStore } from "@emdash-cms/registry-client";
import { defineCommand } from "citty";
import consola from "consola";
import pc from "picocolors";

import { probeEnvironment, type EnvironmentDefaults } from "../init/environment.js";
import { InitError, scaffold } from "../init/scaffold.js";
import type { ScaffoldInputs } from "../init/templates.js";
import { PublisherCheckError, resolveHandleToDid } from "../manifest/publisher.js";

export const initCommand = defineCommand({
	meta: {
		name: "init",
		description:
			"Scaffold a new sandboxed plugin: emdash-plugin.jsonc, src/plugin.ts, package.json, tests, and a README.",
	},
	args: {
		name: {
			type: "positional",
			required: false,
			description:
				"Plugin slug. Used as the directory name and the manifest's `slug` field. If omitted, the slug is derived from the current directory name (or prompted in interactive mode).",
		},
		dir: {
			type: "string",
			description:
				"Target directory. Defaults to ./<name> when `name` is given, or the current directory when it isn't.",
		},
		publisher: {
			type: "string",
			description:
				"Atproto handle or DID. In interactive mode this is prompted; in --yes mode an unset value becomes a TODO placeholder.",
		},
		license: {
			type: "string",
			description: 'SPDX license expression. Defaults to "MIT".',
		},
		"author-name": {
			type: "string",
			description: "Author name.",
		},
		"author-url": {
			type: "string",
			description: "Author URL.",
		},
		"author-email": {
			type: "string",
			description: "Author email.",
		},
		"security-email": {
			type: "string",
			description:
				"Security contact email. Either --security-email or --security-url should be set; in --yes mode an unset value becomes a TODO placeholder.",
		},
		"security-url": {
			type: "string",
			description: "Security contact URL.",
		},
		description: {
			type: "string",
			description: "Short plugin description (omitted from the manifest if not provided).",
		},
		repo: {
			type: "string",
			description: "Source repository URL (omitted from the manifest if not provided).",
		},
		yes: {
			type: "boolean",
			alias: "y",
			description:
				"Skip interactive prompts. Unset fields become TODO placeholders in the manifest. Automatically enabled when stdin is not a TTY.",
			default: false,
		},
		force: {
			type: "boolean",
			description:
				"Overwrite existing files in the target directory. Without this flag, init refuses if any target file already exists.",
			default: false,
		},
	},
	async run({ args }) {
		try {
			await runInit(args);
		} catch (error) {
			if (error instanceof InitError || error instanceof InputError) {
				consola.error(error.message);
				process.exit(1);
			}
			throw error;
		}
	},
});

interface InitArgs {
	name?: string;
	dir?: string;
	publisher?: string;
	license?: string;
	"author-name"?: string;
	"author-url"?: string;
	"author-email"?: string;
	"security-email"?: string;
	"security-url"?: string;
	description?: string;
	repo?: string;
	yes?: boolean;
	force?: boolean;
}

async function runInit(args: InitArgs): Promise<void> {
	const interactive = !(args.yes ?? false) && process.stdin.isTTY === true;

	if (interactive) clack.intro(pc.bold("emdash-plugin init"));

	const session = await loadCurrentSessionSilently();

	let { slug, targetDir } = resolveSlugAndDir(args);
	if (nonEmpty(args.name) === undefined && nonEmpty(args.dir) === undefined && interactive) {
		const answer = await clack.text({
			message: "Plugin slug",
			placeholder: "my-plugin",
			defaultValue: slug,
		});
		assertNotCancelled(answer);
		if (typeof answer === "string" && answer.trim().length > 0) {
			slug = answer.trim();
			targetDir = resolve(`./${slug}`);
		}
	}

	if (!isPluginSlug(slug)) {
		throw new InputError(
			`Slug "${slug}" is not a valid plugin slug. Expected: lowercase letter, then lowercase letters / digits / "-" / "_" (max 64 chars).`,
		);
	}

	const env = await probeEnvironment(await pickProbeDir(targetDir));

	const publisherResult = await resolvePublisher(args, interactive, session);
	const license = await resolveLicense(args, interactive, env);
	const author = await resolveAuthor(args, interactive, env);
	const security = await resolveSecurity(args, interactive);
	const description = await resolveDescription(args, interactive, env);
	const repo = await resolveRepo(args, interactive, env);

	const inputs: ScaffoldInputs = {
		slug,
		publisher: publisherResult?.did,
		publisherHandle: publisherResult?.handle,
		license,
		author,
		security,
		description,
		repo,
	};

	const spin = interactive ? clack.spinner() : null;
	spin?.start(`Scaffolding ${slug} in ${targetDir}`);

	let result;
	try {
		result = await scaffold({
			targetDir,
			inputs,
			force: args.force ?? false,
			onFileWritten: interactive
				? undefined
				: (relPath) => consola.info(`  ${pc.green("+")} ${relPath}`),
		});
	} catch (error) {
		spin?.error("Scaffold failed");
		throw error;
	}

	spin?.stop(`Scaffolded ${result.written.length} files`);
	if (!interactive) {
		consola.success(`Scaffolded ${result.written.length} files in ${targetDir}`);
	}

	printNextSteps(targetDir, inputs, interactive);
}

interface PublisherResult {
	did: string;
	handle: string | undefined;
}

async function resolvePublisher(
	args: InitArgs,
	interactive: boolean,
	session: SessionInfo | undefined,
): Promise<PublisherResult | undefined> {
	const flag = nonEmpty(args.publisher);
	if (flag !== undefined) {
		return await resolvePublisherInput(flag, "--publisher");
	}

	if (!interactive) {
		if (session) return { did: session.did, handle: session.handle ?? undefined };
		return undefined;
	}

	const placeholder = session?.handle ?? "example.com";
	const defaultValue = session?.handle ?? undefined;

	const answer = await clack.text({
		message: session
			? "Atproto publisher (press enter to use your logged-in handle, or type a handle / DID)"
			: "Atproto publisher (handle or DID, leave blank to fill in later)",
		placeholder,
		...(defaultValue !== undefined && { defaultValue }),
		validate: (raw) => {
			const v = (raw ?? "").trim();
			if (v.length === 0) return undefined;
			if (isDid(v) || isHandle(v)) return undefined;
			return 'Must be a handle (e.g. "example.com") or DID (e.g. "did:plc:...").';
		},
	});
	assertNotCancelled(answer);
	const value = typeof answer === "string" ? answer.trim() : "";
	if (value.length === 0) return undefined;
	return await resolvePublisherInput(value, "publisher");
}

async function resolvePublisherInput(input: string, sourceLabel: string): Promise<PublisherResult> {
	if (isDid(input)) {
		return { did: input, handle: undefined };
	}
	if (!isHandle(input)) {
		throw new InputError(
			`${sourceLabel} "${input}" is not a valid atproto handle or DID. Expected a handle (e.g. "example.com") or DID (e.g. "did:plc:abc...").`,
		);
	}
	try {
		const did = await resolveHandleToDid(input);
		return { did, handle: input };
	} catch (error) {
		if (error instanceof PublisherCheckError) {
			throw new InputError(error.message);
		}
		throw error;
	}
}

async function resolveLicense(
	args: InitArgs,
	interactive: boolean,
	env: EnvironmentDefaults,
): Promise<string | undefined> {
	const flag = nonEmpty(args.license);
	if (flag !== undefined) return flag;
	if (!interactive) return env.license;
	const defaultValue = env.license ?? "MIT";
	const answer = await clack.text({
		message: "License (SPDX expression)",
		defaultValue,
		placeholder: defaultValue,
	});
	assertNotCancelled(answer);
	const value = typeof answer === "string" ? answer.trim() : "";
	return value.length === 0 ? undefined : value;
}

async function resolveAuthor(args: InitArgs, interactive: boolean, env: EnvironmentDefaults) {
	const flagName = nonEmpty(args["author-name"]);
	const flagUrl = nonEmpty(args["author-url"]);
	const flagEmail = nonEmpty(args["author-email"]);

	if (flagName !== undefined || flagUrl !== undefined || flagEmail !== undefined) {
		return {
			name: flagName ?? env.authorName ?? "TODO: replace with your name",
			...((flagUrl ?? undefined) !== undefined && { url: flagUrl! }),
			...((flagEmail ?? env.authorEmail) !== undefined && {
				email: flagEmail ?? env.authorEmail!,
			}),
		};
	}

	if (!interactive) {
		if (env.authorName === undefined && env.authorEmail === undefined) {
			return undefined;
		}
		return {
			name: env.authorName ?? "TODO: replace with your name",
			...(env.authorEmail !== undefined && { email: env.authorEmail }),
		};
	}

	const nameAns = await clack.text({
		message: env.authorName
			? "Author name (press enter to use your git config)"
			: "Author name (leave blank to fill in later)",
		...(env.authorName !== undefined && { defaultValue: env.authorName }),
		placeholder: env.authorName ?? "Jane Doe",
	});
	assertNotCancelled(nameAns);
	const name = stringOrEmpty(nameAns);
	if (name.length === 0) return undefined;

	const urlAns = await clack.text({
		message: "Author URL (optional)",
	});
	assertNotCancelled(urlAns);
	const url = stringOrEmpty(urlAns);

	const emailAns = await clack.text({
		message: env.authorEmail
			? "Author email (press enter to use your git config)"
			: "Author email (optional)",
		...(env.authorEmail !== undefined && { defaultValue: env.authorEmail }),
		placeholder: env.authorEmail ?? "jane@example.com",
	});
	assertNotCancelled(emailAns);
	const email = stringOrEmpty(emailAns);

	return {
		name,
		...(url.length > 0 && { url }),
		...(email.length > 0 && { email }),
	};
}

async function resolveDescription(
	args: InitArgs,
	interactive: boolean,
	env: EnvironmentDefaults,
): Promise<string | undefined> {
	const flag = nonEmpty(args.description);
	if (flag !== undefined) return flag;
	if (!interactive) return env.description;
	const answer = await clack.text({
		message: env.description
			? "Short description (press enter to use package.json#description)"
			: "Short description (optional)",
		...(env.description !== undefined && { defaultValue: env.description }),
		placeholder: env.description ?? "What does the plugin do?",
	});
	assertNotCancelled(answer);
	const value = stringOrEmpty(answer);
	return value.length === 0 ? undefined : value;
}

async function resolveRepo(
	args: InitArgs,
	interactive: boolean,
	env: EnvironmentDefaults,
): Promise<string | undefined> {
	const flag = nonEmpty(args.repo);
	if (flag !== undefined) return flag;
	if (!interactive) return env.repo;
	const answer = await clack.text({
		message: env.repo
			? "Source repository URL (press enter to use the detected origin)"
			: "Source repository URL (optional)",
		...(env.repo !== undefined && { defaultValue: env.repo }),
		placeholder: env.repo ?? "https://github.com/...",
		validate: (raw) => {
			const v = (raw ?? "").trim();
			if (v.length === 0) return undefined;
			if (!v.startsWith("https://")) return "Must start with https://";
			return undefined;
		},
	});
	assertNotCancelled(answer);
	const value = stringOrEmpty(answer);
	return value.length === 0 ? undefined : value;
}

async function resolveSecurity(args: InitArgs, interactive: boolean) {
	const flagEmail = nonEmpty(args["security-email"]);
	const flagUrl = nonEmpty(args["security-url"]);

	if (flagEmail !== undefined || flagUrl !== undefined) {
		return {
			...(flagEmail !== undefined && { email: flagEmail }),
			...(flagUrl !== undefined && { url: flagUrl }),
		};
	}
	if (!interactive) return undefined;

	const emailAns = await clack.text({
		message: "Security contact email (leave blank to provide a URL or fill in later)",
	});
	assertNotCancelled(emailAns);
	const email = stringOrEmpty(emailAns);
	if (email.length > 0) return { email };

	const urlAns = await clack.text({
		message: "Security contact URL (leave blank to fill in later)",
	});
	assertNotCancelled(urlAns);
	const url = stringOrEmpty(urlAns);
	if (url.length === 0) return undefined;
	return { url };
}

interface SessionInfo {
	did: string;
	handle: string | null;
}

async function pickProbeDir(targetDir: string): Promise<string> {
	const { stat } = await import("node:fs/promises");
	try {
		const info = await stat(targetDir);
		if (info.isDirectory()) return targetDir;
	} catch {}
	return process.cwd();
}

async function loadCurrentSessionSilently(): Promise<SessionInfo | undefined> {
	try {
		const credentials = new FileCredentialStore();
		const current = await credentials.current();
		if (!current) return undefined;
		return { did: current.did, handle: current.handle };
	} catch {
		return undefined;
	}
}

function resolveSlugAndDir(args: InitArgs): { slug: string; targetDir: string } {
	const name = nonEmpty(args.name);
	const dirArg = nonEmpty(args.dir);
	if (name !== undefined) {
		const slug = name;
		const targetDir = dirArg !== undefined ? resolve(dirArg) : resolve(`./${slug}`);
		return { slug, targetDir };
	}
	const targetDir = dirArg !== undefined ? resolve(dirArg) : resolve(".");
	const slug = basename(targetDir);
	return { slug, targetDir };
}

function printNextSteps(targetDir: string, inputs: ScaffoldInputs, interactive: boolean): void {
	const todos: string[] = [];
	if (inputs.publisher === undefined) todos.push("publisher");
	if (inputs.author === undefined) todos.push("author");
	if (inputs.security === undefined) todos.push("security");

	if (interactive) {
		const lines: string[] = [];
		if (todos.length > 0) {
			lines.push(
				`${pc.yellow("⚠")} Fill in the TODO placeholders in emdash-plugin.jsonc (${todos.join(", ")}) before bundling.`,
			);
		}
		lines.push(`1. ${pc.cyan(`cd ${targetDir}`)}`);
		lines.push(`2. ${pc.cyan("pnpm install")}`);
		lines.push(`3. ${pc.cyan("pnpm test")}    confirm the scaffold passes its own test`);
		lines.push(`4. Edit src/plugin.ts to add routes and hooks.`);
		lines.push(`5. ${pc.cyan("emdash-plugin bundle")}   when ready to publish`);
		clack.note(lines.join("\n"), "Next steps");
		clack.outro(`Plugin ready at ${pc.bold(targetDir)}`);
		return;
	}

	consola.info("");
	consola.info("Next steps:");
	if (todos.length > 0) {
		consola.info(
			`  ${pc.yellow("!")} Fill in the TODO placeholders in ${pc.dim(`${targetDir}/emdash-plugin.jsonc`)} (${todos.join(", ")}) before bundling.`,
		);
	}
	consola.info(`  1. ${pc.cyan(`cd ${targetDir}`)}`);
	consola.info(`  2. ${pc.cyan("pnpm install")}`);
	consola.info(`  3. ${pc.cyan("pnpm test")}    # confirm the scaffold passes its own test`);
	consola.info(`  4. Edit ${pc.dim("src/plugin.ts")} to add routes and hooks.`);
	consola.info(`  5. ${pc.cyan("emdash-plugin bundle")}   # when ready to publish`);
}

function assertNotCancelled(value: unknown): void {
	if (clack.isCancel(value)) {
		clack.cancel("Cancelled.");
		process.exit(0);
	}
}

function stringOrEmpty(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim();
}

function nonEmpty(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}

class InputError extends Error {
	override readonly name = "InputError";
}
