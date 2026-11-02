import type { PageMetadataContribution, PublicPageContext } from "../plugins/types.js";
import type { SeoSettings } from "../settings/types.js";
import { buildBlogPostingJsonLd, buildWebSiteJsonLd } from "./jsonld.js";

export function generateBaseSeoContributions(
	page: PublicPageContext,
	defaultOgImage?: string | null,
): PageMetadataContribution[] {
	const contributions: PageMetadataContribution[] = [];

	const description = page.description;
	const ogTitle = page.seo?.ogTitle ?? page.pageTitle ?? page.title;
	const ogDescription = page.seo?.ogDescription || description;
	const ogImage = page.seo?.ogImage || page.image || defaultOgImage || null;
	const robots = page.seo?.robots;
	const canonical = page.canonical;
	const siteName = page.siteName;

	if (description) {
		contributions.push({ kind: "meta", name: "description", content: description });
	}

	if (robots) {
		contributions.push({ kind: "meta", name: "robots", content: robots });
	}

	if (canonical) {
		contributions.push({ kind: "link", rel: "canonical", href: canonical });
	}

	contributions.push({
		kind: "property",
		property: "og:type",
		content: page.pageType === "article" ? "article" : "website",
	});

	if (ogTitle) {
		contributions.push({ kind: "property", property: "og:title", content: ogTitle });
	}

	if (ogDescription) {
		contributions.push({ kind: "property", property: "og:description", content: ogDescription });
	}

	if (ogImage) {
		contributions.push({ kind: "property", property: "og:image", content: ogImage });
	}

	if (canonical) {
		contributions.push({ kind: "property", property: "og:url", content: canonical });
	}

	if (siteName) {
		contributions.push({ kind: "property", property: "og:site_name", content: siteName });
	}

	contributions.push({
		kind: "meta",
		name: "twitter:card",
		content: ogImage ? "summary_large_image" : "summary",
	});

	if (ogTitle) {
		contributions.push({ kind: "meta", name: "twitter:title", content: ogTitle });
	}

	if (ogDescription) {
		contributions.push({ kind: "meta", name: "twitter:description", content: ogDescription });
	}

	if (ogImage) {
		contributions.push({ kind: "meta", name: "twitter:image", content: ogImage });
	}

	if (page.pageType === "article" && page.articleMeta) {
		const { publishedTime, modifiedTime, author } = page.articleMeta;
		if (publishedTime) {
			contributions.push({
				kind: "property",
				property: "article:published_time",
				content: publishedTime,
			});
		}
		if (modifiedTime) {
			contributions.push({
				kind: "property",
				property: "article:modified_time",
				content: modifiedTime,
			});
		}
		if (author) {
			contributions.push({
				kind: "property",
				property: "article:author",
				content: author,
			});
		}
	}

	if (page.pageType === "article") {
		const blogPosting = buildBlogPostingJsonLd(page, defaultOgImage ?? null);
		if (blogPosting) {
			contributions.push({ kind: "jsonld", id: "primary", graph: blogPosting });
		}
	} else if (siteName) {
		const webSite = buildWebSiteJsonLd(page);
		if (webSite) {
			contributions.push({ kind: "jsonld", id: "primary", graph: webSite });
		}
	}

	return contributions;
}

export function generateSiteSeoContributions(
	seoSettings: SeoSettings | undefined,
): PageMetadataContribution[] {
	const contributions: PageMetadataContribution[] = [];

	if (!seoSettings) {
		return contributions;
	}

	if (seoSettings.googleVerification) {
		contributions.push({
			kind: "meta",
			name: "google-site-verification",
			content: seoSettings.googleVerification,
		});
	}

	if (seoSettings.bingVerification) {
		contributions.push({
			kind: "meta",
			name: "msvalidate.01",
			content: seoSettings.bingVerification,
		});
	}

	return contributions;
}
