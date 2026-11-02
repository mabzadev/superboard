import type { Kysely } from "kysely";
import { ulid } from "ulidx";

import { ContentRepository } from "../database/repositories/content.js";
import { MediaRepository } from "../database/repositories/media.js";
import { OptionsRepository } from "../database/repositories/options.js";
import { PluginStorageRepository } from "../database/repositories/plugin-storage.js";
import { SeoRepository } from "../database/repositories/seo.js";
import { TaxonomyRepository, type Taxonomy } from "../database/repositories/taxonomy.js";
import { UserRepository } from "../database/repositories/user.js";
import { withTransaction } from "../database/transaction.js";
import type { Database } from "../database/types.js";
import { resolveContentCreateLocale } from "../i18n/config.js";
import {
	resolveAndValidateExternalUrl,
	SsrfError,
	stripCredentialHeaders,
} from "../import/ssrf.js";
import { enrichImageMetadata } from "../media/enrich.js";
import { markContentMediaUsageCollectionStaleSafely } from "../media/usage/content-refresh.js";
import { invalidateSiteSettingsCache } from "../settings/index.js";
import type { Storage } from "../storage/types.js";
import { CronAccessImpl } from "./cron.js";
import type { EmailPipeline } from "./email.js";
import type {
	ResolvedPlugin,
	PluginContext,
	PluginStorageConfig,
	StorageCollection,
	KVAccess,
	CronAccess,
	EmailAccess,
	ContentAccess,
	ContentAccessWithWrite,
	MediaAccess,
	MediaAccessWithWrite,
	HttpAccess,
	LogAccess,
	SiteInfo,
	UserAccess,
	UserInfo,
	ContentItem,
	ContentCreateOptions,
	ContentItemSeoInput,
	ContentWriteInput,
	MediaItem,
	PaginatedResult,
	QueryOptions,
	ContentListOptions,
	MediaListOptions,
	TaxonomyAccess,
	TaxonomyDefInfo,
	TaxonomyTermInfo,
	TaxonomyReadOptions,
} from "./types.js";

export function createKVAccess(optionsRepo: OptionsRepository, pluginId: string): KVAccess {
	const prefix = `plugin:${pluginId}:`;

	return {
		async get<T>(key: string): Promise<T | null> {
			return optionsRepo.get<T>(`${prefix}${key}`);
		},

		async set(key: string, value: unknown): Promise<void> {
			await optionsRepo.set(`${prefix}${key}`, value);
		},

		async delete(key: string): Promise<boolean> {
			return optionsRepo.delete(`${prefix}${key}`);
		},

		async list(keyPrefix?: string): Promise<Array<{ key: string; value: unknown }>> {
			const fullPrefix = `${prefix}${keyPrefix ?? ""}`;
			const entriesMap = await optionsRepo.getByPrefix(fullPrefix);
			const result: Array<{ key: string; value: unknown }> = [];
			for (const [fullKey, value] of entriesMap) {
				result.push({
					key: fullKey.slice(prefix.length),
					value,
				});
			}
			return result;
		},
	};
}

function createStorageCollection<T>(
	db: Kysely<Database>,
	pluginId: string,
	collectionName: string,
	indexes: Array<string | string[]>,
): StorageCollection<T> {
	const repo = new PluginStorageRepository<T>(db, pluginId, collectionName, indexes);

	return {
		get: (id) => repo.get(id),
		put: (id, data) => repo.put(id, data),
		delete: (id) => repo.delete(id),
		exists: (id) => repo.exists(id),
		getMany: (ids) => repo.getMany(ids),
		putMany: (items) => repo.putMany(items),
		deleteMany: (ids) => repo.deleteMany(ids),
		count: (where) => repo.count(where),

		async query(options?: QueryOptions): Promise<PaginatedResult<{ id: string; data: T }>> {
			const result = await repo.query({
				where: options?.where,
				orderBy: options?.orderBy,
				limit: options?.limit,
				cursor: options?.cursor,
			});

			return {
				items: result.items,
				cursor: result.cursor,
				hasMore: result.hasMore,
			};
		},
	};
}

