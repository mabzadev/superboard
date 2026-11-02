import type { APIRoute } from "astro";
import {
	ContentRepository,
	SchemaRegistry,
	type WxrCategory,
	type WxrPost,
	type WxrTag,
	type WxrTerm,
} from "emdash";
import type { z } from "zod";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { handleTaxonomyCreate } from "#api/handlers/taxonomies.js";
import { isParseError, parseBody } from "#api/parse.js";
import { wpPluginExecuteBody } from "#api/schemas.js";
import { BylineRepository } from "#db/repositories/byline.js";
import { importCommentsFromPlugin } from "#import/comments.js";
import { getSource } from "#import/index.js";
import { importMenusFromPlugin } from "#import/menus.js";
import { importSiteSettings, parseSiteSettingsFromPlugin } from "#import/settings.js";
import {
	fetchPluginComments,
	fetchPluginCommentsPage,
	fetchPluginContentPage,
	fetchPluginMenus,
	fetchPluginOptions,
	fetchPluginTaxonomies,
} from "#import/sources/wordpress-plugin.js";
import { resolveAndValidateExternalUrl, SsrfError } from "#import/ssrf.js";
import type { ImportConfig, ImportResult, NormalizedItem } from "#import/types.js";
import { resolveImportByline, sanitizeFieldSlug } from "#import/utils.js";
import {
	attachPostTaxonomies,
	loadTaxonomyPlanFromDb,
	preImportWxrTaxonomies,
	type TaxonomyImportPlan,
} from "#import/wxr-taxonomies.js";
import type { FieldType } from "#schema/types.js";
import type { EmDashHandlers, EmDashManifest } from "#types";
import { slugify } from "#utils/slugify.js";

import { importMediaWithProgress } from "../wordpress/media.js";

export const prerender = false;

export interface WpPluginImportConfig extends ImportConfig {
	authorMappings?: Record<string, string | null>;
	importMenus?: boolean;
	importSiteTitle?: boolean;
	importLogo?: boolean;
	importSeo?: boolean;
}

export interface WpPluginImportResponse {
	success: boolean;
	result?: ImportResult;
	error?: { message: string };
}

const CONTENT_CHUNK_SIZE = 50;

interface ChunkCursor {
	postTypeIndex: number;
	page: number;
}

interface ChunkResponse {
	success: boolean;
	result: ImportResult;
	done: boolean;
	cursor?: ChunkCursor;
	chunk?: {
		idMap?: Record<string, { id: string; collection: string }>;
		translationGroups?: Record<string, string>;
		commentRoots?: Record<string, string>;
	};
}

function emptyImportResult(): ImportResult {
	return { success: true, imported: 0, skipped: 0, errors: [], byCollection: {} };
}

function parseIdMap(idMap: Record<string, { id: string; collection: string }> | undefined): {
	contentIdMap: Map<number, string>;
	collectionByWpId: Map<number, string>;
} {
	const contentIdMap = new Map<number, string>();
	const collectionByWpId = new Map<number, string>();
	for (const [key, value] of Object.entries(idMap ?? {})) {
		const wpId = Number(key);
		if (!Number.isFinite(wpId)) continue;
		contentIdMap.set(wpId, value.id);
		collectionByWpId.set(wpId, value.collection);
	}
	return { contentIdMap, collectionByWpId };
}

function serializeIdMap(
	contentIdMap: Map<number, string>,
	collectionByWpId: Map<number, string>,
): Record<string, { id: string; collection: string }> {
	const out: Record<string, { id: string; collection: string }> = {};
	for (const [wpId, id] of contentIdMap) {
		const collection = collectionByWpId.get(wpId);
		if (collection) out[String(wpId)] = { id, collection };
	}
	return out;
}

