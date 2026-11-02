import { gutenbergToPortableText } from "@emdash-cms/gutenberg-to-portable-text";

import { encodeBase64 } from "../../utils/base64.js";
import type { PluginComment } from "../comments.js";
import type { PluginMenu } from "../menus.js";
import { ssrfSafeFetch, validateExternalUrl } from "../ssrf.js";
import type {
	ImportSource,
	ImportAnalysis,
	ImportContext,
	SourceInput,
	SourceProbeResult,
	I18nDetection,
	FetchOptions,
	NormalizedItem,
	PostTypeAnalysis,
	AttachmentInfo,
} from "../types.js";
import {
	BASE_REQUIRED_FIELDS,
	FEATURED_IMAGE_FIELD,
	mapPostTypeToCollection,
	mapWpStatus,
	normalizeUrl,
	checkSchemaCompatibility,
	isPluginBookkeepingMeta,
	relativizeContentLinks,
	sanitizeFieldSlug,
} from "../utils.js";

interface PluginI18nInfo {
	plugin: "wpml" | "polylang";
	default_locale: string;
	locales: string[];
}

interface PluginProbeResponse {
	emdash_exporter: string;
	wordpress_version: string;
	site: {
		title: string;
		description: string;
		url: string;
		home: string;
		language: string;
		timezone: string;
	};
	capabilities: {
		application_passwords: boolean;
		acf: boolean;
		yoast: boolean;
		rankmath: boolean;
	};
	post_types: Array<{
		name: string;
		label: string;
		count: number;
	}>;
	media_count: number;
	endpoints: Record<string, string>;
	auth_instructions: {
		method: string;
		instructions: string;
		url?: string;
	};
	i18n?: PluginI18nInfo;
}

interface PluginAnalyzeResponse {
	site: {
		title: string;
		url: string;
	};
	post_types: Array<{
		name: string;
		label: string;
		label_singular: string;
		total: number;
		by_status: Record<string, number>;
		supports: Record<string, unknown>;
		taxonomies: string[];
		custom_fields: Array<{
			key: string;
			count: number;
			inferred_type: string;
			sample: string | null;
		}>;
		hierarchical: boolean;
		has_archive: boolean;
	}>;
	taxonomies: Array<{
		name: string;
		label: string;
		hierarchical: boolean;
		term_count: number;
		object_types: string[];
	}>;
	authors: Array<{
		id: number;
		login: string;
		email: string;
		display_name: string;
		post_count: number;
	}>;
	attachments: {
		count: number;
		by_type: Record<string, number>;
	};
	acf?: Array<{
		key: string;
		title: string;
		fields: Array<{
			key: string;
			name: string;
			label: string;
			type: string;
			required: boolean;
		}>;
	}>;
	i18n?: PluginI18nInfo;
}

interface PluginContentResponse {
	items: PluginPost[];
	total: number;
	pages: number;
	page: number;
	per_page: number;
}

interface PluginPost {
	id: number;
	post_type: string;
	status: string;
	slug: string;
	title: string;
	content: string;
	excerpt: string;
	date: string;
	date_gmt: string;
	modified: string;
	modified_gmt: string;
	author: {
		id: number;
		login: string;
		email: string;
		display_name: string;
	} | null;
	parent: number | null;
	menu_order: number;
	taxonomies: Record<string, Array<{ id: number; name: string; slug: string }>>;
	featured_image?: {
		id: number;
		url: string;
		filename: string;
		mime_type: string;
		alt: string;
		title: string;
		caption: string;
		width: number | null;
		height: number | null;
	};
	meta: Record<string, unknown>;
	acf?: Record<string, unknown>;
	yoast?: Record<string, string>;
	rankmath?: Record<string, string>;
	locale?: string;
	translation_group?: string;
}

interface PluginMediaResponse {
	items: PluginMediaItem[];
	total: number;
	pages: number;
	page: number;
	per_page: number;
}

