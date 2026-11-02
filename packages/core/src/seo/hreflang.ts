import type { Kysely } from "kysely";

import { ContentRepository } from "../database/repositories/content.js";
import type { Database } from "../database/types.js";
import { getI18nConfig, isI18nEnabled } from "../i18n/config.js";
import { interpolateUrlPattern, localizePath } from "../i18n/resolve.js";
import { requestCached } from "../request-cache.js";
import { getCollectionInfoWithDb } from "../schema/query.js";
import { getSiteSettingsWithDb } from "../settings/index.js";

const TRAILING_SLASH_RE = /\/$/;
const ABSOLUTE_URL_RE = /^https?:\/\//i;

async function findNoindexIds(
	db: Kysely<Database>,
	collection: string,
	ids: string[],
): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const rows = await db
		.selectFrom("_emdash_seo")
		.select("content_id")
		.where("collection", "=", collection)
		.where("content_id", "in", ids)
		.where("seo_no_index", "=", 1)
		.execute();
	return new Set(rows.map((r) => r.content_id));
}

export interface HreflangAlternate {
	hreflang: string;
	href: string;
}

export interface HreflangOptions {
	siteUrl?: string;
}

export async function getHreflangAlternates(
	collection: string,
	entryId: string,
	options: HreflangOptions = {},
): Promise<HreflangAlternate[]> {
	if (!isI18nEnabled()) return [];
	const key = `hreflang:${collection}:${entryId}:${options.siteUrl ?? ""}`;
	return requestCached(key, async () => {
		const { getDb } = await import("../loader.js");
		const db = await getDb();
		return getHreflangAlternatesWithDb(db, collection, entryId, options);
	});
}

export async function getHreflangAlternatesWithDb(
	db: Kysely<Database>,
	collection: string,
	entryId: string,
	options: HreflangOptions = {},
): Promise<HreflangAlternate[]> {
	if (!isI18nEnabled()) return [];

	let siteUrl = options.siteUrl;
	if (!siteUrl) {
		const settings = await getSiteSettingsWithDb(db);
		siteUrl = settings.url;
	}
	if (!siteUrl || !ABSOLUTE_URL_RE.test(siteUrl)) return [];
	siteUrl = siteUrl.replace(TRAILING_SLASH_RE, "");

	const repo = new ContentRepository(db);
	const item = await repo.findByIdOrSlug(collection, entryId);
	if (!item) return [];

	const group = item.translationGroup || item.id;
	let variants = await repo.findTranslations(collection, group);
	if (variants.length === 0) variants = [item];

	let published = variants.filter((v) => v.status === "published");
	if (published.length === 0) return [];

	const noindexIds = await findNoindexIds(
		db,
		collection,
		published.map((v) => v.id),
	);
	if (noindexIds.has(item.id)) return [];
	published = published.filter((v) => !noindexIds.has(v.id));

	const info = await getCollectionInfoWithDb(db, collection);
	const urlPattern = info?.urlPattern ?? null;

	const resolved: Array<{ locale: string; href: string }> = [];
	for (const variant of published) {
		const locale = variant.locale || "en";
		const path = interpolateUrlPattern({
			pattern: urlPattern,
			collection,
			slug: variant.slug || variant.id,
			id: variant.id,
		});
		const localized = await localizePath(path, locale);
		if (localized === null) continue;
		resolved.push({ locale, href: `${siteUrl}${localized}` });
	}
	if (resolved.length === 0) return [];

	resolved.sort((a, b) => a.locale.localeCompare(b.locale));
	const alternates: HreflangAlternate[] = resolved.map((r) => ({
		hreflang: r.locale,
		href: r.href,
	}));

	const defaultLocale = getI18nConfig()?.defaultLocale;
	const xDefault = resolved.find((r) => r.locale === defaultLocale) ?? resolved[0];
	if (xDefault) {
		alternates.push({ hreflang: "x-default", href: xDefault.href });
	}

	return alternates;
}
