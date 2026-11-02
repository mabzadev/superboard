import type { Kysely } from "kysely";

import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import { invalidateSiteSettingsCache } from "../settings/index.js";
import type { SiteSettings } from "../settings/types.js";

const SETTINGS_PREFIX = "site:";

export interface SiteSettingsAnalysis {
	title?: string;
	tagline?: string;
	logo?: { url: string; id?: number };
	favicon?: { url: string; id?: number };
}

export interface SettingsImportResult {
	applied: string[];
	skipped: string[];
	errors: Array<{ setting: string; error: string }>;
}

export interface SettingsMediaIds {
	logoMediaId?: string;
	faviconMediaId?: string;
}

export async function importSiteSettings(
	settings: SiteSettingsAnalysis,
	db: Kysely<Database>,
	overwrite = false,
	media: SettingsMediaIds = {},
): Promise<SettingsImportResult> {
	const result: SettingsImportResult = {
		applied: [],
		skipped: [],
		errors: [],
	};

	const updates: Array<{ setting: keyof SiteSettings; value: unknown }> = [];
	if (settings.title) {
		updates.push({ setting: "title", value: settings.title });
	}
	if (settings.tagline) {
		updates.push({ setting: "tagline", value: settings.tagline });
	}
	if (media.logoMediaId) {
		updates.push({ setting: "logo", value: { mediaId: media.logoMediaId } });
	}
	if (media.faviconMediaId) {
		updates.push({ setting: "favicon", value: { mediaId: media.faviconMediaId } });
	}

	if (updates.length === 0) {
		return result;
	}

	const options = new OptionsRepository(db);
	try {
		for (const { setting, value } of updates) {
			try {
				const key = `${SETTINGS_PREFIX}${setting}`;
				if (!overwrite) {
					const existing = await options.get(key);
					if (existing !== null) {
						result.skipped.push(setting);
						continue;
					}
				}
				await options.set(key, value);
				result.applied.push(setting);
			} catch (error) {
				result.errors.push({
					setting,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
	} finally {
		if (result.applied.length > 0) {
			invalidateSiteSettingsCache();
		}
	}

	return result;
}

export function parseSiteSettingsFromPlugin(
	options: Record<string, unknown>,
): SiteSettingsAnalysis {
	const settings: SiteSettingsAnalysis = {};

	if (typeof options.blogname === "string" && options.blogname.trim() !== "") {
		settings.title = options.blogname;
	}
	if (typeof options.blogdescription === "string" && options.blogdescription.trim() !== "") {
		settings.tagline = options.blogdescription;
	}

	if (typeof options.custom_logo_url === "string" && options.custom_logo_url !== "") {
		settings.logo = {
			url: options.custom_logo_url,
			id: typeof options.custom_logo === "number" ? options.custom_logo : undefined,
		};
	}
	if (typeof options.site_icon_url === "string" && options.site_icon_url !== "") {
		settings.favicon = {
			url: options.site_icon_url,
			id: typeof options.site_icon === "number" ? options.site_icon : undefined,
		};
	}

	return settings;
}