export function createStorageAccess<T extends PluginStorageConfig>(
	db: Kysely<Database>,
	pluginId: string,
	storageConfig: T,
): Record<string, StorageCollection> {
	const storage: Record<string, StorageCollection> = {};

	for (const [collectionName, config] of Object.entries(storageConfig)) {
		const allIndexes = [...config.indexes, ...(config.uniqueIndexes ?? [])];
		storage[collectionName] = createStorageCollection(db, pluginId, collectionName, allIndexes);
	}

	return storage;
}

function splitSeoFromInput(input: ContentWriteInput): {
	fields: Record<string, unknown>;
	seo: ContentItemSeoInput | undefined;
} {
	const { seo, ...fields } = input;
	if (seo !== undefined && (seo === null || typeof seo !== "object" || Array.isArray(seo))) {
		throw new Error("content.seo must be an object");
	}
	return { fields, seo };
}

async function assertSeoEnabled(
	seoRepo: SeoRepository,
	collection: string,
	seo: ContentItemSeoInput | undefined,
): Promise<boolean> {
	const hasSeo = await seoRepo.isEnabled(collection);
	if (seo !== undefined && !hasSeo) {
		throw new Error(
			`Collection "${collection}" does not have SEO enabled. ` +
				`Remove the seo field or enable SEO on this collection.`,
		);
	}
	return hasSeo;
}

