import type { ContentSeo } from "../database/repositories/types.js";
import { buildSeoImageUrl } from "./media-url.js";

export { getHreflangAlternates, getHreflangAlternatesWithDb } from "./hreflang.js";
export type { HreflangAlternate, HreflangOptions } from "./hreflang.js";

const TRAILING_SLASH_RE = /\/$/;
const ABSOLUTE_URL_RE = /^https?:\/\//i;

export interface SeoContentInput<T = Record<string, unknown>> {
	data: T & {
		title?: unknown;
		excerpt?: unknown;
		seo?: ContentSeo;
	};
	seo?: ContentSeo;
}

export interface SeoMeta {
	title: string;
	description: string | null;
	ogTitle: string;
	ogDescription: string | null;
	ogImage: string | null;
	canonical: string | null;
	robots: string | null;
}

export interface SeoMetaOptions {
	siteTitle?: string;
	siteUrl?: string;
	titleSeparator?: string;
	path?: string;
	defaultOgImage?: string;
	defaultTitle?: string;
	defaultDescription?: string;
}

export function getSeoMeta<T>(content: SeoContentInput<T>, options: SeoMetaOptions = {}): SeoMeta {
	const { siteTitle, siteUrl, path, defaultOgImage, defaultTitle, defaultDescription } = options;
	const separator = options.titleSeparator || " | ";
	const seo = content.seo ??
		content.data.seo ?? {
			title: null,
			description: null,
			image: null,
			canonical: null,
			noIndex: false,
		};

	const pageTitle =
		seo.title ||
		defaultTitle ||
		(typeof content.data.title === "string" ? content.data.title : null) ||
		"";

	const fullTitle = siteTitle && pageTitle ? `${pageTitle}${separator}${siteTitle}` : pageTitle;

	const description =
		seo.description ||
		defaultDescription ||
		(typeof content.data.excerpt === "string" ? content.data.excerpt : null) ||
		null;

	const ogImage = seo.image ? buildSeoImageUrl(seo.image, siteUrl) : (defaultOgImage ?? null);

	let canonical: string | null = null;
	if (seo.canonical) {
		if (siteUrl && !seo.canonical.startsWith("/") && !ABSOLUTE_URL_RE.test(seo.canonical)) {
			canonical = `${siteUrl.replace(TRAILING_SLASH_RE, "")}/${seo.canonical}`;
		} else {
			canonical = seo.canonical;
		}
	} else if (siteUrl && path) {
		const safePath = path.startsWith("/") ? path : `/${path}`;
		canonical = `${siteUrl.replace(TRAILING_SLASH_RE, "")}${safePath}`;
	}

	const robots = seo.noIndex ? "noindex, nofollow" : null;

	return {
		title: fullTitle,
		description,
		ogTitle: pageTitle || fullTitle,
		ogDescription: description,
		ogImage,
		canonical,
		robots,
	};
}

export function getContentSeo<T>(content: SeoContentInput<T>): ContentSeo | undefined {
	return content.seo ?? content.data.seo;
}