export const POST: APIRoute = async ({ request, locals }) => {
	const { emdash, user } = locals;

	const denied = requirePerm(user, "import:execute");
	if (denied) return denied;

	if (!emdash?.handleContentCreate) {
		return apiError("NOT_CONFIGURED", "EmDash not configured", 500);
	}

	try {
		const emdashManifest = await emdash.getManifest();

		const body = await parseBody(request, wpPluginExecuteBody);
		if (isParseError(body)) return body;

		try {
			await resolveAndValidateExternalUrl(body.url);
		} catch (e) {
			const msg = e instanceof SsrfError ? e.message : "Invalid URL";
			return apiError("SSRF_BLOCKED", msg, 400);
		}

		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- Zod schema output narrowed to WpPluginImportConfig
		const config = body.config as unknown as WpPluginImportConfig;

		const source = getSource("wordpress-plugin");
		if (!source) {
			return apiError("NOT_CONFIGURED", "WordPress plugin source not available", 500);
		}

		const postTypes = Object.entries(config.postTypeMappings)
			.filter(([_, mapping]) => mapping.enabled)
			.map(([postType]) => postType);

		if (postTypes.length === 0) {
			return apiError("VALIDATION_ERROR", "No post types selected for import", 400);
		}

		console.log("[WP Plugin Import] Starting import for:", body.url);
		console.log("[WP Plugin Import] Post types:", postTypes);

		if (body.phase) {
			const chunk = await runImportPhase(emdash, body, config, postTypes, emdashManifest);
			return apiSuccess(chunk);
		}

		let taxonomyPlan: TaxonomyImportPlan | undefined;
		let taxonomyDefsCreated: string[] = [];
		try {
			const built = await buildTaxonomyPlan(emdash, body.url, body.token, config);
			taxonomyPlan = built.plan;
			taxonomyDefsCreated = built.defsCreated;
		} catch (e) {
			console.warn("[WP Plugin Import] Taxonomy pre-import failed:", e);
		}

		const { result, contentIdMap, collectionByWpId } = await importContent(
			source.fetchContent(
				{ type: "url", url: body.url, token: body.token },
				{ postTypes, includeDrafts: true },
			),
			config,
			emdash,
			emdashManifest,
			taxonomyPlan,
		);

		if (config.importMenus !== false) {
			await importMenusInto(result, emdash, body.url, body.token, contentIdMap);
		}

		try {
			const comments = await fetchPluginComments(body.url, body.token);
			if (comments.length > 0) {
				const commentsResult = await importCommentsFromPlugin(
					comments,
					emdash.db,
					contentIdMap,
					collectionByWpId,
				);
				result.comments = {
					imported: commentsResult.imported,
					skipped: commentsResult.skipped,
				};
				for (const commentError of commentsResult.errors) {
					result.errors.push({
						title: `Comment: ${commentError.comment}`,
						error: commentError.error,
					});
				}
			}
		} catch (e) {
			console.warn("[WP Plugin Import] Comment import failed:", e);
		}

		try {
			result.siteSettings = await applySiteSettings(emdash, body.url, body.token, config);
		} catch (e) {
			console.warn("[WP Plugin Import] Site settings import failed:", e);
		}

		if (taxonomyDefsCreated.length > 0) {
			result.taxonomiesCreated = taxonomyDefsCreated;
		}

		console.log("[WP Plugin Import] Import result:", JSON.stringify(result, null, 2));

		return apiSuccess({
			success: true,
			result,
		});
	} catch (error) {
		return handleError(error, "Failed to import from WordPress", "WP_PLUGIN_IMPORT_ERROR");
	}
};

async function importMenusInto(
	result: ImportResult,
	emdash: EmDashHandlers,
	url: string,
	token: string,
	contentIdMap: Map<number, string>,
): Promise<void> {
	try {
		const menus = await fetchPluginMenus(url, token);
		if (menus.length > 0) {
			const menuResult = await importMenusFromPlugin(menus, emdash.db, contentIdMap);
			result.menus = {
				created: menuResult.menusCreated,
				items: menuResult.itemsCreated,
			};
			for (const menuError of menuResult.errors) {
				result.errors.push({ title: `Menu: ${menuError.menu}`, error: menuError.error });
			}
		}
	} catch (e) {
		console.warn("[WP Plugin Import] Menu import failed:", e);
	}
}

type ExecuteBody = z.infer<typeof wpPluginExecuteBody>;

