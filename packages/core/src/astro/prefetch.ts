import { getDb } from "../loader.js";
import { getMenu } from "../menus/index.js";
import { setRequestCacheEntry } from "../request-cache.js";
import { getSiteSettings } from "../settings/index.js";
import { getTaxonomyDefs, getTaxonomyTerms } from "../taxonomies/index.js";
import { getWidgetAreas } from "../widgets/index.js";

async function prefetchWidgetAreas(): Promise<void> {
	const areas = await getWidgetAreas();
	for (const area of areas) {
		setRequestCacheEntry(`widget-area:${area.name}`, area);
	}
}

async function prefetchTaxonomyTerms(): Promise<void> {
	const defs = await getTaxonomyDefs();
	await Promise.allSettled(defs.map((def) => getTaxonomyTerms(def.name, { includeCounts: false })));
}

async function prefetchMenus(): Promise<void> {
	const db = await getDb();
	const rows = await db.selectFrom("_emdash_menus").select("name").distinct().execute();
	const names = [...new Set(rows.map((r) => r.name))];
	await Promise.allSettled(names.map((name) => getMenu(name)));
}

export async function prefetchLayoutData(): Promise<void> {
	try {
		await Promise.allSettled([
			getSiteSettings(),
			prefetchMenus(),
			prefetchWidgetAreas(),
			prefetchTaxonomyTerms(),
		]);
	} catch (error) {
		console.error("[emdash] layout prefetch failed (non-fatal):", error);
	}
}
