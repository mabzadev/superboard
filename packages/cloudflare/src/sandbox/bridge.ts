import type { D1Database } from "@cloudflare/workers-types";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { ContentCreateOptions, Database, I18nConfig, SandboxEmailSendCallback } from "emdash";
import {
	ContentRepository,
	createSandboxRouteError,
	getSandboxRouteErrorDetails,
	ulid,
	PluginStorageRepository,
	resolveContentCreateLocale,
} from "emdash";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";

import { sandboxHttpFetch } from "./bridge-http.js";

const COLLECTION_NAME_REGEX = /^[a-z][a-z0-9_]*$/;
const MISSING_MEDIA_USAGE_ACTIVATION_TABLE_REGEX = /no such table.*_emdash_media_usage_activation/i;

const FILE_EXT_REGEX = /^\.[a-z0-9]{1,10}$/i;

const SYSTEM_COLUMNS = new Set([
	"id",
	"slug",
	"status",
	"author_id",
	"created_at",
	"updated_at",
	"published_at",
	"scheduled_at",
	"deleted_at",
	"version",
	"live_revision_id",
	"draft_revision_id",
	"locale",
	"translation_group",
]);

let emailSendCallback: SandboxEmailSendCallback | null = null;

export function setEmailSendCallback(callback: SandboxEmailSendCallback | null): void {
	emailSendCallback = callback;
}

function serializeValue(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "object") return JSON.stringify(value);
	return value;
}

function rowToContentItem(
	collection: string,
	row: Record<string, unknown>,
): {
	id: string;
	type: string;
	data: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	locale: string;
} {
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		if (!SYSTEM_COLUMNS.has(key)) {
			if (typeof value === "string" && (value.startsWith("{") || value.startsWith("["))) {
				try {
					data[key] = JSON.parse(value);
				} catch {
					data[key] = value;
				}
			} else if (value !== null) {
				data[key] = value;
			}
		}
	}

	return {
		id: typeof row.id === "string" ? row.id : String(row.id),
		type: collection,
		data,
		createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
		updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
		locale: typeof row.locale === "string" ? row.locale : "en",
	};
}

