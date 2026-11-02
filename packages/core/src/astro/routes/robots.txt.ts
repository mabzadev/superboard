import type { APIRoute } from "astro";

import { getPublicOrigin } from "#api/public-url.js";
import { getSiteSettingsWithDb } from "#settings/index.js";

export const prerender = false;

const TRAILING_SLASH_RE = /\/$/;

export const GET: APIRoute = async ({ locals, url }) => {
	const { emdash } = locals;

	if (!emdash?.db) {
		return new Response("User-agent: *\nAllow: /\n", {
			status: 200,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}

	try {
		const settings = await getSiteSettingsWithDb(emdash.db);
		const siteUrl = (settings.url || getPublicOrigin(url, emdash?.config)).replace(
			TRAILING_SLASH_RE,
			"",
		);
		const sitemapUrl = `${siteUrl}/sitemap.xml`;

		if (settings.seo?.robotsTxt) {
			let content = settings.seo.robotsTxt;
			if (!content.toLowerCase().includes("sitemap:")) {
				content = `${content.trimEnd()}\n\nSitemap: ${sitemapUrl}\n`;
			}

			return new Response(content, {
				status: 200,
				headers: {
					"Content-Type": "text/plain; charset=utf-8",
					"Cache-Control": "public, max-age=86400",
				},
			});
		}

		const defaultRobots = [
			"User-agent: *",
			"Allow: /",
			"",
			"# Disallow admin and API routes",
			"Disallow: /_emdash/",
			"",
			`Sitemap: ${sitemapUrl}`,
			"",
		].join("\n");

		return new Response(defaultRobots, {
			status: 200,
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "public, max-age=86400",
			},
		});
	} catch {
		return new Response("User-agent: *\nAllow: /\n", {
			status: 200,
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		});
	}
};
