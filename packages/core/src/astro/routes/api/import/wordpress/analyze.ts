import type { APIRoute } from "astro";
import { parseWxrString, SchemaRegistry, type WxrData } from "emdash";
import mime from "mime/lite";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { RESERVED_COLLECTION_SLUGS } from "#schema/types.js";
import type { EmDashHandlers } from "#types";

export const prerender = false;

const NUMERIC_PATTERN = /^-?\d+(\.\d+)?$/;
const INVALID_SLUG_CHARS = /[^a-z0-9_]/g;
const LEADING_NON_ALPHA = /^[^a-z]+/;

export type FieldCompatibility = "compatible" | "type_mismatch" | "missing";

export interface ImportFieldDef {
	slug: string;
	label: string;
	type: string;
	required: boolean;
	searchable?: boolean;
}

export interface CollectionSchemaStatus {
	exists: boolean;
	fieldStatus: Record<
		string,
		{
			status: FieldCompatibility;
			existingType?: string;
			requiredType: string;
		}
	>;
	canImport: boolean;
	reason?: string;
}

export interface PostTypeAnalysis {
	name: string;
	count: number;
	suggestedCollection: string;
	requiredFields: ImportFieldDef[];
	schemaStatus: CollectionSchemaStatus;
}

export interface AttachmentInfo {
	id?: number;
	title?: string;
	url?: string;
	filename?: string;
	mimeType?: string;
}

export interface WpAuthorInfo {
	id?: number;
	login?: string;
	email?: string;
	displayName?: string;
	postCount: number;
}

export interface WxrAnalysis {
	site: {
		title: string;
		url: string;
	};
	postTypes: PostTypeAnalysis[];
	attachments: {
		count: number;
		items: AttachmentInfo[];
	};
	categories: number;
	tags: number;
	authors: WpAuthorInfo[];
	customFields: Array<{
		key: string;
		count: number;
		samples: string[];
		suggestedField: string;
		suggestedType: "string" | "number" | "boolean" | "date" | "json";
		isInternal: boolean;
	}>;
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	const denied = requirePerm(user, "import:execute");
	if (denied) return denied;

	try {
		const formData = await request.formData();
		const fileEntry = formData.get("file");
		const file = fileEntry instanceof File ? fileEntry : null;

		if (!file) {
			return apiError("VALIDATION_ERROR", "No file provided", 400);
		}

		const text = await file.text();
		const wxr = await parseWxrString(text);

		const existingCollections = await fetchExistingCollections(emdash?.db);

		const analysis = analyzeWxr(wxr, existingCollections);

		return apiSuccess(analysis);
	} catch (error) {
		return handleError(error, "Failed to analyze file", "WXR_ANALYZE_ERROR");
	}
};

interface ExistingCollection {
	slug: string;
	fields: Map<string, { type: string; columnType: string }>;
}

async function fetchExistingCollections(
	db: EmDashHandlers["db"] | undefined,
): Promise<Map<string, ExistingCollection>> {
	const result = new Map<string, ExistingCollection>();

	if (!db) return result;

	try {
		const registry = new SchemaRegistry(db);

		const collections = await registry.listCollections();

		for (const collection of collections) {
			const fields = await registry.listFields(collection.id);
			const fieldMap = new Map<string, { type: string; columnType: string }>();

			for (const field of fields) {
				fieldMap.set(field.slug, {
					type: field.type,
					columnType: field.columnType,
				});
			}

			result.set(collection.slug, {
				slug: collection.slug,
				fields: fieldMap,
			});
		}
	} catch (error) {
		console.warn("Could not fetch schema registry:", error);
	}

	return result;
}

const BASE_REQUIRED_FIELDS: ImportFieldDef[] = [
	{ slug: "title", label: "Title", type: "string", required: true, searchable: true },
	{ slug: "content", label: "Content", type: "portableText", required: false, searchable: true },
	{ slug: "excerpt", label: "Excerpt", type: "text", required: false },
];

const FEATURED_IMAGE_FIELD: ImportFieldDef = {
	slug: "featured_image",
	label: "Featured Image",
	type: "image",
	required: false,
};