function columnString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function columnNullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function columnStringArray(value: unknown): string[] {
	if (typeof value !== "string" || !value) return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function columnJsonObject(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "string" || !value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return isJsonObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function rowToTaxonomyTerm(row: Record<string, unknown>): {
	id: string;
	taxonomy: string;
	slug: string;
	label: string;
	parentId: string | null;
	data: Record<string, unknown> | null;
	locale: string;
	translationGroup: string | null;
} {
	return {
		id: columnString(row.id),
		taxonomy: columnString(row.name),
		slug: columnString(row.slug),
		label: columnString(row.label),
		parentId: columnNullableString(row.parent_id),
		data: columnJsonObject(row.data),
		locale: columnString(row.locale),
		translationGroup: columnNullableString(row.translation_group),
	};
}

export interface PluginBridgeEnv {
	DB: D1Database;
	MEDIA?: R2Bucket;
}

export interface PluginBridgeProps {
	pluginId: string;
	pluginVersion: string;
	capabilities: string[];
	allowedHosts: string[];
	storageCollections: string[];
	i18nConfig?: I18nConfig | null;
	storageConfig?: Record<
		string,
		{ indexes?: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> }
	>;
}

export class PluginBridge extends WorkerEntrypoint<PluginBridgeEnv, PluginBridgeProps> {
	private async assertMediaUsageActivationWriteAllowed(): Promise<void> {
		try {
			const activation = await this.env.DB.prepare(
				"SELECT state FROM _emdash_media_usage_activation WHERE task_key = ? LIMIT 1",
			)
				.bind("incremental_capture")
				.first<{ state: string }>();
			if (activation?.state === "activating") {
				throw createSandboxRouteError("MEDIA_USAGE_ACTIVATION_IN_PROGRESS");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (MISSING_MEDIA_USAGE_ACTIVATION_TABLE_REGEX.test(message)) return;
			if (getSandboxRouteErrorDetails(error)) throw error;
			console.error("[media-usage] Failed to check the sandbox write fence:", error);
			throw createSandboxRouteError("MEDIA_USAGE_ACTIVATION_CHECK_FAILED");
		}
	}

	private getStorageRepo(collection: string): PluginStorageRepository {
		const { pluginId, storageConfig } = this.ctx.props;
		const config = storageConfig?.[collection];
		const allIndexes: Array<string | string[]> = [
			...(config?.indexes ?? []),
			...(config?.uniqueIndexes ?? []),
		];
		const db = new Kysely<unknown>({
			dialect: new D1Dialect({ database: this.env.DB }),
		});
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Kysely<unknown> is compatible with PluginStorageRepository's expected db
		return new PluginStorageRepository(db as never, pluginId, collection, allIndexes);
	}

	async kvGet(key: string): Promise<unknown> {
		const { pluginId } = this.ctx.props;
		const result = await this.env.DB.prepare(
			"SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id = ?",
		)
			.bind(pluginId, key)
			.first<{ data: string }>();
		if (!result) return null;
		try {
			return JSON.parse(result.data);
		} catch {
			return result.data;
		}
	}

	async kvSet(key: string, value: unknown): Promise<void> {
		const { pluginId } = this.ctx.props;
		await this.env.DB.prepare(
			"INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, updated_at) VALUES (?, '__kv', ?, ?, datetime('now'))",
		)
			.bind(pluginId, key, JSON.stringify(value))
			.run();
	}

	async kvDelete(key: string): Promise<boolean> {
		const { pluginId } = this.ctx.props;
		const result = await this.env.DB.prepare(
			"DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id = ?",
		)
			.bind(pluginId, key)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async kvList(prefix: string = ""): Promise<Array<{ key: string; value: unknown }>> {
		const { pluginId } = this.ctx.props;
		const results = await this.env.DB.prepare(
			"SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = '__kv' AND id LIKE ?",
		)
			.bind(pluginId, prefix + "%")
			.all<{ id: string; data: string }>();

		return (results.results ?? []).map((row) => ({
			key: row.id,
			value: JSON.parse(row.data),
		}));
	}

	async storageGet(collection: string, id: string): Promise<unknown> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		const result = await this.env.DB.prepare(
			"SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
		)
			.bind(pluginId, collection, id)
			.first<{ data: string }>();
		if (!result) return null;
		return JSON.parse(result.data);
	}

	async storagePut(collection: string, id: string, data: unknown): Promise<void> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		await this.env.DB.prepare(
			"INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
		)
			.bind(pluginId, collection, id, JSON.stringify(data))
			.run();
	}

	async storageDelete(collection: string, id: string): Promise<boolean> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		const result = await this.env.DB.prepare(
			"DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
		)
			.bind(pluginId, collection, id)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async storageQuery(
		collection: string,
		opts: {
			limit?: number;
			cursor?: string;
			where?: Record<string, unknown>;
			orderBy?: Record<string, "asc" | "desc">;
		} = {},
	): Promise<{
		items: Array<{ id: string; data: unknown }>;
		hasMore: boolean;
		cursor?: string;
	}> {
		const { storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		const repo = this.getStorageRepo(collection);
		const result = await repo.query({
			// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- WhereClause is structurally Record<string, unknown>
			where: opts.where as never,
			orderBy: opts.orderBy,
			limit: opts.limit,
			cursor: opts.cursor,
		});
		return {
			items: result.items,
			hasMore: result.hasMore,
			cursor: result.cursor,
		};
	}

	async storageCount(collection: string, where?: Record<string, unknown>): Promise<number> {
		const { storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		const repo = this.getStorageRepo(collection);
		// eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- WhereClause is structurally Record<string, unknown>
		return repo.count(where as never);
	}

	async storageGetMany(collection: string, ids: string[]): Promise<Map<string, unknown>> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		if (ids.length === 0) return new Map();

		const placeholders = ids.map(() => "?").join(",");
		const results = await this.env.DB.prepare(
			`SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id IN (${placeholders})`,
		)
			.bind(pluginId, collection, ...ids)
			.all<{ id: string; data: string }>();

		const map = new Map<string, unknown>();
		for (const row of results.results ?? []) {
			map.set(row.id, JSON.parse(row.data));
		}
		return map;
	}

	async storagePutMany(
		collection: string,
		items: Array<{ id: string; data: unknown }>,
	): Promise<void> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		if (items.length === 0) return;

		for (const item of items) {
			await this.env.DB.prepare(
				"INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
			)
				.bind(pluginId, collection, item.id, JSON.stringify(item.data))
				.run();
		}
	}

	async storageDeleteMany(collection: string, ids: string[]): Promise<number> {
		const { pluginId, storageCollections } = this.ctx.props;
		if (!storageCollections.includes(collection)) {
			throw new Error(`Storage collection not declared: ${collection}`);
		}
		if (ids.length === 0) return 0;

		let deleted = 0;
		for (const id of ids) {
			const result = await this.env.DB.prepare(
				"DELETE FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
			)
				.bind(pluginId, collection, id)
				.run();
			deleted += result.meta?.changes ?? 0;
		}
		return deleted;
	}

	async contentGet(
		collection: string,
		id: string,
	): Promise<{
		id: string;
		type: string;
		data: Record<string, unknown>;
		createdAt: string;
		updatedAt: string;
		locale: string;
	} | null> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("content:read")) {
			throw new Error("Missing capability: content:read");
		}
		if (!COLLECTION_NAME_REGEX.test(collection)) {
			throw new Error(`Invalid collection name: ${collection}`);
		}
		try {
			const result = await this.env.DB.prepare(
				`SELECT * FROM ec_${collection} WHERE id = ? AND deleted_at IS NULL`,
			)
				.bind(id)
				.first();
			if (!result) return null;
			return rowToContentItem(collection, result);
		} catch {
			return null;
		}
	}

	async contentList(
		collection: string,
		opts: { limit?: number; cursor?: string } = {},
	): Promise<{
		items: Array<{
			id: string;
			type: string;
			data: Record<string, unknown>;
			createdAt: string;
			updatedAt: string;
			locale: string;
		}>;
		cursor?: string;
		hasMore: boolean;
	}> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("content:read")) {
			throw new Error("Missing capability: content:read");
		}
		if (!COLLECTION_NAME_REGEX.test(collection)) {
			throw new Error(`Invalid collection name: ${collection}`);
		}
		const limit = Math.min(opts.limit ?? 50, 100);
		try {
			let sql = `SELECT * FROM ec_${collection} WHERE deleted_at IS NULL`;
			const params: unknown[] = [];

			if (opts.cursor) {
				sql += " AND id < ?";
				params.push(opts.cursor);
			}

			sql += " ORDER BY id DESC LIMIT ?";
			params.push(limit + 1);

			const results = await this.env.DB.prepare(sql)
				.bind(...params)
				.all();

			const rows = results.results ?? [];
			const pageRows = rows.slice(0, limit);
			const items = pageRows.map((row) => rowToContentItem(collection, row));
			const hasMore = rows.length > limit;

			return {
				items,
				cursor: hasMore && items.length > 0 ? items.at(-1)!.id : undefined,
				hasMore,
			};
		} catch {
			return { items: [], hasMore: false };
		}
	}

	async contentCreate(
		collection: string,
		data: Record<string, unknown>,
		options?: ContentCreateOptions,
	): Promise<{
		id: string;
		type: string;
		data: Record<string, unknown>;
		createdAt: string;
		updatedAt: string;
		locale: string;
	}> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("content:write")) {
			throw new Error("Missing capability: content:write");
		}
		if (!COLLECTION_NAME_REGEX.test(collection)) {
			throw new Error(`Invalid collection name: ${collection}`);
		}
		const locale = resolveContentCreateLocale(options?.locale, this.ctx.props.i18nConfig ?? null);
		await this.assertMediaUsageActivationWriteAllowed();

		const id = ulid();
		const now = new Date().toISOString();

		const columns: string[] = [
			'"id"',
			'"slug"',
			'"status"',
			'"author_id"',
			'"created_at"',
			'"updated_at"',
			'"version"',
			'"locale"',
			'"translation_group"',
		];
		const values: unknown[] = [
			id,
			typeof data.slug === "string" ? data.slug : null,
			typeof data.status === "string" ? data.status : "draft",
			typeof data.author_id === "string" ? data.author_id : null,
			now,
			now,
			1,
			locale,
			id,
		];

		for (const [key, value] of Object.entries(data)) {
			if (!SYSTEM_COLUMNS.has(key) && COLLECTION_NAME_REGEX.test(key)) {
				columns.push(`"${key}"`);
				values.push(serializeValue(value));
			}
		}

		const placeholders = columns.map(() => "?").join(", ");
		const columnList = columns.join(", ");

		await this.env.DB.prepare(
			`INSERT INTO ec_${collection} (${columnList}) VALUES (${placeholders})`,
		)
			.bind(...values)
			.run();

		const created = await this.env.DB.prepare(
			`SELECT * FROM ec_${collection} WHERE id = ? AND deleted_at IS NULL`,
		)
			.bind(id)
			.first();

		if (!created) {
			return { id, type: collection, data: {}, createdAt: now, updatedAt: now, locale };
		}
		return rowToContentItem(collection, created);
	}

	async contentUpdate(
		collection: string,
		id: string,
		data: Record<string, unknown>,
	): Promise<{
		id: string;
		type: string;
		data: Record<string, unknown>;
		createdAt: string;
		updatedAt: string;
		locale: string;
	}> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("content:write")) {
			throw new Error("Missing capability: content:write");
		}
		if (!COLLECTION_NAME_REGEX.test(collection)) {
			throw new Error(`Invalid collection name: ${collection}`);
		}
		await this.assertMediaUsageActivationWriteAllowed();
		const db = new Kysely<Database>({
			dialect: new D1Dialect({ database: this.env.DB }),
		});
		const updated = await new ContentRepository(db).updateDraftAware(collection, id, {
			data,
			status: typeof data.status === "string" ? data.status : undefined,
			slug: data.slug === undefined ? undefined : typeof data.slug === "string" ? data.slug : null,
		});
		return {
			id: updated.id,
			type: updated.type,
			data: updated.data,
			createdAt: updated.createdAt,
			updatedAt: updated.updatedAt,
			locale: updated.locale ?? "en",
		};
	}

	async contentDelete(collection: string, id: string): Promise<boolean> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("content:write")) {
			throw new Error("Missing capability: content:write");
		}
		if (!COLLECTION_NAME_REGEX.test(collection)) {
			throw new Error(`Invalid collection name: ${collection}`);
		}
		await this.assertMediaUsageActivationWriteAllowed();

		const now = new Date().toISOString();
		const result = await this.env.DB.prepare(
			`UPDATE ec_${collection} SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		)
			.bind(now, now, id)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async taxonomyList(opts: { locale?: string } = {}): Promise<
		Array<{
			name: string;
			label: string;
			labelSingular: string | null;
			hierarchical: boolean;
			collections: string[];
			locale: string;
		}>
	> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("taxonomies:read")) {
			throw new Error("Missing capability: taxonomies:read");
		}
		let sql = "SELECT * FROM _emdash_taxonomy_defs";
		const params: unknown[] = [];
		if (opts.locale !== undefined) {
			sql += " WHERE locale = ?";
			params.push(opts.locale);
		}
		sql += " ORDER BY name ASC";
		const results = await this.env.DB.prepare(sql)
			.bind(...params)
			.all();
		return (results.results ?? []).map((row) => ({
			name: columnString(row.name),
			label: columnString(row.label),
			labelSingular: columnNullableString(row.label_singular),
			hierarchical: row.hierarchical === 1,
			collections: columnStringArray(row.collections),
			locale: columnString(row.locale),
		}));
	}

	async taxonomyTerms(
		taxonomy: string,
		opts: { locale?: string } = {},
	): Promise<
		Array<{
			id: string;
			taxonomy: string;
			slug: string;
			label: string;
			parentId: string | null;
			data: Record<string, unknown> | null;
			locale: string;
			translationGroup: string | null;
		}>
	> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("taxonomies:read")) {
			throw new Error("Missing capability: taxonomies:read");
		}
		let sql = "SELECT * FROM taxonomies WHERE name = ?";
		const params: unknown[] = [taxonomy];
		if (opts.locale !== undefined) {
			sql += " AND locale = ?";
			params.push(opts.locale);
		}
		sql += " ORDER BY sort_order ASC, label ASC, id ASC";
		const results = await this.env.DB.prepare(sql)
			.bind(...params)
			.all();
		return (results.results ?? []).map(rowToTaxonomyTerm);
	}

	async taxonomyEntryTerms(
		collection: string,
		entryId: string,
		opts: { taxonomy?: string; locale?: string } = {},
	): Promise<
		Array<{
			id: string;
			taxonomy: string;
			slug: string;
			label: string;
			parentId: string | null;
			data: Record<string, unknown> | null;
			locale: string;
			translationGroup: string | null;
		}>
	> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("taxonomies:read")) {
			throw new Error("Missing capability: taxonomies:read");
		}
		let sql =
			"SELECT taxonomies.* FROM content_taxonomies " +
			"JOIN taxonomies ON taxonomies.translation_group = content_taxonomies.taxonomy_id " +
			"WHERE content_taxonomies.collection = ? AND content_taxonomies.entry_id = ?";
		const params: unknown[] = [collection, entryId];
		if (opts.taxonomy !== undefined) {
			sql += " AND taxonomies.name = ?";
			params.push(opts.taxonomy);
		}
		if (opts.locale !== undefined) {
			sql += " AND taxonomies.locale = ?";
			params.push(opts.locale);
		}
		sql += " ORDER BY taxonomies.locale ASC";
		const results = await this.env.DB.prepare(sql)
			.bind(...params)
			.all();
		return (results.results ?? []).map(rowToTaxonomyTerm);
	}

	async mediaGet(id: string): Promise<{
		id: string;
		filename: string;
		mimeType: string;
		size: number | null;
		url: string;
		createdAt: string;
	} | null> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("media:read")) {
			throw new Error("Missing capability: media:read");
		}
		const result = await this.env.DB.prepare("SELECT * FROM media WHERE id = ?").bind(id).first<{
			id: string;
			filename: string;
			mime_type: string;
			size: number | null;
			storage_key: string;
			created_at: string;
		}>();
		if (!result) return null;
		return {
			id: result.id,
			filename: result.filename,
			mimeType: result.mime_type,
			size: result.size,
			url: `/_emdash/api/media/file/${result.storage_key}`,
			createdAt: result.created_at,
		};
	}

	async mediaList(opts: { limit?: number; cursor?: string; mimeType?: string } = {}): Promise<{
		items: Array<{
			id: string;
			filename: string;
			mimeType: string;
			size: number | null;
			url: string;
			createdAt: string;
		}>;
		cursor?: string;
		hasMore: boolean;
	}> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("media:read")) {
			throw new Error("Missing capability: media:read");
		}
		const limit = Math.min(opts.limit ?? 50, 100);
		let sql = "SELECT * FROM media WHERE status = 'ready'";
		const params: unknown[] = [];

		if (opts.mimeType) {
			sql += " AND mime_type LIKE ?";
			params.push(opts.mimeType + "%");
		}

		if (opts.cursor) {
			sql += " AND id < ?";
			params.push(opts.cursor);
		}

		sql += " ORDER BY id DESC LIMIT ?";
		params.push(limit + 1);

		const results = await this.env.DB.prepare(sql)
			.bind(...params)
			.all<{
				id: string;
				filename: string;
				mime_type: string;
				size: number | null;
				storage_key: string;
				created_at: string;
			}>();

		const rows = results.results ?? [];
		const pageRows = rows.slice(0, limit);
		const items = pageRows.map((row) => ({
			id: row.id,
			filename: row.filename,
			mimeType: row.mime_type,
			size: row.size,
			url: `/_emdash/api/media/file/${row.storage_key}`,
			createdAt: row.created_at,
		}));
		const hasMore = rows.length > limit;

		return {
			items,
			cursor: hasMore && items.length > 0 ? items.at(-1)!.id : undefined,
			hasMore,
		};
	}

	async mediaUpload(
		filename: string,
		contentType: string,
		bytes: ArrayBuffer,
	): Promise<{ mediaId: string; storageKey: string; url: string }> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("media:write")) {
			throw new Error("Missing capability: media:write");
		}

		if (!this.env.MEDIA) {
			throw new Error("Media storage (R2) not configured. Add MEDIA binding to wrangler config.");
		}

		const ALLOWED_MIME_PREFIXES = ["image/", "video/", "audio/", "application/pdf"];
		if (!ALLOWED_MIME_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
			throw new Error(
				`Unsupported content type: ${contentType}. Allowed: image/*, video/*, audio/*, application/pdf`,
			);
		}

		const mediaId = ulid();
		const basename = filename.includes("/")
			? filename.slice(filename.lastIndexOf("/") + 1)
			: filename;
		const rawExt = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")) : "";
		const ext = FILE_EXT_REGEX.test(rawExt) ? rawExt : "";
		const storageKey = `${mediaId}${ext}`;
		const now = new Date().toISOString();

		await this.env.MEDIA.put(storageKey, bytes, {
			httpMetadata: { contentType },
		});

		try {
			await this.env.DB.prepare(
				"INSERT INTO media (id, filename, mime_type, size, storage_key, status, created_at) VALUES (?, ?, ?, ?, ?, 'ready', ?)",
			)
				.bind(mediaId, filename, contentType, bytes.byteLength, storageKey, now)
				.run();
		} catch (error) {
			try {
				await this.env.MEDIA.delete(storageKey);
			} catch {
				console.warn(`[plugin-bridge] Failed to clean up orphaned R2 object: ${storageKey}`);
			}
			throw error;
		}

		return {
			mediaId,
			storageKey,
			url: `/_emdash/api/media/file/${storageKey}`,
		};
	}

	async mediaDelete(id: string): Promise<boolean> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("media:write")) {
			throw new Error("Missing capability: media:write");
		}

		const media = await this.env.DB.prepare("SELECT storage_key FROM media WHERE id = ?")
			.bind(id)
			.first<{ storage_key: string }>();

		if (!media) return false;

		const result = await this.env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run();

		if (this.env.MEDIA && media.storage_key) {
			try {
				await this.env.MEDIA.delete(media.storage_key);
			} catch {
				console.warn(`[plugin-bridge] Failed to delete R2 object: ${media.storage_key}`);
			}
		}

		return (result.meta?.changes ?? 0) > 0;
	}

	async httpFetch(
		url: string,
		init?: RequestInit,
	): Promise<{
		status: number;
		headers: Record<string, string>;
		text: string;
	}> {
		const { capabilities, allowedHosts } = this.ctx.props;
		return sandboxHttpFetch(url, init, { capabilities, allowedHosts });
	}

	async userGet(id: string): Promise<{
		id: string;
		email: string;
		name: string | null;
		role: number;
		createdAt: string;
	} | null> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("users:read")) {
			throw new Error("Missing capability: users:read");
		}
		const result = await this.env.DB.prepare(
			"SELECT id, email, name, role, created_at FROM users WHERE id = ?",
		)
			.bind(id)
			.first<{
				id: string;
				email: string;
				name: string | null;
				role: number;
				created_at: string;
			}>();
		if (!result) return null;
		return {
			id: result.id,
			email: result.email,
			name: result.name,
			role: result.role,
			createdAt: result.created_at,
		};
	}

	async userGetByEmail(email: string): Promise<{
		id: string;
		email: string;
		name: string | null;
		role: number;
		createdAt: string;
	} | null> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("users:read")) {
			throw new Error("Missing capability: users:read");
		}
		const result = await this.env.DB.prepare(
			"SELECT id, email, name, role, created_at FROM users WHERE email = ?",
		)
			.bind(email.toLowerCase())
			.first<{
				id: string;
				email: string;
				name: string | null;
				role: number;
				created_at: string;
			}>();
		if (!result) return null;
		return {
			id: result.id,
			email: result.email,
			name: result.name,
			role: result.role,
			createdAt: result.created_at,
		};
	}

	async userList(opts?: { role?: number; limit?: number; cursor?: string }): Promise<{
		items: Array<{
			id: string;
			email: string;
			name: string | null;
			role: number;
			createdAt: string;
		}>;
		nextCursor?: string;
	}> {
		const { capabilities } = this.ctx.props;
		if (!capabilities.includes("users:read")) {
			throw new Error("Missing capability: users:read");
		}
		const limit = Math.max(1, Math.min(opts?.limit ?? 50, 100));
		let sql = "SELECT id, email, name, role, created_at FROM users";
		const params: unknown[] = [];
		const conditions: string[] = [];

		if (opts?.role !== undefined) {
			conditions.push("role = ?");
			params.push(opts.role);
		}

		if (opts?.cursor) {
			conditions.push("id < ?");
			params.push(opts.cursor);
		}

		if (conditions.length > 0) {
			sql += ` WHERE ${conditions.join(" AND ")}`;
		}

		sql += " ORDER BY id DESC LIMIT ?";
		params.push(limit + 1);

		const results = await this.env.DB.prepare(sql)
			.bind(...params)
			.all<{
				id: string;
				email: string;
				name: string | null;
				role: number;
				created_at: string;
			}>();

		const rows = results.results ?? [];
		const pageRows = rows.slice(0, limit);
		const items = pageRows.map((row) => ({
			id: row.id,
			email: row.email,
			name: row.name,
			role: row.role,
			createdAt: row.created_at,
		}));
		const hasMore = rows.length > limit;

		return {
			items,
			nextCursor: hasMore && items.length > 0 ? items.at(-1)!.id : undefined,
		};
	}

	async emailSend(message: {
		to: string;
		subject: string;
		text: string;
		html?: string;
	}): Promise<void> {
		const { capabilities, pluginId } = this.ctx.props;
		if (!capabilities.includes("email:send")) {
			throw new Error("Missing capability: email:send");
		}
		if (!emailSendCallback) {
			throw new Error("Email is not configured. No email provider is available.");
		}
		await emailSendCallback(message, pluginId);
	}

	log(level: "debug" | "info" | "warn" | "error", msg: string, data?: unknown): void {
		const { pluginId } = this.ctx.props;
		console[level](`[plugin:${pluginId}]`, msg, data ?? "");
	}
}
