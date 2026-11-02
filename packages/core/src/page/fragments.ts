import type { PageFragmentContribution, PagePlacement } from "../plugins/types.js";
import { escapeHtmlAttr } from "./metadata.js";

const SCRIPT_CLOSE_RE = /<\//g;

export function resolveFragments(
	contributions: PageFragmentContribution[],
	placement: PagePlacement,
): PageFragmentContribution[] {
	const filtered = contributions.filter((c) => c.placement === placement);
	const seen = new Set<string>();
	const result: PageFragmentContribution[] = [];

	for (const c of filtered) {
		if (c.key) {
			const dedupeKey = `key:${c.key}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
		} else if (c.kind === "external-script") {
			const dedupeKey = `src:${c.src}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
		}

		result.push(c);
	}

	return result;
}

const EVENT_HANDLER_RE = /^on/i;

function renderAttributes(attrs: Record<string, string>): string {
	return Object.entries(attrs)
		.filter(([k]) => !EVENT_HANDLER_RE.test(k))
		.map(([k, v]) => ` ${escapeHtmlAttr(k)}="${escapeHtmlAttr(v)}"`)
		.join("");
}

function renderFragment(c: PageFragmentContribution): string {
	switch (c.kind) {
		case "external-script": {
			let tag = `<script src="${escapeHtmlAttr(c.src)}"`;
			if (c.async) tag += " async";
			if (c.defer) tag += " defer";
			if (c.attributes) tag += renderAttributes(c.attributes);
			tag += "></script>";
			return tag;
		}
		case "inline-script": {
			let tag = "<script";
			if (c.attributes) tag += renderAttributes(c.attributes);
			tag += `>${c.code.replace(SCRIPT_CLOSE_RE, "<\\/")}</script>`;
			return tag;
		}
		case "html":
			return c.html;
	}
}

export function renderFragments(
	contributions: PageFragmentContribution[],
	placement: PagePlacement,
): string {
	const resolved = resolveFragments(contributions, placement);
	return resolved.map(renderFragment).join("\n");
}
