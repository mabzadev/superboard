import type { PageMetadataContribution, PageMetadataLinkRel } from "../plugins/types.js";

export interface ResolvedPageMetadata {
	meta: Array<{ name: string; content: string }>;
	properties: Array<{ property: string; content: string }>;
	links: Array<{
		rel: PageMetadataLinkRel;
		href: string;
		hreflang?: string;
	}>;
	jsonld: Array<{ id?: string; json: string }>;
}

interface RenderPageMetadataOptions {
	includeJsonLd?: boolean;
}

const SAFE_HREF_RE = /^(https?|at):\/\//i;
const HTML_ESCAPE_MAP: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
const HTML_ESCAPE_RE = /[&<>"']/g;

export function escapeHtmlAttr(value: string): string {
	return value.replace(HTML_ESCAPE_RE, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

function isSafeHref(url: string): boolean {
	return SAFE_HREF_RE.test(url);
}

const JSONLD_LT_RE = /</g;
const JSONLD_GT_RE = />/g;
const JSONLD_U2028_RE = /\u2028/g;
const JSONLD_U2029_RE = /\u2029/g;

export function safeJsonLdSerialize(value: unknown): string {
	return JSON.stringify(value)
		.replace(JSONLD_LT_RE, "\\u003c")
		.replace(JSONLD_GT_RE, "\\u003e")
		.replace(JSONLD_U2028_RE, "\\u2028")
		.replace(JSONLD_U2029_RE, "\\u2029");
}

export async function createSha256CspHash(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	const bytes = new Uint8Array(digest);
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return `sha256-${btoa(binary)}`;
}

interface CspScriptHashSink {
	insertScriptHash(hash: string): void;
}

export async function registerJsonLdCspHashes(
	enabled: boolean,
	getCsp: () => CspScriptHashSink | undefined,
	scripts: ReadonlyArray<{ json: string }>,
): Promise<void> {
	if (!enabled || scripts.length === 0) return;

	const csp = getCsp();
	if (!csp) return;

	await Promise.all(
		scripts.map(async ({ json }) => {
			csp.insertScriptHash(await createSha256CspHash(json));
		}),
	);
}

export function resolvePageMetadata(
	contributions: PageMetadataContribution[],
): ResolvedPageMetadata {
	const result: ResolvedPageMetadata = {
		meta: [],
		properties: [],
		links: [],
		jsonld: [],
	};

	const seenMeta = new Set<string>();
	const seenProperties = new Set<string>();
	const seenLinks = new Set<string>();
	const seenJsonLd = new Set<string>();

	for (const c of contributions) {
		switch (c.kind) {
			case "meta": {
				const dedupeKey = c.key ?? c.name;
				if (seenMeta.has(dedupeKey)) continue;
				seenMeta.add(dedupeKey);
				result.meta.push({ name: c.name, content: c.content });
				break;
			}
			case "property": {
				const dedupeKey = c.key ?? c.property;
				if (seenProperties.has(dedupeKey)) continue;
				seenProperties.add(dedupeKey);
				result.properties.push({
					property: c.property,
					content: c.content,
				});
				break;
			}
			case "link": {
				if (!isSafeHref(c.href)) {
					if (import.meta.env?.DEV) {
						console.warn(
							`[page:metadata] Rejected link contribution with unsafe href scheme: ${c.href}`,
						);
					}
					continue;
				}
				if (c.rel === "canonical") {
					if (seenLinks.has("canonical")) continue;
					seenLinks.add("canonical");
				} else {
					const dedupeKey = c.key ?? c.hreflang ?? c.href;
					if (seenLinks.has(dedupeKey)) continue;
					seenLinks.add(dedupeKey);
				}
				result.links.push({
					rel: c.rel,
					href: c.href,
					...(c.hreflang && { hreflang: c.hreflang }),
				});
				break;
			}
			case "jsonld": {
				if (c.id) {
					if (seenJsonLd.has(c.id)) continue;
					seenJsonLd.add(c.id);
				}
				result.jsonld.push({
					id: c.id,
					json: safeJsonLdSerialize(c.graph),
				});
				break;
			}
			default:
				break;
		}
	}

	return result;
}

export function renderPageMetadata(
	metadata: ResolvedPageMetadata,
	options: RenderPageMetadataOptions = {},
): string {
	const parts: string[] = [];
	const includeJsonLd = options.includeJsonLd ?? true;

	for (const m of metadata.meta) {
		parts.push(`<meta name="${escapeHtmlAttr(m.name)}" content="${escapeHtmlAttr(m.content)}">`);
	}

	for (const p of metadata.properties) {
		parts.push(
			`<meta property="${escapeHtmlAttr(p.property)}" content="${escapeHtmlAttr(p.content)}">`,
		);
	}

	for (const l of metadata.links) {
		let tag = `<link rel="${escapeHtmlAttr(l.rel)}" href="${escapeHtmlAttr(l.href)}"`;
		if (l.hreflang) {
			tag += ` hreflang="${escapeHtmlAttr(l.hreflang)}"`;
		}
		tag += ">";
		parts.push(tag);
	}

	if (includeJsonLd) {
		for (const j of metadata.jsonld) {
			parts.push(`<script type="application/ld+json">${j.json}</script>`);
		}
	}

	return parts.join("\n");
}
