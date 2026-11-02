import type { PortableTextBlock } from "@emdash-cms/gutenberg-to-portable-text";
import mime from "mime/lite";

import { RESERVED_FIELD_SLUGS } from "../schema/types.js";
import type { ImportFieldDef, CollectionSchemaStatus } from "./types.js";

export const INTERNAL_POST_TYPES = [
	"revision",
	"nav_menu_item",
	"custom_css",
	"customize_changeset",
	"oembed_cache",
	"wp_global_styles",
	"wp_navigation",
	"wp_template",
	"wp_template_part",
	"attachment",
	"wp_block",
];

export const INTERNAL_META_PREFIXES = ["_edit_", "_wp_"];

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const TRAILING_SLASHES = /\/+$/;
const WP_JSON_SUFFIX = /\/wp-json\/?.*$/;

export const INTERNAL_META_KEYS = ["_edit_last", "_edit_lock", "_pingme", "_encloseme"];

export const BASE_REQUIRED_FIELDS: ImportFieldDef[] = [
	{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
	{ slug: "content", label: "Content", type: "portableText", required: false, searchable: true },
	{ slug: "excerpt", label: "Excerpt", type: "text", required: false },
];

export const FEATURED_IMAGE_FIELD: ImportFieldDef = {
	slug: "featured_image",
	label: "Featured Image",
	type: "image",
	required: false,
};

export function isInternalPostType(type: string): boolean {
	return INTERNAL_POST_TYPES.includes(type);
}

export function isInternalMetaKey(key: string): boolean {
	if (INTERNAL_META_KEYS.includes(key)) return true;

	for (const prefix of INTERNAL_META_PREFIXES) {
		if (key.startsWith(prefix)) return true;
	}

	if (key === "_thumbnail_id") return false;
	if (key.startsWith("_yoast_")) return false;
	if (key.startsWith("_rank_math_")) return false;

	if (key.startsWith("_")) return true;

	return false;
}

export type WpStatus = "publish" | "draft" | "pending" | "private" | "future";

export function mapWpStatus(status: string | undefined): WpStatus {
	switch (status) {
		case "publish":
			return "publish";
		case "draft":
			return "draft";
		case "pending":
			return "pending";
		case "private":
			return "private";
		case "future":
			return "future";
		default:
			return "draft";
	}
}

const POST_TYPE_TO_COLLECTION: Record<string, string> = {
	post: "posts",
	page: "pages",
	attachment: "media",
	product: "products",
	portfolio: "portfolio",
	testimonial: "testimonials",
	team: "team",
	event: "events",
	faq: "faqs",
};

export function mapPostTypeToCollection(postType: string): string {
	return POST_TYPE_TO_COLLECTION[postType] || postType;
}

export function mapMetaKeyToField(key: string): string {
	if (key === "_yoast_wpseo_title") return "seo_title";
	if (key === "_yoast_wpseo_metadesc") return "seo_description";
	if (key === "_rank_math_title") return "seo_title";
	if (key === "_rank_math_description") return "seo_description";
	if (key === "_thumbnail_id") return "featured_image";

	if (key.startsWith("_")) return key.slice(1);

	return key;
}

export function inferMetaType(
	key: string,
	value: string | undefined,
): "string" | "number" | "boolean" | "date" | "json" {
	if (key.endsWith("_id") || key === "_thumbnail_id") return "string";
	if (key.endsWith("_date") || key.endsWith("_time")) return "date";
	if (key.endsWith("_count") || key.endsWith("_number")) return "number";

	if (!value) return "string";

	if (value.startsWith("a:") || value.startsWith("{") || value.startsWith("[")) return "json";

	if (NUMERIC_PATTERN.test(value)) return "number";

	if (["0", "1", "true", "false"].includes(value)) return "boolean";

	return "string";
}

const PLUGIN_META_PREFIXES = [
	"aawp_",
	"algolia_",
	"amazon_polly_",
	"ampforwp_",
	"classifai_",
	"essb_",
	"eg_",
	"gnpub_",
	"jetpack_",
	"mashsb_",
	"monsterinsights_",
	"onesignal_",
	"penci_",
	"perfmatters_",
	"pys_",
	"rank_math_",
	"rp4wp_",
	"saswp_",
	"sbg_",
	"snap_",
	"spay_",
	"tie_",
	"wl_",
	"wpil_",
	"wprm_",
	"wpswa_",
	"wpuf_",
	"yarpp_",
];

const PLUGIN_META_KEYS = new Set([
	"entity_same_as",
	"exclude_from_search",
	"footnotes",
	"inline_featured_image",
	"os_meta",
	"thirstydata",
]);

export function isPluginBookkeepingMeta(key: string): boolean {
	const normalized = key.replaceAll("-", "_");
	if (PLUGIN_META_KEYS.has(normalized)) return true;
	return PLUGIN_META_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

const INVALID_FIELD_SLUG_CHARS = /[^a-z0-9_]+/g;
const LEADING_NON_ALPHA_CHARS = /^[^a-z]+/;

export function sanitizeFieldSlug(key: string): string {
	const sanitized = key
		.toLowerCase()
		.replace(INVALID_FIELD_SLUG_CHARS, "_")
		.replace(LEADING_NON_ALPHA_CHARS, "")
		.slice(0, 63);
	if (!sanitized) return "field";
	if (RESERVED_FIELD_SLUGS.includes(sanitized)) return `wp_${sanitized}`;
	return sanitized;
}

const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const LEADING_WWW = /^www\./;

function relativizeUrl(url: string, sourceHost: string): string | null {
	if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
	try {
		const parsed = new URL(url);
		if (parsed.hostname.replace(LEADING_WWW, "") !== sourceHost) return null;
		if (parsed.pathname.startsWith("/wp-content/")) return null;
		return `${parsed.pathname}${parsed.search}${parsed.hash}` || "/";
	} catch {
		return null;
	}
}

function relativizeMarkDefs(
	markDefs: Array<{ _type: string; [key: string]: unknown }> | undefined,
	sourceHost: string,
): void {
	for (const def of markDefs ?? []) {
		if (def._type === "link" && typeof def.href === "string") {
			def.href = relativizeUrl(def.href, sourceHost) ?? def.href;
		}
	}
}

export function relativizeContentLinks(blocks: PortableTextBlock[], siteUrl: string): void {
	let sourceHost: string;
	try {
		sourceHost = new URL(siteUrl).hostname.replace(LEADING_WWW, "");
	} catch {
		return;
	}
	const hrefPattern = new RegExp(
		`href=(["']?)https?://(?:www\\.)?${sourceHost.replace(REGEX_SPECIALS, "\\$&")}(/[^"'\\s>]*)?\\1`,
		"gi",
	);

	for (const block of blocks) {
		switch (block._type) {
			case "block":
				relativizeMarkDefs(block.markDefs, sourceHost);
				break;
			case "image":
				if (block.link) block.link = relativizeUrl(block.link, sourceHost) ?? block.link;
				break;
			case "table":
				for (const row of block.rows) {
					for (const cell of row.cells) relativizeMarkDefs(cell.markDefs, sourceHost);
				}
				break;
			case "columns":
				for (const column of block.columns) relativizeContentLinks(column.content, siteUrl);
				break;
			case "cover":
				relativizeContentLinks(block.content, siteUrl);
				break;
			case "button":
				if (block.url) block.url = relativizeUrl(block.url, sourceHost) ?? block.url;
				break;
			case "buttons":
				for (const button of block.buttons) {
					if (button.url) button.url = relativizeUrl(button.url, sourceHost) ?? button.url;
				}
				break;
			case "htmlBlock":
				block.html = block.html.replace(
					hrefPattern,
					(_m, _quote: string, path: string | undefined) => {
						return `href="${path || "/"}"`;
					},
				);
				break;
			case "code":
			case "embed":
			case "gallery":
			case "break":
			case "file":
			case "pullquote":
				break;
			default:
				block satisfies never;
		}
	}
}

export { slugify } from "../utils/slugify.js";

export function normalizeUrl(url: string): string {
	let normalized = url.trim();

	if (!normalized.startsWith("http")) {
		normalized = `https://${normalized}`;
	}

	normalized = normalized.replace(TRAILING_SLASHES, "");

	normalized = normalized.replace(WP_JSON_SUFFIX, "");

	return normalized;
}

export function getFilenameFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split("/").filter(Boolean);
		return segments.pop();
	} catch {
		return undefined;
	}
}

