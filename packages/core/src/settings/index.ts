import type { Kysely } from "kysely";

import { after } from "../after.js";
import { MediaRepository } from "../database/repositories/media.js";
import { OptionsRepository } from "../database/repositories/options.js";
import type { Database } from "../database/types.js";
import { getDb } from "../loader.js";
import { cachedQuery, invalidateObjectCache } from "../object-cache/index.js";
import { peekRequestCache, requestCached } from "../request-cache.js";

const SETTINGS_CACHE_NAMESPACE = "settings";
import type { Storage } from "../storage/types.js";
import {
	createSingleFlightCache,
	type SingleFlightCache,
	invalidateSingleFlightCache,
	singleFlightCached,
} from "../utils/single-flight-cache.js";
import type { SiteSettings, SiteSettingKey, MediaReference, SeoSettings } from "./types.js";

const SETTINGS_PREFIX = "site:";

const SITE_SETTINGS_CACHE_KEY = Symbol.for("emdash:site-settings");
const g = globalThis as Record<symbol, unknown>;
const settingsCache: SingleFlightCache<Partial<SiteSettings>> =
	// eslint-disable-next-line typescript/no-unsafe-type-assertion -- globalThis singleton pattern (see request-context.ts)
	(g[SITE_SETTINGS_CACHE_KEY] as SingleFlightCache<Partial<SiteSettings>> | undefined) ??
	(() => {
		const c = createSingleFlightCache<Partial<SiteSettings>>();
		g[SITE_SETTINGS_CACHE_KEY] = c;
		return c;
	})();

export function invalidateSiteSettingsCache(): void {
	invalidateSingleFlightCache(settingsCache);
	invalidateObjectCache(SETTINGS_CACHE_NAMESPACE);
}

function isMediaReference(value: unknown): value is MediaReference {
	return typeof value === "object" && value !== null && "mediaId" in value;
}

async function resolveMediaReference(
	mediaRef: MediaReference | undefined,
	db: Kysely<Database>,
	_storage: Storage | null,
): Promise<MediaReference | undefined> {
	if (!mediaRef?.mediaId) {
		return mediaRef;
	}

	try {
		const mediaRepo = new MediaRepository(db);
		const media = await mediaRepo.findById(mediaRef.mediaId);

		if (media) {
			return {
				...mediaRef,
				url: `/_emdash/api/media/file/${media.storageKey}`,
				contentType: media.mimeType,
				...(media.width !== null ? { width: media.width } : {}),
				...(media.height !== null ? { height: media.height } : {}),
			};
		}
	} catch {}

	return mediaRef;
}

export async function getSiteSetting<K extends SiteSettingKey>(
	key: K,
): Promise<SiteSettings[K] | undefined> {
	const primed = peekRequestCache<Partial<SiteSettings>>("siteSettings");
	if (primed) {
		const settings = await primed;
		return settings[key];
	}

	return requestCached(`siteSetting:${key}`, async () => {
		const db = await getDb();
		return getSiteSettingWithDb(key, db);
	});
}

export async function getSiteSettingWithDb<K extends SiteSettingKey>(
	key: K,
	db: Kysely<Database>,
	storage: Storage | null = null,
): Promise<SiteSettings[K] | undefined> {
	const options = new OptionsRepository(db);
	const value = await options.get<SiteSettings[K]>(`${SETTINGS_PREFIX}${key}`);

	if (!value) {
		return undefined;
	}

	if ((key === "logo" || key === "favicon") && isMediaReference(value)) {
		const resolved = await resolveMediaReference(value, db, storage);
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- TS can't narrow generic K from key equality; resolved type is correct
		return resolved as SiteSettings[K] | undefined;
	}

	if (key === "seo" && value && typeof value === "object") {
		// eslint-disable-next-line typescript/no-unsafe-type-assertion -- TS can't narrow generic K from key equality
		const seo = value as SeoSettings;
		if (seo.defaultOgImage) {
			const resolved = {
				...seo,
				defaultOgImage: await resolveMediaReference(seo.defaultOgImage, db, storage),
			};
			// eslint-disable-next-line typescript/no-unsafe-type-assertion -- TS can't narrow generic K from key equality
			return resolved as SiteSettings[K] | undefined;
		}
	}

	return value;
}

export function getSiteSettings(): Promise<Partial<SiteSettings>> {
	// global scope's lifetime without ever sharing an awaitable promise. The
	return requestCached("siteSettings", () =>
		singleFlightCached(
			settingsCache,
			() =>
				cachedQuery({
					namespace: SETTINGS_CACHE_NAMESPACE,
					key: "all",
					load: async () => {
						const db = await getDb();
						return getSiteSettingsWithDb(db);
					},
				}),
			{ anchor: (promise) => after(() => promise), ownerTimeoutMs: 30_000 },
		),
	);
}

export async function getSiteSettingsWithDb(
	db: Kysely<Database>,
	storage: Storage | null = null,
): Promise<Partial<SiteSettings>> {
	const options = new OptionsRepository(db);
	const allOptions = await options.getByPrefix(SETTINGS_PREFIX);

	const settings: Record<string, unknown> = {};

	for (const [key, value] of allOptions) {
		const settingKey = key.replace(SETTINGS_PREFIX, "");
		settings[settingKey] = value;
	}

	const typedSettings = settings as Partial<SiteSettings>;

	if (typedSettings.logo) {
		typedSettings.logo = await resolveMediaReference(typedSettings.logo, db, storage);
	}
	if (typedSettings.favicon) {
		typedSettings.favicon = await resolveMediaReference(typedSettings.favicon, db, storage);
	}
	if (typedSettings.seo?.defaultOgImage) {
		typedSettings.seo = {
			...typedSettings.seo,
			defaultOgImage: await resolveMediaReference(typedSettings.seo.defaultOgImage, db, storage),
		};
	}

	return typedSettings;
}

export async function setSiteSettings(
	settings: Partial<SiteSettings>,
	db: Kysely<Database>,
): Promise<void> {
	const options = new OptionsRepository(db);

	const updates: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(settings)) {
		if (value !== undefined) {
			updates[`${SETTINGS_PREFIX}${key}`] = value;
		}
	}

	try {
		await options.setMany(updates);
	} finally {
		invalidateSiteSettingsCache();
	}
}

export async function getPluginSetting<T = unknown>(
	pluginId: string,
	key: string,
): Promise<T | undefined> {
	const db = await getDb();
	return getPluginSettingWithDb<T>(pluginId, key, db);
}

export async function getPluginSettingWithDb<T = unknown>(
	pluginId: string,
	key: string,
	db: Kysely<Database>,
): Promise<T | undefined> {
	const options = new OptionsRepository(db);
	const value = await options.get<T>(`plugin:${pluginId}:settings:${key}`);
	return value ?? undefined;
}

export async function getPluginSettings(pluginId: string): Promise<Record<string, unknown>> {
	const db = await getDb();
	return getPluginSettingsWithDb(pluginId, db);
}

export async function getPluginSettingsWithDb(
	pluginId: string,
	db: Kysely<Database>,
): Promise<Record<string, unknown>> {
	const prefix = `plugin:${pluginId}:settings:`;
	const options = new OptionsRepository(db);
	const allOptions = await options.getByPrefix(prefix);

	const settings: Record<string, unknown> = {};
	for (const [key, value] of allOptions) {
		if (!key.startsWith(prefix)) {
			continue;
		}
		settings[key.slice(prefix.length)] = value;
	}

	return settings;
}
