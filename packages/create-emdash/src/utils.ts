import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_NAME_PATTERN = /^[a-z0-9-]+$/;
const INVALID_PKG_NAME_CHARS = /[^a-z0-9-]/g;
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g;

export function generateEncryptionKey(): string {
	const body = randomBytes(32).toString("base64url");
	return `emdash_enc_v1_${body}`;
}

const POPULATED_KEY_LINE_PATTERN = /^EMDASH_ENCRYPTION_KEY=.+$/m;
const ANY_KEY_LINE_PATTERN = /^EMDASH_ENCRYPTION_KEY=.*$/m;

export function writeEncryptionKey(projectDir: string, fileName: string): "wrote" | "skipped" {
	const target = resolve(projectDir, fileName);
	const existing = existsSync(target) ? readFileSync(target, "utf-8") : "";
	if (POPULATED_KEY_LINE_PATTERN.test(existing)) {
		return "skipped";
	}
	const value = generateEncryptionKey();
	const newLine = `EMDASH_ENCRYPTION_KEY=${value}`;
	let next: string;
	if (ANY_KEY_LINE_PATTERN.test(existing)) {
		next = existing.replace(ANY_KEY_LINE_PATTERN, newLine);
		if (!next.endsWith("\n")) next += "\n";
	} else {
		const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n";
		next = `${existing}${sep}${newLine}\n`;
	}
	writeFileSync(target, next);
	return "wrote";
}

export function sanitizePackageName(name: string): string {
	return (
		name.toLowerCase().replace(INVALID_PKG_NAME_CHARS, "-").replace(LEADING_TRAILING_HYPHENS, "") ||
		"my-site"
	);
}

export function isDirNonEmpty(dir: string): boolean {
	try {
		return readdirSync(dir).length > 0;
	} catch {
		return false;
	}
}

export function parseTargetArg(argv: string[]): string | undefined {
	return argv.slice(2).find((a) => !a.startsWith("-"));
}