export function guessMimeType(filename: string): string | undefined {
	return mime.getType(filename) ?? undefined;
}

export function buildAttachmentMap(
	attachments: Array<{ id?: number | string; url?: string }>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const att of attachments) {
		if (att.id && att.url) {
			map.set(String(att.id), att.url);
		}
	}
	return map;
}

export function isTypeCompatible(requiredType: string, existingType: string): boolean {
	if (requiredType === existingType) return true;

	const compatibleTypes: Record<string, string[]> = {
		string: ["string", "text", "slug"],
		text: ["string", "text"],
		portableText: ["portableText", "json"],
		number: ["number", "integer"],
		integer: ["number", "integer"],
	};

	const compatible = compatibleTypes[requiredType];
	return compatible?.includes(existingType) ?? false;
}

import type { BylineRepository } from "../database/repositories/byline.js";
import { slugify as slugifyFn } from "../utils/slugify.js";

const MAX_SLUG_COLLISION_ATTEMPTS = 1000;

export async function ensureUniqueBylineSlug(
	bylineRepo: BylineRepository,
	baseSlug: string,
): Promise<string> {
	let candidate = baseSlug;
	let suffix = 2;
	while (await bylineRepo.findBySlug(candidate)) {
		if (suffix > MAX_SLUG_COLLISION_ATTEMPTS) {
			throw new Error(
				`Byline slug collision limit exceeded for base slug "${baseSlug}". ` +
					`Tried ${MAX_SLUG_COLLISION_ATTEMPTS} variants.`,
			);
		}
		candidate = `${baseSlug}-${suffix}`;
		suffix++;
	}
	return candidate;
}

