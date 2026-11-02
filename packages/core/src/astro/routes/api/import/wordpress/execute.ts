import { gutenbergToPortableText } from "@emdash-cms/gutenberg-to-portable-text";
import type { APIRoute } from "astro";
import {
	parseWxrString,
	ContentRepository,
	importReusableBlocksAsSections,
	type WxrPost,
	parseWxrDate,
} from "emdash";

import { requirePerm } from "#api/authorize.js";
import { apiError, apiSuccess, handleError } from "#api/error.js";
import { BylineRepository } from "#db/repositories/byline.js";
import { resolveImportByline } from "#import/utils.js";
import {
	attachPostTaxonomies,
	isWxrTaxonomyConflictError,
	mirrorTermsToLocales,
	preImportWxrTaxonomies,
	setPostTermAssignmentsReplacing,
	type TaxonomyImportPlan,
} from "#import/wxr-taxonomies.js";
import type { EmDashHandlers, EmDashManifest } from "#types";
import { slugify } from "#utils/slugify.js";

import { sanitizeSlug } from "./analyze.js";

export const prerender = false;

export interface ImportConfig {
	postTypeMappings: Record<
		string,
		{
			collection: string;
			enabled: boolean;
		}
	>;
	skipExisting: boolean;
	importSections?: boolean;
	authorMappings?: Record<string, string | null>;
	locale?: string;
}

export interface ImportResult {
	success: boolean;
	imported: number;
	skipped: number;
	errors: Array<{ title: string; error: string }>;
	byCollection: Record<string, number>;
	sections?: {
		created: number;
		skipped: number;
	};
	taxonomies?: {
		termsCreated: Record<string, number>;
		termsReused: Record<string, number>;
		assignments: number;
		missingTaxonomies: string[];
	};
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

		const formData = await request.formData();
		const fileEntry = formData.get("file");
		const file = fileEntry instanceof File ? fileEntry : null;
		const configEntry = formData.get("config");
		const configJson = typeof configEntry === "string" ? configEntry : null;

		if (!file) {
			return apiError("VALIDATION_ERROR", "No file provided", 400);
		}

		if (!configJson) {
			return apiError("VALIDATION_ERROR", "No config provided", 400);
		}

		const config: ImportConfig = JSON.parse(configJson);

		const text = await file.text();
		const wxr = await parseWxrString(text);

		const attachmentMap = new Map<string, string>();
		for (const att of wxr.attachments) {
			if (att.id && att.url) {
				attachmentMap.set(String(att.id), att.url);
			}
		}

		const authorDisplayNames = new Map<string, string>();
		for (const author of wxr.authors) {
			if (!author.login) continue;
			authorDisplayNames.set(author.login, author.displayName || author.login);
		}

		const taxonomyPlan = await preImportWxrTaxonomies(
			emdash.db,
			wxr.posts,
			wxr.categories,
			wxr.tags,
			wxr.terms,
			config.locale,
		);

		const postLocales = new Set<string>();
		for (const post of wxr.posts) {
			if (post.locale) postLocales.add(post.locale);
		}
		if (postLocales.size > 0) {
			try {
				await mirrorTermsToLocales(emdash.db, taxonomyPlan, postLocales, config.locale);
			} catch (mirrorError) {
				if (isWxrTaxonomyConflictError(mirrorError)) {
					console.error("[WXR_IMPORT_TAXONOMY_CONFLICT]", mirrorError);
					return apiError("WXR_IMPORT_TAXONOMY_CONFLICT", mirrorError.publicMessage, 409);
				}
				throw mirrorError;
			}
		}

		const result = await importContent(
			wxr.posts,
			config,
			emdash,
			emdashManifest,
			attachmentMap,
			config.locale,
			authorDisplayNames,
			taxonomyPlan,
		);

		if (config.importSections !== false) {
			const sectionsResult = await importReusableBlocksAsSections(wxr.posts, emdash.db);
			result.sections = {
				created: sectionsResult.sectionsCreated,
				skipped: sectionsResult.sectionsSkipped,
			};
			result.errors.push(...sectionsResult.errors);
			if (sectionsResult.errors.length > 0) {
				result.success = false;
			}
		}

		return apiSuccess(result);
	} catch (error) {
		return handleError(error, "Failed to import content", "WXR_IMPORT_ERROR");
	}
};