function analyzeWxr(
	wxr: WxrData,
	existingCollections: Map<string, ExistingCollection>,
): WxrAnalysis {
	const postTypeCounts = new Map<string, number>();
	const postTypesWithThumbnails = new Set<string>();
	const metaKeys = new Map<string, { count: number; samples: string[]; isInternal: boolean }>();
	const authorPostCounts = new Map<string, number>();

	for (const post of wxr.posts) {
		const type = post.postType || "post";
		postTypeCounts.set(type, (postTypeCounts.get(type) || 0) + 1);

		if (post.creator) {
			authorPostCounts.set(post.creator, (authorPostCounts.get(post.creator) || 0) + 1);
		}

		if (post.meta.has("_thumbnail_id")) {
			postTypesWithThumbnails.add(type);
		}

		for (const [key, value] of post.meta) {
			const existing = metaKeys.get(key);
			if (existing) {
				existing.count++;
				if (existing.samples.length < 3 && value) {
					existing.samples.push(value.slice(0, 100));
				}
			} else {
				metaKeys.set(key, {
					count: 1,
					samples: value ? [value.slice(0, 100)] : [],
					isInternal: isInternalMetaKey(key),
				});
			}
		}
	}

	const customFields = [...metaKeys.entries()]
		.filter(([_, info]) => !info.isInternal)
		.map(([key, info]) => ({
			key,
			count: info.count,
			samples: info.samples,
			suggestedField: mapMetaKeyToField(key),
			suggestedType: inferMetaType(key, info.samples[0]),
			isInternal: info.isInternal,
		}))
		.toSorted((a, b) => b.count - a.count);

	const seenSlugs = new Map<string, number>();
	const postTypes: PostTypeAnalysis[] = [...postTypeCounts.entries()]
		.filter(([type]) => !isInternalPostType(type))
		.map(([name, count]) => {
			let suggestedCollection = mapPostTypeToCollection(name);

			const seen = seenSlugs.get(suggestedCollection) ?? 0;
			seenSlugs.set(suggestedCollection, seen + 1);
			if (seen > 0) {
				suggestedCollection = `${suggestedCollection}_${seen}`;
			}
			const existingCollection = existingCollections.get(suggestedCollection);

			const requiredFields = [...BASE_REQUIRED_FIELDS];
			if (postTypesWithThumbnails.has(name)) {
				requiredFields.push(FEATURED_IMAGE_FIELD);
			}

			const schemaStatus = checkSchemaCompatibility(requiredFields, existingCollection);

			return {
				name,
				count,
				suggestedCollection,
				requiredFields,
				schemaStatus,
			};
		})
		.toSorted((a, b) => b.count - a.count);

	const attachmentItems: AttachmentInfo[] = wxr.attachments.map((att) => {
		const filename = att.url ? getFilenameFromUrl(att.url) : undefined;
		const mimeType = filename ? guessMimeType(filename) : undefined;
		return {
			id: att.id,
			title: att.title,
			url: att.url,
			filename,
			mimeType,
		};
	});

	return {
		site: {
			title: wxr.site.title || "WordPress Site",
			url: wxr.site.link || "",
		},
		postTypes,
		attachments: {
			count: wxr.attachments.length,
			items: attachmentItems,
		},
		categories: wxr.categories.length,
		tags: wxr.tags.length,
		authors: wxr.authors.map((a) => ({
			id: a.id,
			login: a.login,
			email: a.email,
			displayName: a.displayName || a.login || "Unknown",
			postCount: a.login ? authorPostCounts.get(a.login) || 0 : 0,
		})),
		customFields,
	};
}

function getFilenameFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const segments = parsed.pathname.split("/").filter(Boolean);
		return segments.pop();
	} catch {
		return undefined;
	}
}

function guessMimeType(filename: string): string | undefined {
	return mime.getType(filename) ?? undefined;
}

function checkSchemaCompatibility(
	requiredFields: ImportFieldDef[],
	existingCollection: ExistingCollection | undefined,
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
		: `Incompatible field types: ${incompatibleFields.join(", ")}. ` +
			`Existing fields have different types than required for import.`;

	return {
		exists: true,
		fieldStatus,
		canImport,
		reason,
	};
}

function isTypeCompatible(requiredType: string, existingType: string): boolean {
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

function isInternalPostType(type: string): boolean {
	return [
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
	].includes(type);
}

function isInternalMetaKey(key: string): boolean {
	if (key.startsWith("_edit_")) return true;
	if (key.startsWith("_wp_")) return true;
	if (key === "_edit_last" || key === "_edit_lock") return true;
	if (key === "_pingme" || key === "_encloseme") return true;

	if (key === "_thumbnail_id") return false;
	if (key.startsWith("_yoast_")) return false;
	if (key.startsWith("_rank_math_")) return false;

	if (key.startsWith("_")) return true;

	return false;
}

function sanitizeSlug(slug: string): string {
	const sanitized = slug
		.toLowerCase()
		.replace(INVALID_SLUG_CHARS, "_")
		.replace(LEADING_NON_ALPHA, "");
	if (!sanitized) return "imported";
	if (RESERVED_COLLECTION_SLUGS.includes(sanitized)) return `wp_${sanitized}`;
	return sanitized;
}

function mapPostTypeToCollection(postType: string): string {
	const mapping: Record<string, string> = {
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
	return mapping[postType] || sanitizeSlug(postType);
}

function mapMetaKeyToField(key: string): string {
	if (key === "_yoast_wpseo_title") return "seo_title";
	if (key === "_yoast_wpseo_metadesc") return "seo_description";
	if (key === "_rank_math_title") return "seo_title";
	if (key === "_rank_math_description") return "seo_description";
	if (key === "_thumbnail_id") return "featured_image";

	if (key.startsWith("_")) return key.slice(1);

	return key;
}

function inferMetaType(
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

function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

function singularize(str: string): string {
	if (str.endsWith("ies")) return str.slice(0, -3) + "y";
	if (str.endsWith("s")) return str.slice(0, -1);
	return str;
}

export { capitalize, sanitizeSlug, singularize, mapPostTypeToCollection };
