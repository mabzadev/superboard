import { dirname } from "node:path";

import { defineCommand } from "citty";
import consola from "consola";
import pc from "picocolors";

import { ManifestError, loadManifest, MANIFEST_FILENAME } from "../manifest/load.js";
import { resolveSections, SectionError } from "../manifest/translate.js";

export const validateCommand = defineCommand({
	meta: {
		name: "validate",
		description:
			"Validate an emdash-plugin.jsonc manifest against the v1 schema (offline; no network access).",
	},
	args: {
		path: {
			type: "positional",
			required: false,
			description: `Path to the manifest, or the directory containing it. Defaults to ./${MANIFEST_FILENAME}.`,
		},
		json: {
			type: "boolean",
			description:
				"Emit machine-readable JSON instead of human-readable output. Stdout is { ok: true, path } or { ok: false, error: { code, message, issues } }. Exit code mirrors human mode.",
		},
	},
	async run({ args }) {
		const path = args.path ?? ".";
		try {
			const { manifest, path: resolved } = await loadManifest(path);
			await resolveSections(manifest.sections, dirname(resolved));

			if (args.json) {
				process.stdout.write(`${JSON.stringify({ ok: true, path: resolved })}\n`);
				return;
			}

			consola.success(`Manifest is valid: ${pc.dim(resolved)}`);
		} catch (error) {
			if (error instanceof ManifestError) {
				if (args.json) {
					process.stdout.write(
						`${JSON.stringify({
							ok: false,
							error: {
								code: error.code,
								message: error.message,
								path: error.path,
								issues: error.issues,
							},
						})}\n`,
					);
				} else {
					consola.error(error.message);
				}
				process.exit(1);
			}
			if (error instanceof SectionError) {
				if (args.json) {
					process.stdout.write(
						`${JSON.stringify({
							ok: false,
							error: { code: error.code, message: error.message, section: error.section },
						})}\n`,
					);
				} else {
					consola.error(error.message);
				}
				process.exit(1);
			}
			throw error;
		}
	},
});
