import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { defineCommand } from "citty";
import { consola } from "consola";
import pc from "picocolors";

import { EmDashSecretsError, fingerprintKey, generateEncryptionKey } from "../../config/secrets.js";

const KEY_VAR_NAME = "EMDASH_ENCRYPTION_KEY";
const POPULATED_KEY_LINE_PATTERN = /^EMDASH_ENCRYPTION_KEY=.+$/m;
const ANY_KEY_LINE_PATTERN = /^EMDASH_ENCRYPTION_KEY=.*$/m;

export function writeEncryptionKeyToFile(
	targetPath: string,
	value: string,
	force: boolean,
): "wrote" | "skipped" {
	const exists = existsSync(targetPath);
	const existing = exists ? readFileSync(targetPath, "utf-8") : "";

	const hasPopulatedKey = POPULATED_KEY_LINE_PATTERN.test(existing);
	if (hasPopulatedKey && !force) {
		return "skipped";
	}

	const newLine = `${KEY_VAR_NAME}=${value}`;
	let next: string;
	if (ANY_KEY_LINE_PATTERN.test(existing)) {
		next = existing.replace(ANY_KEY_LINE_PATTERN, newLine);
		if (!next.endsWith("\n")) next += "\n";
	} else {
		const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n";
		next = `${existing}${sep}${newLine}\n`;
	}

	writeFileSync(targetPath, next);
	return "wrote";
}

const generateCommand = defineCommand({
	meta: {
		name: "generate",
		description: "Generate a new EmDash encryption key",
	},
	args: {
		write: {
			type: "string",
			description:
				"Optional path to write the key to (e.g. .env). " +
				"Won't overwrite an existing entry without --force.",
		},
		force: {
			type: "boolean",
			description: "When used with --write, overwrite an existing entry",
			default: false,
		},
	},
	run({ args }) {
		const value = generateEncryptionKey();

		if (args.write) {
			const targetPath = resolve(process.cwd(), args.write);
			const result = writeEncryptionKeyToFile(targetPath, value, args.force);
			if (result === "skipped") {
				consola.info(
					`${KEY_VAR_NAME} already set in ${pc.cyan(args.write)}; leaving it alone. ` +
						`Pass ${pc.bold("--force")} to replace it.`,
				);
				return;
			}
			consola.log("");
			consola.log(`${pc.bold("Wrote")} ${pc.cyan(KEY_VAR_NAME)} to ${pc.cyan(args.write)}`);
			consola.log("");
			consola.log(
				pc.yellow(
					"Keep this file out of version control. Losing the key means losing every secret encrypted with it.",
				),
			);
			consola.log("");
			return;
		}

		process.stdout.write(`${value}\n`);
		const guidance = [
			"",
			pc.bold("EmDash encryption key generated."),
			"",
			`Set ${pc.cyan(KEY_VAR_NAME)} in your environment.`,
			"For Cloudflare deployments, push it to your Worker's secrets.",
			"For Node deployments, add it to your process environment or .env file.",
			"",
			pc.yellow("Keep this value secret. Losing it means losing every secret encrypted with it."),
			"",
		].join("\n");
		process.stderr.write(`${guidance}\n`);
	},
});

const fingerprintCommand = defineCommand({
	meta: {
		name: "fingerprint",
		description: "Print the kid (8-char fingerprint) for an encryption key",
	},
	args: {
		key: {
			type: "positional",
			description: "The full key value (with the emdash_enc_v1_ prefix)",
			required: true,
		},
	},
	async run({ args }) {
		try {
			const kid = await fingerprintKey(args.key);
			process.stdout.write(`${kid}\n`);
		} catch (error) {
			consola.error(
				error instanceof EmDashSecretsError ? error.message : "Failed to fingerprint key",
			);
			process.exit(1);
		}
	},
});

export const secretsCommand = defineCommand({
	meta: {
		name: "secrets",
		description: "Manage EmDash secrets (generate, inspect)",
	},
	subCommands: {
		generate: generateCommand,
		fingerprint: fingerprintCommand,
	},
});