function parseCollectionsColumn(value: string | null): string[] {
	if (!value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function taxonomyToTermInfo(term: Taxonomy): TaxonomyTermInfo {
	return {
		id: term.id,
		taxonomy: term.name,
		slug: term.slug,
		label: term.label,
		parentId: term.parentId,
		data: term.data,
		locale: term.locale,
		translationGroup: term.translationGroup,
	};
}

export function createContentAccess(db: Kysely<Database>): ContentAccess {
	const contentRepo = new ContentRepository(db);
	const seoRepo = new SeoRepository(db);

	return {
		async get(collection: string, id: string): Promise<ContentItem | null> {
			const item = await contentRepo.findById(collection, id);
			if (!item) return null;

			const result: ContentItem = {
				id: item.id,
				type: item.type,
				slug: item.slug,
				status: item.status,
				data: item.data,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt,
				locale: item.locale,
				publishedAt: item.publishedAt,
				scheduledAt: item.scheduledAt,
			};

			if (await seoRepo.isEnabled(collection)) {
				result.seo = await seoRepo.get(collection, item.id);
			}

			return result;
		},

		async list(
			collection: string,
			options?: ContentListOptions,
		): Promise<PaginatedResult<ContentItem>> {
			let orderBy: { field: string; direction: "asc" | "desc" } | undefined;
			if (options?.orderBy) {
				const entries = Object.entries(options.orderBy);
				const first = entries[0];
				if (first) {
					orderBy = { field: first[0], direction: first[1] };
				}
			}

			const result = await contentRepo.findMany(collection, {
				limit: options?.limit ?? 50,
				cursor: options?.cursor,
				orderBy,
				where: options?.where,
			});

			const items: ContentItem[] = result.items.map((item) => ({
				id: item.id,
				type: item.type,
				slug: item.slug,
				status: item.status,
				data: item.data,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt,
				locale: item.locale,
				publishedAt: item.publishedAt,
				scheduledAt: item.scheduledAt,
			}));

			if (items.length > 0 && (await seoRepo.isEnabled(collection))) {
				const seoMap = await seoRepo.getMany(
					collection,
					items.map((i) => i.id),
				);
				for (const item of items) {
					const seo = seoMap.get(item.id);
					if (seo) item.seo = seo;
				}
			}

			return {
				items,
				cursor: result.nextCursor,
				hasMore: !!result.nextCursor,
			};
		},
	};
}

export function createTaxonomyAccess(db: Kysely<Database>): TaxonomyAccess {
	const taxonomyRepo = new TaxonomyRepository(db);

	return {
		async getAll(options?: TaxonomyReadOptions): Promise<TaxonomyDefInfo[]> {
			let query = db.selectFrom("_emdash_taxonomy_defs").selectAll();
			if (options?.locale !== undefined) query = query.where("locale", "=", options.locale);
			const rows = await query.orderBy("name", "asc").execute();
			return rows.map((row) => ({
				name: row.name,
				label: row.label,
				labelSingular: row.label_singular,
				hierarchical: row.hierarchical === 1,
				collections: parseCollectionsColumn(row.collections),
				locale: row.locale,
			}));
		},

		async getTerms(taxonomy: string, options?: TaxonomyReadOptions): Promise<TaxonomyTermInfo[]> {
			const terms = await taxonomyRepo.findByName(taxonomy, { locale: options?.locale });
			return terms.map(taxonomyToTermInfo);
		},

		async getEntryTerms(
			collection: string,
			entryId: string,
			options?: TaxonomyReadOptions & { taxonomy?: string },
		): Promise<TaxonomyTermInfo[]> {
			const terms = await taxonomyRepo.getTermsForEntry(
				collection,
				entryId,
				options?.taxonomy,
				options?.locale,
			);
			return terms.map(taxonomyToTermInfo);
		},
	};
}

export function createContentAccessWithWrite(
	db: Kysely<Database>,
	beforeContentWrite?: () => Promise<void>,
): ContentAccessWithWrite {
	const readAccess = createContentAccess(db);

	return {
		...readAccess,

		async create(
			collection: string,
			data: ContentWriteInput,
			options?: ContentCreateOptions,
		): Promise<ContentItem> {
			const locale = resolveContentCreateLocale(options?.locale);
			await beforeContentWrite?.();
			const { fields, seo } = splitSeoFromInput(data);
			let contentMutated = false;

			try {
				const created = await withTransaction(db, async (trx) => {
					const trxContentRepo = new ContentRepository(trx);
					const trxSeoRepo = new SeoRepository(trx);

					const hasSeo = await assertSeoEnabled(trxSeoRepo, collection, seo);

					const item = await trxContentRepo.create({
						type: collection,
						data: fields,
						locale,
					});
					contentMutated = true;

					const result: ContentItem = {
						id: item.id,
						type: item.type,
						slug: item.slug,
						status: item.status,
						data: item.data,
						createdAt: item.createdAt,
						updatedAt: item.updatedAt,
						locale: item.locale,
						publishedAt: item.publishedAt,
						scheduledAt: item.scheduledAt,
					};

					if (hasSeo) {
						result.seo =
							seo !== undefined
								? await trxSeoRepo.upsert(collection, item.id, seo)
								: await trxSeoRepo.get(collection, item.id);
					}

					return result;
				});
				await markContentMediaUsageCollectionStaleSafely(db, collection, "CONTENT_USAGE_STALE");
				return created;
			} catch (error) {
				if (contentMutated) {
					await markContentMediaUsageCollectionStaleSafely(db, collection, "CONTENT_USAGE_STALE");
				}
				throw error;
			}
		},

		async update(collection: string, id: string, data: ContentWriteInput): Promise<ContentItem> {
			await beforeContentWrite?.();
			const { fields, seo } = splitSeoFromInput(data);
			const hasFieldUpdates = Object.keys(fields).length > 0;
			let contentMutated = false;

			try {
				const updated = await withTransaction(db, async (trx) => {
					const trxContentRepo = new ContentRepository(trx);
					const trxSeoRepo = new SeoRepository(trx);

					const hasSeo = await assertSeoEnabled(trxSeoRepo, collection, seo);

					const item = hasFieldUpdates
						? await trxContentRepo.updateDraftAware(collection, id, { data: fields })
						: await (async () => {
								const existing = await trxContentRepo.findById(collection, id);
								if (!existing) throw new Error("Content not found");
								return existing;
							})();
					if (hasFieldUpdates) contentMutated = true;

					const result: ContentItem = {
						id: item.id,
						type: item.type,
						slug: item.slug,
						status: item.status,
						data: item.data,
						createdAt: item.createdAt,
						updatedAt: item.updatedAt,
						locale: item.locale,
						publishedAt: item.publishedAt,
						scheduledAt: item.scheduledAt,
					};

					if (hasSeo) {
						result.seo =
							seo !== undefined
								? await trxSeoRepo.upsert(collection, item.id, seo)
								: await trxSeoRepo.get(collection, item.id);
					}

					return result;
				});
				if (hasFieldUpdates) {
					await markContentMediaUsageCollectionStaleSafely(db, collection, "CONTENT_USAGE_STALE");
				}
				return updated;
			} catch (error) {
				if (contentMutated) {
					await markContentMediaUsageCollectionStaleSafely(db, collection, "CONTENT_USAGE_STALE");
				}
				throw error;
			}
		},

		async delete(collection: string, id: string): Promise<boolean> {
			await beforeContentWrite?.();
			const contentRepo = new ContentRepository(db);
			const deleted = await contentRepo.delete(collection, id);
			if (deleted) {
				await markContentMediaUsageCollectionStaleSafely(db, collection, "CONTENT_USAGE_STALE");
			}
			return deleted;
		},
	};
}

export function createMediaAccess(db: Kysely<Database>): MediaAccess {
	const mediaRepo = new MediaRepository(db);

	return {
		async get(id: string): Promise<MediaItem | null> {
			const item = await mediaRepo.findById(id);
			if (!item) return null;

			return {
				id: item.id,
				filename: item.filename,
				mimeType: item.mimeType,
				size: item.size,
				url: `/media/${item.id}/${item.filename}`,
				createdAt: item.createdAt,
			};
		},

		async list(options?: MediaListOptions): Promise<PaginatedResult<MediaItem>> {
			const result = await mediaRepo.findMany({
				limit: options?.limit ?? 50,
				cursor: options?.cursor,
				mimeType: options?.mimeType,
			});

			return {
				items: result.items.map((item) => ({
					id: item.id,
					filename: item.filename,
					mimeType: item.mimeType,
					size: item.size,
					url: `/media/${item.id}/${item.filename}`,
					createdAt: item.createdAt,
				})),
				cursor: result.nextCursor,
				hasMore: !!result.nextCursor,
			};
		},
	};
}

export function createMediaAccessWithWrite(
	db: Kysely<Database>,
	getUploadUrlFn:
		| ((filename: string, contentType: string) => Promise<{ uploadUrl: string; mediaId: string }>)
		| undefined,
	storage?: Storage,
): MediaAccessWithWrite {
	const mediaRepo = new MediaRepository(db);
	const readAccess = createMediaAccess(db);

	const getUploadUrl =
		getUploadUrlFn ??
		(async (filename: string, contentType: string) => {
			if (!storage) {
				throw new Error(
					"Media getUploadUrl() requires a storage backend. Configure storage in PluginContextFactoryOptions.",
				);
			}

			const basename = filename.split("/").pop() ?? filename;
			const dotIdx = basename.lastIndexOf(".");
			const ext = dotIdx > 0 ? basename.slice(dotIdx).toLowerCase() : "";
			const storageKey = `${ulid()}${ext}`;

			const media = await mediaRepo.createPending({
				filename: basename,
				mimeType: contentType,
				storageKey,
			});

			const signed = await storage.getSignedUploadUrl({
				key: storageKey,
				contentType,
				expiresIn: 3600,
			});

			return { uploadUrl: signed.url, mediaId: media.id };
		});

	return {
		...readAccess,

		getUploadUrl,

		async upload(
			filename: string,
			contentType: string,
			bytes: ArrayBuffer,
		): Promise<{ mediaId: string; storageKey: string; url: string }> {
			if (!storage) {
				throw new Error(
					"Media upload() requires a storage backend. Configure storage in PluginContextFactoryOptions.",
				);
			}

			const keyPrefix = ulid();
			const basename = filename.split("/").pop() ?? filename;
			const dotIdx = basename.lastIndexOf(".");
			const ext = dotIdx > 0 ? basename.slice(dotIdx).toLowerCase() : "";
			const storageKey = `${keyPrefix}${ext}`;

			await storage.upload({
				key: storageKey,
				body: new Uint8Array(bytes),
				contentType,
			});

			const enriched = await enrichImageMetadata(new Uint8Array(bytes), contentType);

			let media;
			try {
				media = await mediaRepo.create({
					filename: basename,
					mimeType: contentType,
					size: bytes.byteLength,
					storageKey,
					status: "ready",
					width: enriched.width,
					height: enriched.height,
					blurhash: enriched.blurhash,
					dominantColor: enriched.dominantColor,
				});
			} catch (error) {
				try {
					await storage.delete(storageKey);
				} catch {}
				throw error;
			}

			return {
				mediaId: media.id,
				storageKey,
				url: `/_emdash/api/media/file/${storageKey}`,
			};
		},

		async delete(id: string): Promise<boolean> {
			const deleted = await mediaRepo.delete(id);
			if (deleted) {
				invalidateSiteSettingsCache();
			}
			return deleted;
		},
	};
}

const MAX_PLUGIN_REDIRECTS = 5;

function isHostAllowed(host: string, allowedHosts: string[]): boolean {
	return allowedHosts.some((pattern) => {
		if (pattern === "*") return true;
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(1);
			return host.endsWith(suffix) || host === pattern.slice(2);
		}
		return host === pattern;
	});
}

export function createHttpAccess(pluginId: string, allowedHosts: string[]): HttpAccess {
	return {
		async fetch(url: string, init?: RequestInit): Promise<Response> {
			if (allowedHosts.length === 0) {
				throw new Error(
					`Plugin "${pluginId}" has no allowed hosts configured. ` +
						`Add hosts to the plugin's allowedHosts array to enable HTTP requests.`,
				);
			}

			let currentUrl = url;
			let currentInit = init;

			for (let i = 0; i <= MAX_PLUGIN_REDIRECTS; i++) {
				const hostname = new URL(currentUrl).hostname;
				if (!isHostAllowed(hostname, allowedHosts)) {
					throw new Error(
						`Plugin "${pluginId}" is not allowed to fetch from host "${hostname}". ` +
							`Allowed hosts: ${allowedHosts.join(", ")}`,
					);
				}

				const response = await globalThis.fetch(currentUrl, {
					...currentInit,
					redirect: "manual",
				});

				if (response.status < 300 || response.status >= 400) {
					return response;
				}

				const location = response.headers.get("Location");
				if (!location) {
					return response;
				}

				const previousOrigin = new URL(currentUrl).origin;
				currentUrl = new URL(location, currentUrl).href;
				const nextOrigin = new URL(currentUrl).origin;

				if (previousOrigin !== nextOrigin && currentInit) {
					currentInit = stripCredentialHeaders(currentInit);
				}
			}

			throw new Error(`Plugin "${pluginId}": too many redirects (max ${MAX_PLUGIN_REDIRECTS})`);
		},
	};
}

export function createUnrestrictedHttpAccess(pluginId: string): HttpAccess {
	return {
		async fetch(url: string, init?: RequestInit): Promise<Response> {
			let currentUrl = url;
			let currentInit = init;

			for (let i = 0; i <= MAX_PLUGIN_REDIRECTS; i++) {
				try {
					await resolveAndValidateExternalUrl(currentUrl);
				} catch (e) {
					const msg = e instanceof SsrfError ? e.message : "SSRF validation failed";
					throw new Error(
						`Plugin "${pluginId}": blocked fetch to "${new URL(currentUrl).hostname}": ${msg}`,
						{ cause: e },
					);
				}

				const response = await globalThis.fetch(currentUrl, {
					...currentInit,
					redirect: "manual",
				});

				if (response.status < 300 || response.status >= 400) {
					return response;
				}

				const location = response.headers.get("Location");
				if (!location) {
					return response;
				}

				const previousOrigin = new URL(currentUrl).origin;
				currentUrl = new URL(location, currentUrl).href;
				const nextOrigin = new URL(currentUrl).origin;

				if (previousOrigin !== nextOrigin && currentInit) {
					currentInit = stripCredentialHeaders(currentInit);
				}
			}

			throw new Error(`Plugin "${pluginId}": too many redirects (max ${MAX_PLUGIN_REDIRECTS})`);
		},
	};
}

export function createBlockedHttpAccess(pluginId: string): HttpAccess {
	return {
		async fetch(): Promise<never> {
			throw new Error(
				`Plugin "${pluginId}" does not have the "network:request" capability. ` +
					`Add "network:request" to the plugin's capabilities to enable HTTP requests.`,
			);
		},
	};
}

export function createLogAccess(pluginId: string): LogAccess {
	const prefix = `[plugin:${pluginId}]`;

	return {
		debug(message: string, data?: unknown): void {
			if (data !== undefined) {
				console.debug(prefix, message, data);
			} else {
				console.debug(prefix, message);
			}
		},

		info(message: string, data?: unknown): void {
			if (data !== undefined) {
				console.info(prefix, message, data);
			} else {
				console.info(prefix, message);
			}
		},

		warn(message: string, data?: unknown): void {
			if (data !== undefined) {
				console.warn(prefix, message, data);
			} else {
				console.warn(prefix, message);
			}
		},

		error(message: string, data?: unknown): void {
			if (data !== undefined) {
				console.error(prefix, message, data);
			} else {
				console.error(prefix, message);
			}
		},
	};
}

const TRAILING_SLASH_RE = /\/$/;

export interface SiteInfoOptions {
	siteName?: string;
	siteUrl?: string;
	locale?: string;
	trailingSlash?: "always" | "never" | "ignore";
}

export function createSiteInfo(options: SiteInfoOptions): SiteInfo {
	return {
		name: options.siteName ?? "",
		url: (options.siteUrl ?? "").replace(TRAILING_SLASH_RE, ""),
		locale: options.locale ?? "en",
		trailingSlash: options.trailingSlash ?? "ignore",
	};
}

export function createUrlHelper(siteUrl: string): (path: string) => string {
	const base = siteUrl.replace(TRAILING_SLASH_RE, "");

	return (path: string): string => {
		if (!path.startsWith("/")) {
			throw new Error(`URL path must start with "/", got: "${path}"`);
		}
		if (path.startsWith("//")) {
			throw new Error(`URL path must not be protocol-relative, got: "${path}"`);
		}
		return `${base}${path}`;
	};
}

function toUserInfo(user: {
	id: string;
	email: string;
	name: string | null;
	role: number;
	createdAt: string;
}): UserInfo {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		role: user.role,
		createdAt: user.createdAt,
	};
}

