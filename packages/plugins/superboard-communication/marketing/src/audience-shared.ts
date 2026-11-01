import type { ProjectContext } from "@superboard/contracts/project-context";

import { failure } from "./auth";
import type { Env } from "./types";

export type AudienceBindings = {
	Bindings: Env;
	Variables: { project: ProjectContext };
};

/** D1 accepts at most 100 bound parameters per statement; keep headroom for scope values. */
export const D1_PARAMETER_CHUNK = 90;
/** D1 batches stay small so one slow statement never holds the whole request. */
export const D1_BATCH_SIZE = 100;

export function chunks<T>(values: readonly T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size)
		result.push(values.slice(index, index + size));
	return result;
}

export async function runBatches(db: D1Database, statements: D1PreparedStatement[]) {
	for (const part of chunks(statements, D1_BATCH_SIZE)) if (part.length) await db.batch(part);
}

/** Text of a primitive input value; missing values and objects read as empty text. */
export function plainText(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
		return String(value);
	return "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function choice<T extends string>(
	value: unknown,
	field: string,
	allowed: readonly T[],
	fallback?: T,
): T {
	const parsed = value == null || value === "" ? fallback : plainText(value);
	if (!isOneOf(parsed, allowed))
		throw failure(`${field}_invalid`, `${field} must be one of ${allowed.join(", ")}`);
	return parsed;
}

export function escapeHtml(value: unknown) {
	return plainText(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function randomUrlToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isFrench(locale: unknown) {
	return plainText(locale).toLowerCase().startsWith("fr");
}

/** Picks the visitor language from an explicit value, then Accept-Language. */
export function requestLocale(explicit: unknown, acceptLanguage: string | null | undefined) {
	if (typeof explicit === "string" && explicit.trim()) return isFrench(explicit) ? "fr" : "en";
	const first = String(acceptLanguage ?? "")
		.split(",")[0]
		?.trim()
		.toLowerCase();
	return first?.startsWith("fr") ? "fr" : "en";
}

/** Minimal, dependency-free public page shell used by preference center and forms. */
export function publicPage({
	title,
	body,
	locale,
	accent = "#18181b",
}: {
	title: string;
	body: string;
	locale: string;
	accent?: string;
}) {
	const safeAccent = /^#[0-9a-f]{3,8}$/iu.test(accent) ? accent : "#18181b";
	return `<!doctype html><html lang="${locale === "fr" ? "fr" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>
:root{color-scheme:light dark;--accent:${safeAccent}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#f4f4f5;color:#18181b}
main{max-width:560px;margin:40px auto;padding:32px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.5rem;margin:0 0 8px}p{margin:0 0 16px;color:#3f3f46}
label{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid #e4e4e7;cursor:pointer}
label.field{display:block;border:0;padding:6px 0}label.field span{display:block;font-size:.875rem;margin-bottom:4px}
input[type=email],input[type=text],input[type=number],input[type=date],select{width:100%;padding:10px 12px;border:1px solid #d4d4d8;border-radius:8px;font:inherit;background:#fff;color:inherit}
input[type=checkbox]{margin-top:4px;width:18px;height:18px;accent-color:var(--accent)}
small{display:block;color:#71717a}
button{font:inherit;padding:10px 16px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}
button.secondary{background:transparent;color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}.notice{padding:12px 16px;border-radius:8px;background:#f0fdf4;color:#166534;margin-bottom:16px}
.warning{background:#fef2f2;color:#991b1b}.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
@media (prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}main{background:#18181b}p{color:#d4d4d8}label{border-color:#27272a}input,select{background:#09090b;border-color:#3f3f46}}
</style></head><body><main>${body}</main></body></html>`;
}