interface PluginMediaItem {
	id: number;
	url: string;
	filename: string;
	mime_type: string;
	title: string;
	alt: string;
	caption: string;
	description: string;
	width?: number;
	height?: number;
	filesize?: number;
}

const SPACE_PATTERN = /\s/g;

function pluginApiUrl(
	siteUrl: string,
	path: string,
	params: Record<string, string> = {},
	restRoute = false,
): string {
	if (restRoute) {
		const url = new URL(siteUrl + "/");
		url.searchParams.set("rest_route", `/emdash/v1/${path}`);
		for (const [key, value] of Object.entries(params)) {
			url.searchParams.set(key, value);
		}
		return url.toString();
	}
	const url = new URL(`${siteUrl}/wp-json/emdash/v1/${path}`);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, value);
	}
	return url.toString();
}

async function fetchPluginApi(
	siteUrl: string,
	path: string,
	params: Record<string, string>,
	headers: HeadersInit,
	timeoutMs: number,
): Promise<Response> {
	let pretty: Response | null = null;
	try {
		pretty = await ssrfSafeFetch(pluginApiUrl(siteUrl, path, params), {
			headers,
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch {}
	if (pretty && pretty.status !== 404) {
		return pretty;
	}
	return ssrfSafeFetch(pluginApiUrl(siteUrl, path, params, true), {
		headers,
		signal: AbortSignal.timeout(timeoutMs),
	});
}

export const wordpressPluginSource: ImportSource = {
	id: "wordpress-plugin",
	name: "WordPress (EmDash Exporter)",
	description: "Import from WordPress sites with the EmDash Exporter plugin installed",
	icon: "plug",
	requiresFile: false,
	canProbe: true,

	async probe(url: string): Promise<SourceProbeResult | null> {
		try {
			const siteUrl = normalizeUrl(url);

			validateExternalUrl(siteUrl);

			const response = await fetchPluginApi(
				siteUrl,
				"probe",
				{},
				{ Accept: "application/json" },
				10000,
			);

			if (!response.ok) {
				return null;
			}

			const data: PluginProbeResponse = await response.json();

			if (!data.emdash_exporter) {
				return null;
			}

			return {
				sourceId: "wordpress-plugin",
				confidence: "definite",
				detected: {
					platform: "wordpress",
					version: data.wordpress_version,
					siteTitle: data.site.title,
					siteUrl: data.site.url,
				},
				capabilities: {
					publicContent: true,
					privateContent: true,
					customPostTypes: true,
					allMeta: true,
					mediaStream: true,
				},
				auth: data.capabilities.application_passwords
					? {
							type: "password",
							instructions: data.auth_instructions.instructions,
						}
					: undefined,
				preview: {
					posts: data.post_types.find((p) => p.name === "post")?.count,
					pages: data.post_types.find((p) => p.name === "page")?.count,
					media: data.media_count,
				},
				suggestedAction: {
					type: "proceed",
				},
				i18n: pluginI18nToDetection(data.i18n),
			};
		} catch {
			return null;
		}
	},

	async analyze(input: SourceInput, context: ImportContext): Promise<ImportAnalysis> {
		const { siteUrl, headers } = getRequestConfig(input);

		const response = await fetchPluginApi(siteUrl, "analyze", {}, headers, 30000);

		if (!response.ok) {
			const body: unknown = await response.json().catch(() => undefined);
			const message =
				typeof body === "object" &&
				body !== null &&
				"message" in body &&
				typeof body.message === "string"
					? body.message
					: "";
			throw new Error(message || `Failed to analyze site: ${response.statusText}`);
		}

		const data: PluginAnalyzeResponse = await response.json();

		const existingCollections = context.getExistingCollections
			? await context.getExistingCollections()
			: new Map();

		const postTypes: PostTypeAnalysis[] = data.post_types
			.filter((pt) => pt.total > 0)
			.map((pt) => {
				const suggestedCollection = mapPostTypeToCollection(pt.name);
				const existingCollection = existingCollections.get(suggestedCollection);

				const supportsThumbnail = pt.supports && "thumbnail" in pt.supports;
				const requiredFields = supportsThumbnail
					? [...BASE_REQUIRED_FIELDS, FEATURED_IMAGE_FIELD]
					: [...BASE_REQUIRED_FIELDS];

				const knownSlugs = new Set(requiredFields.map((f) => f.slug));
				for (const customField of pt.custom_fields ?? []) {
					if (isPluginBookkeepingMeta(customField.key)) continue;
					const slug = sanitizeFieldSlug(customField.key);
					if (knownSlugs.has(slug)) continue;
					knownSlugs.add(slug);
					requiredFields.push({
						slug,
						label: fieldLabelFromKey(customField.key),
						type: mapInferredFieldType(customField.inferred_type),
						required: false,
					});
				}

				return {
					name: pt.name,
					count: pt.total,
					suggestedCollection,
					requiredFields,
					schemaStatus: checkSchemaCompatibility(requiredFields, existingCollection),
				};
			});

		const attachments: AttachmentInfo[] = [];
		if (data.attachments.count > 0) {
			try {
				let page = 1;
				let totalPages = 1;
				while (page <= totalPages) {
					const mediaResponse = await fetchPluginApi(
						siteUrl,
						"media",
						{ per_page: "500", page: String(page) },
						headers,
						30000,
					);
					if (!mediaResponse.ok) break;
					const mediaData: PluginMediaResponse = await mediaResponse.json();
					totalPages = mediaData.pages;
					for (const item of mediaData.items) {
						attachments.push({
							id: item.id,
							url: item.url,
							filename: item.filename,
							mimeType: item.mime_type,
							title: item.title,
							alt: item.alt,
							caption: item.caption,
							width: item.width,
							height: item.height,
						});
					}
					page++;
				}
			} catch (e) {
				console.warn("Failed to fetch media list:", e);
			}
		}

		const categoryTaxonomy = data.taxonomies.find((t) => t.name === "category");
		const tagTaxonomy = data.taxonomies.find((t) => t.name === "post_tag");

		return {
			sourceId: "wordpress-plugin",
			site: {
				title: data.site.title,
				url: data.site.url,
			},
			postTypes,
			attachments: {
				count: data.attachments.count,
				items: attachments,
			},
			categories: categoryTaxonomy?.term_count ?? 0,
			tags: tagTaxonomy?.term_count ?? 0,
			authors: data.authors.map((a) => ({
				id: a.id,
				login: a.login,
				email: a.email,
				displayName: a.display_name,
				postCount: a.post_count,
			})),
			i18n: pluginI18nToDetection(data.i18n),
		};
	},

	async *fetchContent(input: SourceInput, options: FetchOptions): AsyncGenerator<NormalizedItem> {
		const { siteUrl, headers } = getRequestConfig(input);

		for (const postType of options.postTypes) {
			let page = 1;
			let totalPages = 1;
			let yielded = 0;

			while (page <= totalPages) {
				const status = options.includeDrafts ? "any" : "publish";
				const response = await fetchPluginApi(
					siteUrl,
					"content",
					{ post_type: postType, status, per_page: "100", page: String(page) },
					headers,
					60000,
				);

				if (!response.ok) {
					throw new Error(`Failed to fetch ${postType}: ${response.statusText}`);
				}

				const data: PluginContentResponse = await response.json();
				totalPages = data.pages;

				for (const post of data.items) {
					yield pluginPostToNormalizedItem(post, siteUrl);
					yielded++;

					if (options.limit && yielded >= options.limit) {
						return;
					}
				}

				page++;
			}
		}
	},

	async fetchMedia(url: string, _input: SourceInput): Promise<Blob> {
		validateExternalUrl(url);

		const response = await ssrfSafeFetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch media: ${response.statusText}`);
		}
		return response.blob();
	},
};

export async function fetchPluginContentPage(options: {
	siteUrl: string;
	token: string;
	postType: string;
	page: number;
	perPage: number;
	includeDrafts: boolean;
}): Promise<{ items: NormalizedItem[]; totalPages: number }> {
	const { siteUrl, headers } = getRequestConfig({
		type: "url",
		url: options.siteUrl,
		token: options.token,
	});

	const response = await fetchPluginApi(
		siteUrl,
		"content",
		{
			post_type: options.postType,
			status: options.includeDrafts ? "any" : "publish",
			per_page: String(options.perPage),
			page: String(options.page),
		},
		headers,
		60000,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch ${options.postType}: ${response.statusText}`);
	}

	const data: PluginContentResponse = await response.json();
	return {
		items: data.items.map((post) => pluginPostToNormalizedItem(post, siteUrl)),
		totalPages: data.pages,
	};
}

const VALID_INFERRED_TYPES = new Set([
	"string",
	"text",
	"number",
	"integer",
	"boolean",
	"datetime",
	"json",
	"reference",
]);

function mapInferredFieldType(inferredType: string): string {
	return VALID_INFERRED_TYPES.has(inferredType) ? inferredType : "string";
}

const FIELD_KEY_SEPARATORS = /[_-]+/;

function fieldLabelFromKey(key: string): string {
	return key
		.split(FIELD_KEY_SEPARATORS)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function pluginI18nToDetection(i18n: PluginI18nInfo | undefined): I18nDetection | undefined {
	if (!i18n) return undefined;
	return {
		plugin: i18n.plugin,
		defaultLocale: i18n.default_locale,
		locales: i18n.locales,
	};
}

function getRequestConfig(input: SourceInput): {
	siteUrl: string;
	headers: HeadersInit;
} {
	if (input.type === "url") {
		const siteUrl = normalizeUrl(input.url);

		validateExternalUrl(siteUrl);
		const headers: HeadersInit = {
			Accept: "application/json",
		};

		if (input.token) {
			headers["Authorization"] = `Basic ${input.token}`;
		}

		return { siteUrl, headers };
	}

	if (input.type === "oauth") {
		const oauthSiteUrl = normalizeUrl(input.url);

		validateExternalUrl(oauthSiteUrl);

		return {
			siteUrl: oauthSiteUrl,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${input.accessToken}`,
			},
		};
	}

	throw new Error("WordPress plugin source requires URL or OAuth input");
}

function pluginPostToNormalizedItem(post: PluginPost, siteUrl: string): NormalizedItem {
	const content = post.content ? gutenbergToPortableText(post.content) : [];
	relativizeContentLinks(content, siteUrl);

	const categories =
		post.taxonomies?.category?.map((c) => c.slug) ??
		post.taxonomies?.categories?.map((c) => c.slug) ??
		[];
	const tags =
		post.taxonomies?.post_tag?.map((t) => t.slug) ??
		post.taxonomies?.tags?.map((t) => t.slug) ??
		[];

	const customTaxonomies: Record<string, string[]> = {};
	for (const [name, terms] of Object.entries(post.taxonomies ?? {})) {
		if (["category", "categories", "post_tag", "tags"].includes(name)) continue;
		if (Array.isArray(terms) && terms.length > 0) {
			customTaxonomies[name] = terms.map((t) => t.slug);
		}
	}

	const meta: Record<string, unknown> = { ...post.meta };

	if (post.acf) {
		meta._acf = post.acf;
	}

	if (post.yoast) {
		meta._yoast = post.yoast;
	}
	if (post.rankmath) {
		meta._rankmath = post.rankmath;
	}

	return {
		sourceId: post.id,
		postType: post.post_type,
		status: mapWpStatus(post.status),
		slug: post.slug,
		title: post.title,
		content,
		excerpt: post.excerpt || undefined,
		date: new Date(post.date_gmt || post.date),
		modified: post.modified_gmt ? new Date(post.modified_gmt) : new Date(post.modified),
		author: post.author?.login,
		categories,
		tags,
		customTaxonomies: Object.keys(customTaxonomies).length > 0 ? customTaxonomies : undefined,
		meta,
		featuredImage: post.featured_image?.url,
		locale: post.locale,
		translationGroup: post.translation_group,
	};
}

export function createBasicAuthToken(username: string, password: string): string {
	const cleanPassword = password.replace(SPACE_PATTERN, "");
	return encodeBase64(`${username}:${cleanPassword}`);
}

export async function fetchPluginMedia(
	siteUrl: string,
	authToken: string,
	page = 1,
	perPage = 100,
): Promise<PluginMediaResponse> {
	const normalizedSiteUrl = normalizeUrl(siteUrl);

	validateExternalUrl(normalizedSiteUrl);

	const response = await fetchPluginApi(
		normalizedSiteUrl,
		"media",
		{ per_page: String(perPage), page: String(page) },
		{ Accept: "application/json", Authorization: `Basic ${authToken}` },
		30000,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch media: ${response.statusText}`);
	}

	return response.json();
}

export async function fetchPluginTaxonomies(
	siteUrl: string,
	authToken: string,
): Promise<
	Array<{
		name: string;
		label: string;
		label_singular?: string;
		hierarchical: boolean;
		post_types?: string[];
		terms: Array<{
			id: number;
			name: string;
			slug: string;
			description: string;
			parent: number | null;
			count: number;
		}>;
	}>
> {
	const normalizedSiteUrl = normalizeUrl(siteUrl);

	validateExternalUrl(normalizedSiteUrl);

	const response = await fetchPluginApi(
		normalizedSiteUrl,
		"taxonomies",
		{},
		{ Accept: "application/json", Authorization: `Basic ${authToken}` },
		30000,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch taxonomies: ${response.statusText}`);
	}

	return response.json();
}

export async function fetchPluginMenus(siteUrl: string, authToken: string): Promise<PluginMenu[]> {
	const normalizedSiteUrl = normalizeUrl(siteUrl);

	validateExternalUrl(normalizedSiteUrl);

	const response = await fetchPluginApi(
		normalizedSiteUrl,
		"menus",
		{},
		{ Accept: "application/json", Authorization: `Basic ${authToken}` },
		30000,
	);

	if (response.status === 404) {
		return [];
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch menus: ${response.statusText}`);
	}

	return response.json();
}

export async function fetchPluginOptions(
	siteUrl: string,
	authToken: string,
): Promise<Record<string, unknown>> {
	const normalizedSiteUrl = normalizeUrl(siteUrl);

	validateExternalUrl(normalizedSiteUrl);

	const response = await fetchPluginApi(
		normalizedSiteUrl,
		"options",
		{},
		{ Accept: "application/json", Authorization: `Basic ${authToken}` },
		30000,
	);

	if (!response.ok) {
		throw new Error(`Failed to fetch options: ${response.statusText}`);
	}

	return response.json();
}

interface PluginCommentsResponse {
	items: PluginComment[];
	total: number;
	pages: number;
	page: number;
	per_page: number;
}

export async function fetchPluginCommentsPage(
	siteUrl: string,
	authToken: string,
	page: number,
): Promise<{ items: PluginComment[]; totalPages: number }> {
	const normalizedSiteUrl = normalizeUrl(siteUrl);

	validateExternalUrl(normalizedSiteUrl);

	const response = await fetchPluginApi(
		normalizedSiteUrl,
		"comments",
		{ per_page: "500", page: String(page) },
		{ Accept: "application/json", Authorization: `Basic ${authToken}` },
		30000,
	);

	if (response.status === 404) {
		return { items: [], totalPages: 0 };
	}
	if (!response.ok) {
		throw new Error(`Failed to fetch comments: ${response.statusText}`);
	}

	const data: PluginCommentsResponse = await response.json();
	return { items: data.items, totalPages: data.pages };
}

export async function fetchPluginComments(
	siteUrl: string,
	authToken: string,
): Promise<PluginComment[]> {
	const comments: PluginComment[] = [];
	let page = 1;
	let totalPages = 1;

	while (page <= totalPages) {
		const result = await fetchPluginCommentsPage(siteUrl, authToken, page);
		totalPages = result.totalPages;
		comments.push(...result.items);
		page++;
	}

	return comments;
}