export function createUserAccess(db: Kysely<Database>): UserAccess {
	const userRepo = new UserRepository(db);

	return {
		async get(id: string): Promise<UserInfo | null> {
			const user = await userRepo.findById(id);
			if (!user) return null;
			return toUserInfo(user);
		},

		async getByEmail(email: string): Promise<UserInfo | null> {
			const user = await userRepo.findByEmail(email);
			if (!user) return null;
			return toUserInfo(user);
		},

		async list(opts?: {
			role?: number;
			limit?: number;
			cursor?: string;
		}): Promise<{ items: UserInfo[]; nextCursor?: string }> {
			const result = await userRepo.findMany({
				role: opts?.role as 10 | 20 | 30 | 40 | 50 | undefined,
				cursor: opts?.cursor,
				limit: opts?.limit,
			});

			return {
				items: result.items.map(toUserInfo),
				nextCursor: result.nextCursor,
			};
		},
	};
}

export interface PluginContextFactoryOptions {
	db: Kysely<Database>;
	beforeContentWrite?: () => Promise<void>;
	getDb?: () => Kysely<Database>;
	storage?: Storage;
	getUploadUrl?: (
		filename: string,
		contentType: string,
	) => Promise<{ uploadUrl: string; mediaId: string }>;
	siteInfo?: SiteInfoOptions;
	cronReschedule?: () => void;
	emailPipeline?: EmailPipeline;
	trustedProxyHeaders?: string[];
}