async function runImportPhase(
	emdash: EmDashHandlers,
	body: ExecuteBody,
	config: WpPluginImportConfig,
	postTypes: string[],
	manifest: EmDashManifest,
): Promise<ChunkResponse> {
	switch (body.phase) {
		case "content":
			return runContentChunk(emdash, body, config, postTypes, manifest);
		case "comments":
			return runCommentsChunk(emdash, body);
		case "finalize":
			return runFinalizePhase(emdash, body, config);
		case undefined:
			throw new Error("runImportPhase called without a phase");
		default:
			body.phase satisfies never;
			throw new Error("Unknown import phase");
	}
}

async function runContentChunk(
	emdash: EmDashHandlers,
	body: ExecuteBody,
	config: WpPluginImportConfig,
	postTypes: string[],
	manifest: EmDashManifest,
): Promise<ChunkResponse> {
	const cursor = body.cursor ?? { postTypeIndex: 0, page: 1 };
	const postType = postTypes[cursor.postTypeIndex];
	if (!postType) {
		return { success: true, result: emptyImportResult(), done: true };
	}

	const isFirstChunk = cursor.postTypeIndex === 0 && cursor.page === 1;
	let taxonomyPlan: TaxonomyImportPlan | undefined;
	let taxonomyDefsCreated: string[] = [];
	try {
		if (isFirstChunk) {
			const built = await buildTaxonomyPlan(emdash, body.url, body.token, config);
			taxonomyPlan = built.plan;
			taxonomyDefsCreated = built.defsCreated;
		} else {
			taxonomyPlan = await loadTaxonomyPlanFromDb(emdash.db);
		}
	} catch (e) {
		console.warn("[WP Plugin Import] Taxonomy pre-import failed:", e);
	}

	const page = await fetchPluginContentPage({
		siteUrl: body.url,
		token: body.token,
		postType,
		page: cursor.page,
		perPage: CONTENT_CHUNK_SIZE,
		includeDrafts: true,
	});

	const translationGroupMap = new Map(Object.entries(body.translationGroups ?? {}));

	const { result, contentIdMap, collectionByWpId } = await importContent(
		page.items,
		config,
		emdash,
		manifest,
		taxonomyPlan,
		translationGroupMap,
	);

	if (taxonomyDefsCreated.length > 0) {
		result.taxonomiesCreated = taxonomyDefsCreated;
	}

	let next: ChunkCursor | undefined;
	if (cursor.page < page.totalPages) {
		next = { postTypeIndex: cursor.postTypeIndex, page: cursor.page + 1 };
	} else if (cursor.postTypeIndex + 1 < postTypes.length) {
		next = { postTypeIndex: cursor.postTypeIndex + 1, page: 1 };
	}

	return {
		success: true,
		result,
		done: next === undefined,
		cursor: next,
		chunk: {
			idMap: serializeIdMap(contentIdMap, collectionByWpId),
			translationGroups: Object.fromEntries(translationGroupMap),
		},
	};
}

async function runCommentsChunk(emdash: EmDashHandlers, body: ExecuteBody): Promise<ChunkResponse> {
	const page = body.cursor?.page ?? 1;
	const result = emptyImportResult();

	const { contentIdMap, collectionByWpId } = parseIdMap(body.idMap);
	const rootIds = new Map<number, string>();
	for (const [key, value] of Object.entries(body.commentRoots ?? {})) {
		const wpId = Number(key);
		if (Number.isFinite(wpId)) rootIds.set(wpId, value);
	}

	const { items, totalPages } = await fetchPluginCommentsPage(body.url, body.token, page);

	if (items.length > 0) {
		const commentsResult = await importCommentsFromPlugin(
			items,
			emdash.db,
			contentIdMap,
			collectionByWpId,
			rootIds,
		);
		result.comments = {
			imported: commentsResult.imported,
			skipped: commentsResult.skipped,
		};
		for (const commentError of commentsResult.errors) {
			result.errors.push({ title: `Comment: ${commentError.comment}`, error: commentError.error });
		}
		result.success = result.errors.length === 0;
	}

	const done = page >= totalPages;
	const commentRoots: Record<string, string> = {};
	for (const [wpId, id] of rootIds) commentRoots[String(wpId)] = id;

	return {
		success: true,
		result,
		done,
		cursor: done ? undefined : { postTypeIndex: 0, page: page + 1 },
		chunk: { commentRoots },
	};
}

