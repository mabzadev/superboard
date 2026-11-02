import { gutenbergToPortableText } from "@emdash-cms/gutenberg-to-portable-text";

import { parseWxrString, type WxrData, type WxrPost } from "../../cli/wxr/parser.js";
import type {
	ImportSource,
	ImportAnalysis,
	ImportContext,
	SourceInput,
	FetchOptions,
	NormalizedItem,
	PostTypeAnalysis,
	AttachmentInfo,
	NavMenuAnalysis,
	TaxonomyAnalysis,
	ReusableBlockAnalysis,
} from "../types.js";
import {
	BASE_REQUIRED_FIELDS,
	FEATURED_IMAGE_FIELD,
	isInternalPostType,
	isInternalMetaKey,
	mapWpStatus,
	mapPostTypeToCollection,
	mapMetaKeyToField,
	inferMetaType,
	slugify,
	buildAttachmentMap,
	getFilenameFromUrl,
	guessMimeType,
	checkSchemaCompatibility,
	relativizeContentLinks,
} from "../utils.js";

export const wxrSource: ImportSource = {
	id: "wxr",
	name: "WordPress Export File",
	description: "Upload a WordPress export file (.xml)",
	icon: "upload",
	requiresFile: true,
	canProbe: false,

	async analyze(input: SourceInput, context: ImportContext): Promise<ImportAnalysis> {
		if (input.type !== "file") {
			throw new Error("WXR source requires a file input");
		}

		const text = await input.file.text();
		const wxr = await parseWxrString(text);

		const existingCollections = context.getExistingCollections
			? await context.getExistingCollections()
			: new Map();

		return analyzeWxrData(wxr, existingCollections);
	},

	async *fetchContent(input: SourceInput, options: FetchOptions): AsyncGenerator<NormalizedItem> {
		if (input.type !== "file") {
			throw new Error("WXR source requires a file input");
		}

		const text = await input.file.text();
		const wxr = await parseWxrString(text);

		const attachmentMap = buildAttachmentMap(wxr.attachments);

		let count = 0;
		for (const post of wxr.posts) {
			const postType = post.postType || "post";

			if (!options.postTypes.includes(postType)) {
				continue;
			}

			if (isInternalPostType(postType)) {
				continue;
			}

			if (!options.includeDrafts && post.status !== "publish") {
				continue;
			}

			yield wxrPostToNormalizedItem(post, attachmentMap, wxr.site.link || "");

			count++;
			if (options.limit && count >= options.limit) {
				break;
			}
		}
	},
};

function analyzeWxrData(
	wxr: WxrData,
	existingCollections: Map<string, { slug: string; fields: Map<string, { type: string }> }>,
): ImportAnalysis {
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

	const postTypes: PostTypeAnalysis[] = [...postTypeCounts.entries()]
		.filter(([type]) => !isInternalPostType(type))
		.map(([name, count]) => {
			const suggestedCollection = mapPostTypeToCollection(name);
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

	const navMenus: NavMenuAnalysis[] = wxr.navMenus.map((menu) => ({
		name: menu.name,
		label: menu.label,
		itemCount: menu.items.length,
	}));

	const taxonomyMap = new Map<string, { count: number; samples: string[] }>();
	for (const term of wxr.terms) {
		if (
			term.taxonomy === "category" ||
			term.taxonomy === "post_tag" ||
			term.taxonomy === "nav_menu"
		) {
			continue;
		}

		const existing = taxonomyMap.get(term.taxonomy);
		if (existing) {
			existing.count++;
			if (existing.samples.length < 3) {
				existing.samples.push(term.name);
			}
		} else {
			taxonomyMap.set(term.taxonomy, {
				count: 1,
				samples: [term.name],
			});
		}
	}

	const customTaxonomies: TaxonomyAnalysis[] = Array.from(
		taxonomyMap.entries(),
		([slug, info]) => ({
			slug,
			termCount: info.count,
			sampleTerms: info.samples,
		}),
	).toSorted((a, b) => b.termCount - a.termCount);

	const reusableBlocks: ReusableBlockAnalysis[] = wxr.posts
		.filter((post) => post.postType === "wp_block")
		.map((post) => ({
			id: post.id || 0,
			title: post.title || "Untitled Block",
			slug: post.postName || slugify(post.title || `block-${post.id || Date.now()}`),
		}));

	return {
		sourceId: "wxr",
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
		navMenus: navMenus.length > 0 ? navMenus : undefined,
		customTaxonomies: customTaxonomies.length > 0 ? customTaxonomies : undefined,
		reusableBlocks: reusableBlocks.length > 0 ? reusableBlocks : undefined,
		customFields,
	};
}

function wxrPostToNormalizedItem(
	post: WxrPost,
	attachmentMap: Map<string, string>,
	siteUrl: string,
): NormalizedItem {
	const content = post.content ? gutenbergToPortableText(post.content) : [];
	if (siteUrl) relativizeContentLinks(content, siteUrl);

	const thumbnailId = post.meta.get("_thumbnail_id");
	const featuredImage = thumbnailId ? attachmentMap.get(String(thumbnailId)) : undefined;

	let customTaxonomies: Record<string, string[]> | undefined;
	if (post.customTaxonomies && post.customTaxonomies.size > 0) {
		const filtered = Object.fromEntries(
			[...post.customTaxonomies].filter(([taxonomy]) => taxonomy !== "language"),
		);
		if (Object.keys(filtered).length > 0) {
			customTaxonomies = filtered;
		}
	}

	return {
		sourceId: post.id || 0,
		postType: post.postType || "post",
		status: mapWpStatus(post.status),
		slug: post.postName || slugify(post.title || `post-${post.id || Date.now()}`),
		title: post.title || "Untitled",
		content,
		excerpt: post.excerpt,
		date: parseWxrDate(post.postDateGmt, post.pubDate, post.postDate) ?? new Date(),
		modified: parseWxrDate(post.postModifiedGmt, undefined, post.postModified),
		author: post.creator,
		categories: post.categories,
		tags: post.tags,
		meta: Object.fromEntries(post.meta),
		featuredImage,
		parentId: post.postParent && post.postParent !== 0 ? post.postParent : undefined,
		menuOrder: post.menuOrder,
		customTaxonomies,
		locale: post.locale,
		translationGroup: post.translationGroup,
	};
}

export const WXR_ZERO_DATE = "0000-00-00 00:00:00";

export function parseWxrDate(
	gmtDate: string | undefined,
	pubDate: string | undefined,
	localDate: string | undefined,
): Date | undefined {
	if (gmtDate && gmtDate !== WXR_ZERO_DATE) {
		return new Date(gmtDate.replace(" ", "T") + "Z");
	}

	if (pubDate) {
		const d = new Date(pubDate);
		if (!isNaN(d.getTime())) return d;
	}

	if (localDate) {
		const d = new Date(localDate.replace(" ", "T"));
		if (!isNaN(d.getTime())) return d;
	}

	return undefined;
}

export { analyzeWxrData, wxrPostToNormalizedItem };

export {
	BASE_REQUIRED_FIELDS,
	FEATURED_IMAGE_FIELD,
	mapPostTypeToCollection,
	isInternalPostType,
	checkSchemaCompatibility,
} from "../utils.js";