export class PluginContextFactory {
	private resolveDb: () => Kysely<Database>;
	private beforeContentWrite?: () => Promise<void>;
	private storage?: Storage;
	private getUploadUrl?: (
		filename: string,
		contentType: string,
	) => Promise<{ uploadUrl: string; mediaId: string }>;
	private site: SiteInfo;
	private urlHelper: (path: string) => string;
	private cronReschedule?: () => void;
	private emailPipeline?: EmailPipeline;
	private warnedMissingMediaBackend = new Set<string>();

	constructor(options: PluginContextFactoryOptions) {
		const fixedDb = options.db;
		this.resolveDb = options.getDb ?? (() => fixedDb);
		this.beforeContentWrite = options.beforeContentWrite;
		this.storage = options.storage;
		this.getUploadUrl = options.getUploadUrl;
		this.site = createSiteInfo(options.siteInfo ?? {});
		this.urlHelper = createUrlHelper(this.site.url);
		this.cronReschedule = options.cronReschedule;
		this.emailPipeline = options.emailPipeline;
	}

	createContext(plugin: ResolvedPlugin): PluginContext {
		const capabilities = new Set(plugin.capabilities);

		const db = this.resolveDb();
		const optionsRepo = new OptionsRepository(db);

		const kv = createKVAccess(optionsRepo, plugin.id);
		const log = createLogAccess(plugin.id);
		const storage = createStorageAccess(db, plugin.id, plugin.storage);

		let content: ContentAccess | ContentAccessWithWrite | undefined;
		if (capabilities.has("content:write")) {
			content = createContentAccessWithWrite(db, this.beforeContentWrite);
		} else if (capabilities.has("content:read")) {
			content = createContentAccess(db);
		}

		let taxonomies: TaxonomyAccess | undefined;
		if (capabilities.has("taxonomies:read")) {
			taxonomies = createTaxonomyAccess(db);
		}

		let media: MediaAccess | MediaAccessWithWrite | undefined;
		if (capabilities.has("media:write")) {
			if (this.getUploadUrl || this.storage) {
				media = createMediaAccessWithWrite(db, this.getUploadUrl, this.storage);
			} else {
				if (!this.warnedMissingMediaBackend.has(plugin.id)) {
					this.warnedMissingMediaBackend.add(plugin.id);
					log.warn(
						"declares the media:write capability but no storage backend is configured; upload() is unavailable.",
					);
				}
				if (capabilities.has("media:read")) {
					media = createMediaAccess(db);
				}
			}
		} else if (capabilities.has("media:read")) {
			media = createMediaAccess(db);
		}

		let http: HttpAccess | undefined;
		if (capabilities.has("network:request:unrestricted")) {
			http = createUnrestrictedHttpAccess(plugin.id);
		} else if (capabilities.has("network:request")) {
			http = createHttpAccess(plugin.id, plugin.allowedHosts);
		}

		let users: UserAccess | undefined;
		if (capabilities.has("users:read")) {
			users = createUserAccess(db);
		}

		let cron: CronAccess | undefined;
		if (this.cronReschedule) {
			cron = new CronAccessImpl(db, plugin.id, this.cronReschedule);
		}

		let email: EmailAccess | undefined;
		if (capabilities.has("email:send") && this.emailPipeline?.isAvailable()) {
			const pipeline = this.emailPipeline;
			const pluginId = plugin.id;
			email = {
				send: (message) => pipeline.send(message, pluginId),
			};
		}

		return {
			plugin: {
				id: plugin.id,
				version: plugin.version,
			},
			storage,
			kv,
			content,
			taxonomies,
			media,
			http,
			log,
			site: this.site,
			url: this.urlHelper,
			users,
			cron,
			email,
		};
	}
}

export function createPluginContext(
	options: PluginContextFactoryOptions,
	plugin: ResolvedPlugin,
): PluginContext {
	const factory = new PluginContextFactory(options);
	return factory.createContext(plugin);
}