async function runFinalizePhase(
	emdash: EmDashHandlers,
	body: ExecuteBody,
	config: WpPluginImportConfig,
): Promise<ChunkResponse> {
	const result = emptyImportResult();
	const { contentIdMap } = parseIdMap(body.idMap);

	if (config.importMenus !== false) {
		await importMenusInto(result, emdash, body.url, body.token, contentIdMap);
	}

	try {
		result.siteSettings = await applySiteSettings(emdash, body.url, body.token, config);
	} catch (e) {
		console.warn("[WP Plugin Import] Site settings import failed:", e);
	}

	result.success = result.errors.length === 0;
	return { success: true, result, done: true };
}

const IMPORT_FIELDS: Array<{
	slug: string;
	label: string;
	type: FieldType;
	check: (item: NormalizedItem) => boolean;
}> = [
	{
		slug: "title",
		label: "Title",
		type: "string",
		check: () => true,
	},
	{
		slug: "content",
		label: "Content",
		type: "portableText",
		check: () => true,
	},
	{
		slug: "excerpt",
		label: "Excerpt",
		type: "text",
		check: (item) => !!item.excerpt,
	},
	{
		slug: "featured_image",
		label: "Featured Image",
		type: "image",
		check: (item) => !!item.featuredImage,
	},
	{
		slug: "seo_title",
		label: "SEO Title",
		type: "string",
		check: (item) => !!extractSeo(item).title,
	},
	{
		slug: "seo_description",
		label: "SEO Description",
		type: "text",
		check: (item) => !!extractSeo(item).description,
	},
];

const SEO_FIELD_SLUGS = new Set(["seo_title", "seo_description"]);

export function coerceToFieldType(value: unknown, fieldType: string): unknown {
	switch (fieldType) {
		case "integer": {
			const n = typeof value === "number" ? value : Number(value);
			return Number.isInteger(n) ? n : undefined;
		}
		case "number": {
			const n = typeof value === "number" ? value : Number(value);
			return Number.isFinite(n) ? n : undefined;
		}
		case "boolean": {
			if (typeof value === "boolean") return value;
			if (value === 1 || value === "1" || value === "true" || value === "yes") return true;
			if (value === 0 || value === "0" || value === "false" || value === "no") return false;
			return undefined;
		}
		case "datetime": {
			if (typeof value !== "string" && typeof value !== "number") return undefined;
			const d = new Date(value);
			return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
		}
		case "json":
			return value;
		case "string":
		case "text":
		case "url":
		case "select":
		case "slug":
		case "reference":
			if (typeof value === "string") return value;
			if (typeof value === "number") return String(value);
			return undefined;
		default:
			return typeof value === "object" ? value : undefined;
	}
}