export async function importContent(
	posts: WxrPost[],
	config: ImportConfig,
	emdash: EmDashHandlers,
	manifest: EmDashManifest,
	attachmentMap: Map<string, string>,
	locale: string | undefined,
	authorDisplayNames: Map<string, string> | undefined,
	taxonomyPlan: TaxonomyImportPlan,
): Promise<ImportResult> {
	const result: ImportResult = {
		success: true,
		imported: 0,
		skipped: 0,
		errors: [],
		byCollection: {},
		taxonomies: {
			termsCreated: taxonomyPlan.termsCreated,
			termsReused: taxonomyPlan.termsReused,
			assignments: 0,
			missingTaxonomies: taxonomyPlan.missingTaxonomies,
		},
	};

	const contentRepo = new ContentRepository(emdash.db);
	const bylineRepo = new BylineRepository(emdash.db);
	const bylineCache = new Map<string, string>();

	const translationGroupMap = new Map<string, string>();

	for (const post of posts) {
		const postType = post.postType || "post";
		const mapping = config.postTypeMappings[postType];

		if (!mapping || !mapping.enabled) {
			result.skipped++;
			continue;
		}

		const collection = sanitizeSlug(mapping.collection);

		if (!manifest?.collections[collection]) {
			result.errors.push({
				title: post.title || "Untitled",
				error: `Collection "${collection}" does not exist`,
			});
			continue;
		}

		try {
			const content = post.content ? gutenbergToPortableText(post.content) : [];

			const slug = post.postName || slugify(post.title || `post-${post.id || Date.now()}`);

			const postLocale = post.locale ?? locale;

			if (config.skipExisting) {
				const existing = await contentRepo.findBySlug(collection, slug, postLocale);
				if (existing) {
					if (post.translationGroup) {
						translationGroupMap.set(post.translationGroup, existing.id);
					}
					result.skipped++;
					continue;
				}
			}

			let translationOf: string | undefined;
			if (post.translationGroup) {
				translationOf = translationGroupMap.get(post.translationGroup);
			}

			const status = mapStatus(post.status);

			const data: Record<string, unknown> = {
				title: post.title || "Untitled",
				content,
				excerpt: post.excerpt || undefined,
			};

			const collectionSchema = manifest.collections[collection];
			const hasFeaturedImageField = collectionSchema?.fields
				? "featured_image" in collectionSchema.fields
				: false;
			if (hasFeaturedImageField) {
				const thumbnailId = post.meta.get("_thumbnail_id");
				const featuredImage = thumbnailId ? attachmentMap.get(String(thumbnailId)) : undefined;
				if (featuredImage) {
					data.featured_image = featuredImage;
				}
			}

			let authorId: string | undefined;
			if (config.authorMappings && post.creator) {
				const mappedUserId = config.authorMappings[post.creator];
				if (mappedUserId !== undefined && mappedUserId !== null) {
					authorId = mappedUserId;
				}
			}

			const bylineId = await resolveImportByline(
				post.creator,
				authorDisplayNames?.get(post.creator ?? "") ?? post.creator,
				authorId,
				bylineRepo,
				bylineCache,
			);

			const parsedDate = parseWxrDate(post.postDateGmt, post.pubDate, post.postDate);
			const createdAt = parsedDate ? parsedDate.toISOString() : undefined;
			const publishedAt = status === "published" && createdAt ? createdAt : undefined;

			const createResult = await emdash.handleContentCreate(collection, {
				data,
				slug,
				status,
				authorId,
				bylines: bylineId ? [{ bylineId }] : undefined,
				locale: postLocale,
				translationOf,
				createdAt,
				publishedAt,
			});

			if (createResult.success) {
				result.imported++;
				result.byCollection[collection] = (result.byCollection[collection] || 0) + 1;

				// eslint-disable-next-line typescript/no-unsafe-type-assertion -- handler contract documented at handleContentCreate
				const createdItem = (createResult.data as { item: { id: string } } | undefined)?.item;

				if (
					createdItem &&
					post.translationGroup &&
					!translationGroupMap.has(post.translationGroup)
				) {
					translationGroupMap.set(post.translationGroup, createdItem.id);
				}

				if (createdItem) {
					try {
						const written = translationOf
							? await setPostTermAssignmentsReplacing(
									emdash.db,
									collection,
									createdItem.id,
									post,
									taxonomyPlan,
								)
							: await attachPostTaxonomies(
									emdash.db,
									collection,
									createdItem.id,
									post,
									taxonomyPlan,
								);
						if (result.taxonomies) {
							result.taxonomies.assignments += written;
						}
					} catch (taxError) {
						console.error(
							`Failed to attach taxonomies for "${post.title || "Untitled"}":`,
							taxError,
						);
						result.errors.push({
							title: post.title || "Untitled",
							error:
								taxError instanceof Error && taxError.message
									? `Imported but failed to attach taxonomies: ${taxError.message}`
									: "Imported but failed to attach taxonomies",
						});
					}
				}
			} else {
				result.errors.push({
					title: post.title || "Untitled",
					error:
						typeof createResult.error === "object" && createResult.error !== null
							? (createResult.error as { message?: string }).message || "Unknown error"
							: String(createResult.error),
				});
			}
		} catch (error) {
			console.error(`Import error for "${post.title || "Untitled"}":`, error);
			result.errors.push({
				title: post.title || "Untitled",
				error: error instanceof Error && error.message ? error.message : "Failed to import item",
			});
		}
	}

	result.success = result.errors.length === 0;
	return result;
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
