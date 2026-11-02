import type { BreadcrumbItem, PublicPageContext } from "../plugins/types.js";

interface PageContextFields {
	kind: "content" | "custom";
	pageType?: string;
	title?: string | null;
	pageTitle?: string | null;
	description?: string | null;
	canonical?: string | null;
	image?: string | null;
	content?: { collection: string; id: string; slug?: string | null };
	seo?: {
		ogTitle?: string | null;
		ogDescription?: string | null;
		ogImage?: string | null;
		robots?: string | null;
	};
	articleMeta?: {
		publishedTime?: string | null;
		modifiedTime?: string | null;
		author?: string | null;
	};
	siteName?: string;
	breadcrumbs?: BreadcrumbItem[];
	siteUrl?: string;
}

interface AstroInput extends PageContextFields {
	Astro: { url: URL; currentLocale?: string };
}

interface UrlInput extends PageContextFields {
	url: URL | string;
	locale?: string;
}

export type CreatePublicPageContextInput = AstroInput | UrlInput;

function isAstroInput(input: CreatePublicPageContextInput): input is AstroInput {
	return "Astro" in input;
}

export function createPublicPageContext(input: CreatePublicPageContextInput): PublicPageContext {
	let url: string;
	let path: string;
	let locale: string | null;

	if (isAstroInput(input)) {
		url = input.Astro.url.href;
		path = input.Astro.url.pathname;
		locale = input.Astro.currentLocale ?? null;
	} else {
		const parsed = typeof input.url === "string" ? new URL(input.url) : input.url;
		url = parsed.href;
		path = parsed.pathname;
		locale = input.locale ?? null;
	}

	return {
		url,
		path,
		locale,
		kind: input.kind,
		pageType: input.pageType ?? (input.kind === "content" ? "article" : "website"),
		title: input.title ?? null,
		pageTitle: input.pageTitle ?? null,
		description: input.description ?? null,
		canonical: input.canonical ?? null,
		image: input.image ?? null,
		content: input.content
			? {
					collection: input.content.collection,
					id: input.content.id,
					slug: input.content.slug ?? null,
				}
			: undefined,
		seo: input.seo,
		articleMeta: input.articleMeta,
		siteName: input.siteName,
		breadcrumbs: input.breadcrumbs,
		siteUrl: input.siteUrl,
	};
}