export async function resolveImportByline(
	authorLogin: string | undefined,
	displayName: string | undefined,
	mappedUserId: string | undefined,
	bylineRepo: BylineRepository,
	cache: Map<string, string>,
): Promise<string | undefined> {
	if (!authorLogin) return undefined;
	const cacheKey = `${authorLogin}:${mappedUserId ?? ""}`;
	const cached = cache.get(cacheKey);
	if (cached) return cached;

	if (mappedUserId) {
		const existingForUser = await bylineRepo.findByUserId(mappedUserId);
		if (existingForUser) {
			cache.set(cacheKey, existingForUser.id);
			return existingForUser.id;
		}
	}

	const name = displayName || authorLogin;
	const slugBase = slugifyFn(authorLogin);
	const slug = await ensureUniqueBylineSlug(bylineRepo, slugBase || "author");
	const created = await bylineRepo.create({
		slug,
		displayName: name,
		userId: mappedUserId ?? null,
		isGuest: !mappedUserId,
	});

	cache.set(cacheKey, created.id);
	return created.id;
}

export function checkSchemaCompatibility(
	requiredFields: ImportFieldDef[],
	existingCollection: { slug: string; fields: Map<string, { type: string }> } | undefined,
): CollectionSchemaStatus {
	if (!existingCollection) {
		const fieldStatus: CollectionSchemaStatus["fieldStatus"] = {};
		for (const field of requiredFields) {
			fieldStatus[field.slug] = {
				status: "missing",
				requiredType: field.type,
			};
		}
		return {
			exists: false,
			fieldStatus,
			canImport: true,
		};
	}

	const fieldStatus: CollectionSchemaStatus["fieldStatus"] = {};
	const incompatibleFields: string[] = [];

	for (const field of requiredFields) {
		const existingField = existingCollection.fields.get(field.slug);

		if (!existingField) {
			fieldStatus[field.slug] = {
				status: "missing",
				requiredType: field.type,
			};
		} else if (isTypeCompatible(field.type, existingField.type)) {
			fieldStatus[field.slug] = {
				status: "compatible",
				existingType: existingField.type,
				requiredType: field.type,
			};
		} else {
			fieldStatus[field.slug] = {
				status: "type_mismatch",
				existingType: existingField.type,
				requiredType: field.type,
			};
			incompatibleFields.push(field.slug);
		}
	}

	const canImport = incompatibleFields.length === 0;
	const reason = canImport
		? undefined
		: `Incompatible field types: ${incompatibleFields.join(", ")}`;

	return {
		exists: true,
		fieldStatus,
		canImport,
		reason,
	};
}
