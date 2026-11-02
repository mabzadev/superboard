import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
	renderGitignore,
	renderManifest,
	renderPackageJson,
	renderPluginEntry,
	renderReadme,
	renderTest,
	renderTsconfig,
	type ScaffoldInputs,
} from "./templates.js";

export type InitErrorCode = "TARGET_FILE_EXISTS" | "INVALID_SLUG" | "INVALID_PUBLISHER";

export class InitError extends Error {
	override readonly name = "InitError";
	readonly code: InitErrorCode;
	readonly conflicts: string[];

	constructor(code: InitErrorCode, message: string, conflicts: string[] = []) {
		super(message);
		this.code = code;
		this.conflicts = conflicts;
	}
}

export interface ScaffoldOptions {
	targetDir: string;
	inputs: ScaffoldInputs;
	force: boolean;
	onFileWritten?: (relativePath: string) => void;
}

export interface ScaffoldResult {
	written: string[];
}

const FILES = [
	"emdash-plugin.jsonc",
	"package.json",
	"tsconfig.json",
	".gitignore",
	"README.md",
	"src/plugin.ts",
	"tests/plugin.test.ts",
] as const;

type ScaffoldFile = (typeof FILES)[number];

export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldResult> {
	const { targetDir, inputs, force, onFileWritten } = options;
	const absDir = resolve(targetDir);

	if (!force) {
		const conflicts: string[] = [];
		for (const file of FILES) {
			const absPath = join(absDir, file);
			if (await exists(absPath)) {
				conflicts.push(file);
			}
		}
		if (conflicts.length > 0) {
			throw new InitError(
				"TARGET_FILE_EXISTS",
				`Cannot scaffold into ${absDir}: the following files already exist. Pass --force to overwrite them.\n  ${conflicts.join("\n  ")}`,
				conflicts,
			);
		}
	}

	await mkdir(absDir, { recursive: true });

	const written: string[] = [];
	for (const file of FILES) {
		const absPath = join(absDir, file);
		await mkdir(dirname(absPath), { recursive: true });
		await writeFile(absPath, renderFile(file, inputs), "utf8");
		written.push(absPath);
		onFileWritten?.(file);
	}

	return { written };
}

function renderFile(file: ScaffoldFile, inputs: ScaffoldInputs): string {
	switch (file) {
		case "emdash-plugin.jsonc":
			return renderManifest(inputs);
		case "package.json":
			return renderPackageJson(inputs);
		case "tsconfig.json":
			return renderTsconfig();
		case ".gitignore":
			return renderGitignore();
		case "README.md":
			return renderReadme(inputs);
		case "src/plugin.ts":
			return renderPluginEntry();
		case "tests/plugin.test.ts":
			return renderTest();
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
