import type { PublicPageContext } from "../plugins/types.js";

export function cleanJsonLd(obj: Record<string, unknown>): Record<string, unknown> {
	const cleaned: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (value !== undefined && value !== null) {
			if (typeof value === "object" && !Array.isArray(value)) {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- non-null, non-array object is safely treated as Record<string, unknown> for JSON-LD traversal
				cleaned[key] = cleanJsonLd(value as Record<string, unknown>);
			} else {
				cleaned[key] = value;
			}
		}
	}
	return cleaned;
}

export function buildBlogPostingJsonLd(
	page: PublicPageContext,
	defaultOgImage?: string | null,
): Record<string, unknown> | null {
	if (page.pageType !== "article" || !page.canonical) return null;

	const ogTitle = page.seo?.ogTitle ?? page.pageTitle ?? page.title;
	const description = page.seo?.ogDescription || page.description;
	const ogImage = page.seo?.ogImage || page.image || defaultOgImage || null;
	const publishedTime = page.articleMeta?.publishedTime;
	const modifiedTime = page.articleMeta?.modifiedTime;
	const author = page.articleMeta?.author;
	const siteName = page.siteName;

	return cleanJsonLd({
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: ogTitle,
		description,
		image: ogImage || undefined,
		url: page.canonical,
		datePublished: publishedTime || undefined,
		dateModified: modifiedTime || publishedTime || undefined,
		author: author
			? {
					"@type": "Person",
					name: author,
				}
			: undefined,
		publisher: siteName
			? {
					"@type": "Organization",
					name: siteName,
				}
			: undefined,
		mainEntityOfPage: {
			"@type": "WebPage",
			"@id": page.canonical,
		},
	});
}

export function buildWebSiteJsonLd(page: PublicPageContext): Record<string, unknown> | null {
	const siteName = page.siteName;
	if (!siteName) return null;

	let siteUrl: string;
	if (page.siteUrl) {
		siteUrl = page.siteUrl;
	} else {
		try {
			siteUrl = new URL(page.url).origin;
		} catch {
			siteUrl = page.canonical || page.url;
		}
	}

	return cleanJsonLd({
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: siteName,
		url: siteUrl,
	});
}