function pickSeoValue(blob: unknown, key: string): string | undefined {
	if (typeof blob !== "object" || blob === null) return undefined;
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to non-null object above
	const value = (blob as Record<string, unknown>)[key];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function extractSeo(item: NormalizedItem): { title?: string; description?: string } {
	const yoast = item.meta?._yoast;
	const rankmath = item.meta?._rankmath;
	return {
		title: pickSeoValue(yoast, "title") ?? pickSeoValue(rankmath, "title"),
		description: pickSeoValue(yoast, "description") ?? pickSeoValue(rankmath, "description"),
	};
}

const BUILTIN_TAXONOMIES = new Set(["category", "post_tag", "nav_menu", "post_format"]);

const TAXONOMY_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export async function ensureCustomTaxonomyDefs(
	db: EmDashHandlers["db"],
	taxonomies: Awaited<ReturnType<typeof fetchPluginTaxonomies>>,
	config: WpPluginImportConfig,
): Promise<string[]> {
	const created: string[] = [];
	for (const taxonomy of taxonomies) {
		if (BUILTIN_TAXONOMIES.has(taxonomy.name)) continue;
		if (taxonomy.terms.length === 0) continue;
		if (!TAXONOMY_NAME_PATTERN.test(taxonomy.name)) continue;

		const existing = await db
			.selectFrom("_emdash_taxonomy_defs")
			.select("id")
			.where("name", "=", taxonomy.name)
			.executeTakeFirst();
		if (existing) continue;

		const collections = (taxonomy.post_types ?? [])
			.map((postType) => config.postTypeMappings[postType])
			.filter((mapping) => mapping?.enabled)
			.map((mapping) => mapping.collection);

		const result = await handleTaxonomyCreate(db, {
			name: taxonomy.name,
			label: taxonomy.label,
			labelSingular: taxonomy.label_singular,
			hierarchical: taxonomy.hierarchical,
			collections: [...new Set(collections)],
		});
		if (result.success) {
			created.push(taxonomy.name);
		} else {
			console.warn(
				`[WP Plugin Import] Could not create taxonomy '${taxonomy.name}':`,
				result.error.message,
			);
		}
	}
	return created;
}

async function buildTaxonomyPlan(
	emdash: EmDashHandlers,
	url: string,
	token: string,
	config: WpPluginImportConfig,
): Promise<{ plan: TaxonomyImportPlan; defsCreated: string[] }> {
	const taxonomies = await fetchPluginTaxonomies(url, token);

	const defsCreated = await ensureCustomTaxonomyDefs(emdash.db, taxonomies, config);

	const categories: WxrCategory[] = [];
	const tags: WxrTag[] = [];
	const terms: WxrTerm[] = [];

	for (const taxonomy of taxonomies) {
		for (const term of taxonomy.terms) {
			if (taxonomy.name === "category") {
				categories.push({ nicename: term.slug, name: term.name, description: term.description });
			} else if (taxonomy.name === "post_tag") {
				tags.push({ slug: term.slug, name: term.name, description: term.description });
			} else if (taxonomy.name !== "nav_menu" && taxonomy.name !== "post_format") {
				terms.push({
					id: term.id,
					taxonomy: taxonomy.name,
					slug: term.slug,
					name: term.name,
					description: term.description,
				});
			}
		}
	}

	const plan = await preImportWxrTaxonomies(emdash.db, [], categories, tags, terms, undefined);
	return { plan, defsCreated };
}

async function applySiteSettings(
	emdash: EmDashHandlers,
	url: string,
	token: string,
	config: WpPluginImportConfig,
): Promise<string[]> {
	const wantTitle = config.importSiteTitle !== false;
	const wantLogo = config.importLogo !== false;
	if (!wantTitle && !wantLogo) return [];

	const options = await fetchPluginOptions(url, token);
	const parsed = parseSiteSettingsFromPlugin(options);
	if (!wantTitle) {
		delete parsed.title;
		delete parsed.tagline;
	}
	if (!wantLogo) {
		delete parsed.logo;
		delete parsed.favicon;
	}

	const media: { logoMediaId?: string; faviconMediaId?: string } = {};
	if (emdash.storage && (parsed.logo?.url || parsed.favicon?.url)) {
		const attachments = [];
		if (parsed.logo?.url) {
			attachments.push({ id: parsed.logo.id, url: parsed.logo.url });
		}
		if (parsed.favicon?.url && parsed.favicon.url !== parsed.logo?.url) {
			attachments.push({ id: parsed.favicon.id, url: parsed.favicon.url });
		}
		const mediaResult = await importMediaWithProgress(
			attachments,
			emdash.db,
			emdash.storage,
			() => {},
		);
		for (const item of mediaResult.imported) {
			if (item.originalUrl === parsed.logo?.url) {
				media.logoMediaId = item.mediaId;
			}
			if (item.originalUrl === parsed.favicon?.url) {
				media.faviconMediaId = item.mediaId;
			}
		}
	}

	const settingsResult = await importSiteSettings(parsed, emdash.db, true, media);
	for (const settingError of settingsResult.errors) {
		console.warn(
			`[WP Plugin Import] Site setting "${settingError.setting}" failed:`,
			settingError.error,
		);
	}
	return settingsResult.applied;
}

function toWxrAssignments(item: NormalizedItem): WxrPost {
	return {
		categories: item.categories ?? [],
		tags: item.tags ?? [],
		customTaxonomies: item.customTaxonomies
			? new Map(Object.entries(item.customTaxonomies))
			: undefined,
		meta: new Map(),
	};
}

export async function importContent(
	items: AsyncIterable<NormalizedItem> | Iterable<NormalizedItem>,
	config: WpPluginImportConfig,
	emdash: EmDashHandlers,
	manifest: EmDashManifest,
	taxonomyPlan: TaxonomyImportPlan | undefined,
	seedTranslationGroups?: Map<string, string>,
): Promise<{
	result: ImportResult;
	contentIdMap: Map<number, string>;
	collectionByWpId: Map<number, string>;
}> {
	const result: ImportResult = {
		success: true,
		imported: 0,
		skipped: 0,
		errors: [],
		byCollection: {},
	};

	const contentIdMap = new Map<number, string>();

	const collectionByWpId = new Map<number, string>();

	const contentRepo = new ContentRepository(emdash.db);
	const bylineRepo = new BylineRepository(emdash.db);
	const bylineCache = new Map<string, string>();
	const schemaRegistry = new SchemaRegistry(emdash.db);

	const ensuredFields = new Set<string>();

	const fieldTypesByCollection = new Map<string, Map<string, string>>();

	const translationGroupMap = seedTranslationGroups ?? new Map<string, string>();

	for await (const item of items) {
		console.log("[WP Plugin Import] Processing item:", {
			sourceId: item.sourceId,
			title: item.title,
			postType: item.postType,
			status: item.status,
			contentBlocks: Array.isArray(item.content) ? item.content.length : 0,
			featuredImage: item.featuredImage,
			locale: item.locale,
			translationGroup: item.translationGroup,
		});

		const mapping = config.postTypeMappings[item.postType];

		if (!mapping || !mapping.enabled) {
			result.skipped++;
			continue;
		}

		const collection = mapping.collection;

		if (!manifest?.collections[collection]) {
			result.errors.push({
				title: item.title || "Untitled",
				error: `Collection "${collection}" does not exist`,
			});
			continue;
		}

		try {
			for (const field of IMPORT_FIELDS) {
				if (config.importSeo === false && SEO_FIELD_SLUGS.has(field.slug)) continue;
				const ensureKey = `${collection}:${field.slug}`;
				if (ensuredFields.has(ensureKey) || !field.check(item)) continue;
				ensuredFields.add(ensureKey);
				const existingField = await schemaRegistry.getField(collection, field.slug);
				if (!existingField) {
					console.log(
						`[WP Plugin Import] Creating missing field "${field.slug}" in collection "${collection}"`,
					);
					try {
						await schemaRegistry.createField(collection, {
							slug: field.slug,
							label: field.label,
							type: field.type,
							required: false,
						});
						fieldTypesByCollection.get(collection)?.set(field.slug, field.type);
					} catch (e) {
						console.log(
							`[WP Plugin Import] Field "${field.slug}" creation skipped:`,
							e instanceof Error ? e.message : e,
						);
					}
				}
			}

			let fieldTypes = fieldTypesByCollection.get(collection);
			if (!fieldTypes) {
				fieldTypes = new Map<string, string>();
				const collectionDef = await schemaRegistry.getCollection(collection);
				if (collectionDef) {
					for (const field of await schemaRegistry.listFields(collectionDef.id)) {
						fieldTypes.set(field.slug, field.type);
					}
				}
				fieldTypesByCollection.set(collection, fieldTypes);
			}

			const slug = item.slug || slugify(item.title || `post-${item.sourceId}`);

			if (config.skipExisting) {
				const existing = await contentRepo.findBySlug(collection, slug, item.locale);
				if (existing) {
					if (item.translationGroup) {
						translationGroupMap.set(item.translationGroup, existing.id);
					}
					const wpId = Number(item.sourceId);
					if (Number.isFinite(wpId)) {
						contentIdMap.set(wpId, existing.id);
						collectionByWpId.set(wpId, collection);
					}
					result.skipped++;
					continue;
				}
			}

			const status = mapStatus(item.status);

			const data: Record<string, unknown> = {};

			data.title = item.title || "Untitled";
			data.content = item.content;

			if (item.excerpt) {
				data.excerpt = item.excerpt;
			}
			if (item.featuredImage) {
				data.featured_image = item.featuredImage;
				console.log("[WP Plugin Import] Adding featured_image:", item.featuredImage);
			}

			if (config.importSeo !== false) {
				const seo = extractSeo(item);
				if (seo.title) {
					data.seo_title = seo.title;
				}
				if (seo.description) {
					data.seo_description = seo.description;
				}
			}

			const assignMetaValue = (key: string, value: unknown) => {
				if (value === null || value === "") return;
				const fieldSlug = sanitizeFieldSlug(key);
				const fieldType = fieldTypes.get(fieldSlug);
				if (!fieldType || fieldSlug in data) return;
				const coerced = coerceToFieldType(value, fieldType);
				if (coerced !== undefined) {
					data[fieldSlug] = coerced;
				}
			};
			const acf = item.meta?._acf;
			if (typeof acf === "object" && acf !== null) {
				for (const [key, value] of Object.entries(acf)) {
					assignMetaValue(key, value);
				}
			}
			if (item.meta) {
				for (const [key, value] of Object.entries(item.meta)) {
					if (key.startsWith("_")) continue;
					assignMetaValue(key, value);
				}
			}

			let authorId: string | undefined;
			if (config.authorMappings && item.author) {
				const mappedUserId = config.authorMappings[item.author];
				if (mappedUserId !== undefined && mappedUserId !== null) {
					authorId = mappedUserId;
				}
			}

			const bylineId = await resolveImportByline(
				item.author,
				item.author,
				authorId,
				bylineRepo,
				bylineCache,
			);

			let translationOf: string | undefined;
			if (item.translationGroup) {
				const existingGroupItem = translationGroupMap.get(item.translationGroup);
				if (existingGroupItem) {
					translationOf = existingGroupItem;
				}
			}

			const itemDateTime = item.date?.getTime();
			const createdAt =
				itemDateTime !== undefined && !Number.isNaN(itemDateTime)
					? item.date.toISOString()
					: undefined;
			const publishedAt = status === "published" && createdAt ? createdAt : undefined;

			const createResult = await emdash.handleContentCreate(collection, {
				data,
				slug,
				status,
				authorId,
				bylines: bylineId ? [{ bylineId }] : undefined,
				locale: item.locale,
				translationOf,
				createdAt,
				publishedAt,
			});

			if (createResult.success) {
				result.imported++;
				result.byCollection[collection] = (result.byCollection[collection] || 0) + 1;

				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- create handler returns { item, _rev }
				const createdData = createResult.data as { item?: { id?: string } } | undefined;
				const createdId = createdData?.item?.id;

				if (createdId) {
					const wpId = Number(item.sourceId);
					if (Number.isFinite(wpId)) {
						contentIdMap.set(wpId, createdId);
						collectionByWpId.set(wpId, collection);
					}

					if (taxonomyPlan) {
						try {
							const attached = await attachPostTaxonomies(
								emdash.db,
								collection,
								createdId,
								toWxrAssignments(item),
								taxonomyPlan,
							);
							if (attached > 0) {
								result.taxonomyAssignments = (result.taxonomyAssignments ?? 0) + attached;
							}
						} catch (e) {
							console.warn(`[WP Plugin Import] Taxonomy attach failed for "${slug}":`, e);
						}
					}
				}

				if (item.translationGroup && !translationGroupMap.has(item.translationGroup) && createdId) {
					translationGroupMap.set(item.translationGroup, createdId);
				}
			} else {
				result.errors.push({
					title: item.title || "Untitled",
					error:
						typeof createResult.error === "object" && createResult.error !== null
							? (createResult.error as { message?: string }).message || "Unknown error"
							: String(createResult.error),
				});
			}
		} catch (error) {
			console.error(`Import error for "${item.title || "Untitled"}":`, error);
			result.errors.push({
				title: item.title || "Untitled",
				error: error instanceof Error && error.message ? error.message : "Failed to import item",
			});
		}
	}

	if (taxonomyPlan && taxonomyPlan.missingTaxonomies.length > 0) {
		result.missingTaxonomies = taxonomyPlan.missingTaxonomies;
	}

	result.success = result.errors.length === 0;
	return { result, contentIdMap, collectionByWpId };
}

function mapStatus(wpStatus: string | undefined): string {
	switch (wpStatus) {
		case "publish":
			return "published";
		case "draft":
			return "draft";
		case "pending":
			return "draft";
		case "private":
			return "draft";
		default:
			return "draft";
	}
}
