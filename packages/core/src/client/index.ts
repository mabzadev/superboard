import mime from "mime/lite";

import type { ContentFieldFilters } from "../content-list-query.js";
import type { FieldSchema } from "./portable-text.js";
import { convertDataForRead, convertDataForWrite } from "./portable-text.js";
import type { Interceptor } from "./transport.js";
import {
	createTransport,
	csrfInterceptor,
	devBypassInterceptor,
	refreshInterceptor,
	tokenInterceptor,
} from "./transport.js";

const TRAILING_SLASH_PATTERN = /\/$/;

function mimeFromFilename(filename: string): string {
	return mime.getType(filename) ?? "application/octet-stream";
}

export interface EmDashClientOptions {
	baseUrl: string;
	token?: string;
	refreshToken?: string;
	onTokenRefresh?: (accessToken: string, expiresIn: number) => void;
	devBypass?: boolean;
	interceptors?: Interceptor[];
}

export interface ApiError {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

export interface ClientResponse<T> {
	success: true;
	data: T;
}

export interface ListResult<T> {
	items: T[];
	nextCursor?: string;
}

export interface ContentItem {
	id: string;
	type: string;
	slug: string | null;
	status: string;
	data: Record<string, unknown>;
	authorId: string | null;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	scheduledAt: string | null;
	liveRevisionId: string | null;
	draftRevisionId: string | null;
	locale: string | null;
	translationGroup: string | null;
	_rev?: string;
}

export interface Collection {
	slug: string;
	label: string;
	labelSingular: string;
	description?: string;
	icon?: string;
	supports: string[];
}

export interface CollectionWithFields extends Collection {
	fields: Field[];
}

export interface Field {
	slug: string;
	label: string;
	type: string;
	required: boolean;
	unique: boolean;
	defaultValue?: unknown;
	validation?: unknown;
	widget?: string;
	options?: unknown;
	sortOrder?: number;
}

export type MediaUsageCoverageStatus =
	| "complete"
	| "never"
	| "running"
	| "partial"
	| "failed"
	| "stale"
	| "unknown";

export interface MediaUsageCoverage {
	scope: "all_content_collections";
	status: MediaUsageCoverageStatus;
}

export interface MediaUsageSummary {
	count: number | null;
	coverage: MediaUsageCoverage;
}

export interface MediaUsageOccurrenceDetail {
	fieldSlug: string;
	fieldPath: string;
	occurrenceIndex: number;
	referenceType: "image_field" | "file_field" | "portable_text_image" | "unknown";
}

export interface MediaUsageSourceDetail {
	variant: "columns" | "draft_overlay";
	occurrences: MediaUsageOccurrenceDetail[];
}

export interface MediaUsageEntryDetail {
	collection: string;
	contentId: string;
	title: string | null;
	slug: string | null;
	locale: string | null;
	status: string | null;
	scheduledAt: string | null;
	deletedAt: string | null;
	sources: MediaUsageSourceDetail[];
}

export interface MediaUsageDetailsResponse {
	items: MediaUsageEntryDetail[];
	nextCursor?: string;
	coverage: MediaUsageCoverage;
}

export interface MediaItem {
	id: string;
	filename: string;
	key: string;
	mimeType: string;
	size: number;
	width?: number;
	height?: number;
	focalX?: number | null;
	focalY?: number | null;
	alt?: string;
	caption?: string;
	createdAt: string;
	updatedAt: string;
	folderId?: string | null;
	usage?: MediaUsageSummary;
}

export interface MediaFolderAssignment {
	id: string;
	folderId: string | null;
}

export interface MediaFolder {
	id: string;
	name: string;
}

export type MediaUsageRepairInput = { scope: "collection"; collection: string } | { scope: "all" };

export type MediaUsageRepairStatus = "complete" | "partial" | "failed" | "stale";

export interface MediaUsageRepairCollectionSummary {
	collection: string;
	status: MediaUsageRepairStatus;
	indexedSourceCount: number;
	failedSourceCount: number;
	skippedSourceCount: number;
	deletedSourceCount: number;
	lastErrorCode: string | null;
	startedAt: string;
	completedAt: string | null;
}

export interface MediaUsageRepairResponse {
	status: MediaUsageRepairStatus;
	indexedSourceCount: number;
	failedSourceCount: number;
	skippedSourceCount: number;
	deletedSourceCount: number;
	collections: MediaUsageRepairCollectionSummary[];
}

export interface MediaUsageProgress {
	status: "indexing" | "ready" | "needs_attention";
	readyCollections: number;
	totalCollections: number;
}

export interface MediaUsageProgressAdvanceResponse {
	activation: MediaUsageActivationStatus;
	progress: MediaUsageProgress | null;
	nextRequestInMs: 0 | 30_000 | null;
}

export type MediaUsageWorkState = "pending" | "retry" | "leased" | "failed";

export interface MediaUsageWorkItem {
	collectionId: string;
	collectionSlug: string;
	contentId: string;
	state: MediaUsageWorkState;
	attemptCount: number;
	nextAttemptAt: string;
	leaseExpiresAt: string | null;
	lastAttemptedAt: string | null;
	lastErrorCode: string | null;
	updatedAt: string;
}

export interface MediaUsageWorkListOptions {
	collection: string;
	state?: MediaUsageWorkState;
	limit?: number;
	cursor?: string;
}

export interface MediaUsageWorkListResponse {
	items: MediaUsageWorkItem[];
	nextCursor?: string;
}

export interface MediaUsageWorkRetryInput {
	collectionId: string;
	contentId: string;
}

export interface MediaUsageWorkRetryResponse {
	changed: boolean;
	item: MediaUsageWorkItem;
}

export interface MediaUsageActivationStatus {
	state: "expanded" | "activating" | "active";
	collectionCursor: string | null;
	attemptCount: number;
	drainConfirmedAt: string | null;
	lastAttemptedAt: string | null;
	lastErrorCode: "MEDIA_USAGE_ACTIVATION_FAILED" | null;
	leaseExpiresAt: string | null;
	activatedAt: string | null;
	updatedAt: string;
}

export interface MediaUsageActivationAdvanceInput {
	writersDrained: true;
}

export interface MediaUsageActivationAdvanceResponse {
	outcome: "activating" | "active";
	processedCollections: number;
	activation: MediaUsageActivationStatus;
}

export type MediaUsageCollectionDeletionState = "pending" | "retry" | "leased" | "failed";
export type MediaUsageCollectionDeletionPhase =
	| "fence"
	| "registry"
	| "table"
	| "work"
	| "sources"
	| "status"
	| "finalize";
export interface MediaUsageCollectionDeletionItem {
	collectionId: string;
	collectionSlug: string;
	state: MediaUsageCollectionDeletionState;
	phase: MediaUsageCollectionDeletionPhase;
	attemptCount: number;
	nextAttemptAt: string;
	leaseExpiresAt: string | null;
	lastErrorCode: string | null;
	updatedAt: string;
}
export interface MediaUsageCollectionDeletionListResponse {
	items: MediaUsageCollectionDeletionItem[];
	nextCursor?: string;
}

export interface SearchResult {
	id: string;
	collection: string;
	title: string;
	excerpt?: string;
	score: number;
}

export interface Taxonomy {
	name: string;
	label: string;
	hierarchical: boolean;
}

export interface Term {
	id: string;
	slug: string;
	label: string;
	parentId?: string | null;
	description?: string;
	count?: number;
}

export interface Menu {
	name: string;
	label: string;
}

export interface MenuWithItems extends Menu {
	items: MenuItem[];
}

export interface MenuItem {
	id: string;
	type: string;
	label: string;
	customUrl?: string;
	referenceCollection?: string;
	referenceId?: string;
	target?: string;
	parentId?: string | null;
	sortOrder: number;
}

export interface SchemaExport {
	collections: Array<{
		slug: string;
		label: string;
		labelSingular: string;
		description?: string;
		icon?: string;
		supports: string[];
		fields: Array<{
			slug: string;
			label: string;
			type: string;
			required: boolean;
			unique: boolean;
			defaultValue?: unknown;
			validation?: unknown;
			widget?: string;
			options?: unknown;
		}>;
	}>;
	version: string;
}

export interface Manifest {
	version: string;
	hash: string;
	collections: Record<
		string,
		{
			label: string;
			labelSingular: string;
			supports: string[];
			fields: Record<string, { kind: string; label?: string; required?: boolean }>;
		}
	>;
}

export class EmDashApiError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "EmDashApiError";
	}
}

export class EmDashClientError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EmDashClientError";
	}
}

export class EmDashClient {
	private readonly baseUrl: string;
	private readonly transport: { fetch: (request: Request) => Promise<Response> };

	private fieldSchemaCache = new Map<string, FieldSchema[]>();

	constructor(options: EmDashClientOptions) {
		this.baseUrl = options.baseUrl.replace(TRAILING_SLASH_PATTERN, "");

		const interceptors: Interceptor[] = [csrfInterceptor()];

		if (options.token) {
			interceptors.push(tokenInterceptor(options.token));
		} else if (options.devBypass) {
			interceptors.push(devBypassInterceptor(this.baseUrl));
		}

		if (options.refreshToken) {
			interceptors.push(
				refreshInterceptor({
					refreshToken: options.refreshToken,
					tokenEndpoint: `${this.baseUrl}/_emdash/api/oauth/token/refresh`,
					onTokenRefreshed: options.onTokenRefresh
						? (accessToken, _refreshToken, expiresAt) => {
								const expiresIn = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
								options.onTokenRefresh!(accessToken, expiresIn);
							}
						: undefined,
				}),
			);
		}

		if (options.interceptors) {
			interceptors.push(...options.interceptors);
		}

		this.transport = createTransport({ interceptors });
	}

	async collections(): Promise<Collection[]> {
		const data = await this.request<{ items: Collection[] }>("GET", "/schema/collections");
		return data.items;
	}

	async collection(slug: string): Promise<CollectionWithFields> {
		const data = await this.request<{ item: CollectionWithFields }>(
			"GET",
			`/schema/collections/${encodeURIComponent(slug)}?includeFields=true`,
		);
		const col = data.item;
		if (col.fields) {
			this.fieldSchemaCache.set(
				slug,
				col.fields.map((f) => ({ slug: f.slug, type: f.type })),
			);
		}
		return col;
	}

	async createCollection(input: {
		slug: string;
		label: string;
		labelSingular?: string;
		description?: string;
		icon?: string;
		supports?: string[];
	}): Promise<Collection> {
		const data = await this.request<{ item: Collection }>("POST", "/schema/collections", input);
		return data.item;
	}

	async deleteCollection(slug: string): Promise<void> {
		await this.request<unknown>("DELETE", `/schema/collections/${encodeURIComponent(slug)}`);
	}

	async createField(
		collection: string,
		input: {
			slug: string;
			type: string;
			label: string;
			required?: boolean;
			unique?: boolean;
			defaultValue?: unknown;
			validation?: unknown;
			widget?: string;
			options?: unknown;
			sortOrder?: number;
		},
	): Promise<Field> {
		const data = await this.request<{ item: Field }>(
			"POST",
			`/schema/collections/${encodeURIComponent(collection)}/fields`,
			input,
		);
		this.fieldSchemaCache.delete(collection);
		return data.item;
	}

	async deleteField(collection: string, fieldSlug: string): Promise<void> {
		await this.request<unknown>(
			"DELETE",
			`/schema/collections/${encodeURIComponent(collection)}/fields/${encodeURIComponent(fieldSlug)}`,
		);
		this.fieldSchemaCache.delete(collection);
	}

	async manifest(): Promise<Manifest> {
		return this.request<Manifest>("GET", "/manifest");
	}

	async schemaExport(): Promise<SchemaExport> {
		return this.request<SchemaExport>("GET", "/schema");
	}

	async schemaTypes(): Promise<string> {
		const response = await this.requestRaw("GET", "/schema?format=typescript");
		await this.assertOk(response);
		return response.text();
	}

	async list(
		collection: string,
		options?: {
			status?: string;
			limit?: number;
			cursor?: string;
			orderBy?: string;
			order?: "asc" | "desc";
			locale?: string;
			fieldFilters?: ContentFieldFilters;
		},
	): Promise<ListResult<ContentItem>> {
		const params = new URLSearchParams();
		if (options?.status) params.set("status", options.status);
		if (options?.limit) params.set("limit", String(options.limit));
		if (options?.cursor) params.set("cursor", options.cursor);
		if (options?.orderBy) params.set("orderBy", options.orderBy);
		if (options?.order) params.set("order", options.order);
		if (options?.locale) params.set("locale", options.locale);
		if (options?.fieldFilters && Object.keys(options.fieldFilters).length > 0) {
			params.set("fieldFilters", JSON.stringify(options.fieldFilters));
		}

		const qs = params.toString();
		const path = `/content/${encodeURIComponent(collection)}${qs ? `?${qs}` : ""}`;
		return this.request<ListResult<ContentItem>>("GET", path);
	}

	async *listAll(
		collection: string,
		options?: {
			status?: string;
			limit?: number;
			orderBy?: string;
			order?: "asc" | "desc";
			locale?: string;
			fieldFilters?: ContentFieldFilters;
		},
	): AsyncGenerator<ContentItem> {
		let cursor: string | undefined;
		do {
			const result = await this.list(collection, { ...options, cursor });
			for (const item of result.items) {
				yield item;
			}
			cursor = result.nextCursor;
		} while (cursor);
	}

	async get(
		collection: string,
		id: string,
		options?: { raw?: boolean; locale?: string },
	): Promise<ContentItem> {
		const params = new URLSearchParams();
		if (options?.locale) params.set("locale", options.locale);
		const qs = params.size > 0 ? `?${params}` : "";
		const result = await this.requestRaw(
			"GET",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${qs}`,
		);
		if (!result.ok) {
			await this.assertOk(result);
		}

		const raw = (await result.json()) as { data: { item: ContentItem; _rev?: string } };
		const json = raw.data;
		const item = json.item;

		if (json._rev) {
			item._rev = json._rev;
		}

		if (!options?.raw && item.data) {
			const fields = await this.getFieldSchemas(collection);
			item.data = convertDataForRead(item.data, fields, false);
		}

		return item;
	}

	async create(
		collection: string,
		input: {
			data: Record<string, unknown>;
			slug?: string;
			status?: string;
			locale?: string;
			translationOf?: string;
		},
	): Promise<ContentItem> {
		const fields = await this.getFieldSchemas(collection);
		const data = convertDataForWrite(input.data, fields);

		const result = await this.request<{ item: ContentItem }>(
			"POST",
			`/content/${encodeURIComponent(collection)}`,
			{ ...input, data },
		);
		return result.item;
	}

	async update(
		collection: string,
		id: string,
		input: {
			data?: Record<string, unknown>;
			slug?: string;
			status?: string;
			_rev?: string;
			locale?: string;
		},
	): Promise<ContentItem> {
		let data = input.data;
		if (data) {
			const fields = await this.getFieldSchemas(collection);
			data = convertDataForWrite(data, fields);
		}

		const body = {
			data,
			slug: input.slug,
			status: input.status,
			...(input._rev ? { _rev: input._rev } : {}),
		};
		const params = new URLSearchParams();
		if (input.locale) params.set("locale", input.locale);
		const result = await this.request<{ item: ContentItem; _rev?: string }>(
			"PUT",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}${params.toString() ? `?${params}` : ""}`,
			body,
		);

		const item = result.item;
		if (result._rev) {
			item._rev = result._rev;
		}
		return item;
	}

	async delete(collection: string, id: string): Promise<void> {
		await this.request<unknown>(
			"DELETE",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
		);
	}

	async publish(collection: string, id: string): Promise<void> {
		await this.request<unknown>(
			"POST",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/publish`,
		);
	}

	async unpublish(collection: string, id: string): Promise<void> {
		await this.request<unknown>(
			"POST",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/unpublish`,
		);
	}

	async schedule(collection: string, id: string, options: { at: string }): Promise<void> {
		await this.request<unknown>(
			"POST",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/schedule`,
			{ scheduledAt: options.at },
		);
	}

	async restore(collection: string, id: string): Promise<void> {
		await this.request<unknown>(
			"POST",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/restore`,
		);
	}

	async compare(
		collection: string,
		id: string,
	): Promise<{
		hasChanges: boolean;
		live: Record<string, unknown> | null;
		draft: Record<string, unknown> | null;
	}> {
		return this.request<{
			hasChanges: boolean;
			live: Record<string, unknown> | null;
			draft: Record<string, unknown> | null;
		}>("GET", `/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/compare`);
	}

	async discardDraft(collection: string, id: string): Promise<void> {
		await this.request<unknown>(
			"POST",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/discard-draft`,
		);
	}

	async translations(
		collection: string,
		id: string,
	): Promise<{
		translationGroup: string;
		translations: Array<{
			id: string;
			locale: string | null;
			slug: string | null;
			status: string;
			updatedAt: string;
		}>;
	}> {
		return this.request(
			"GET",
			`/content/${encodeURIComponent(collection)}/${encodeURIComponent(id)}/translations`,
		);
	}

	async mediaList(options?: {
		mimeType?: string;
		limit?: number;
		cursor?: string;
		page?: number;
		includeUsage?: boolean;
		folderId?: string | null;
	}): Promise<ListResult<MediaItem> & { totalCount?: number }> {
		const params = new URLSearchParams();
		if (options?.mimeType) params.set("mimeType", options.mimeType);
		if (options?.limit) params.set("limit", String(options.limit));
		if (options?.cursor) params.set("cursor", options.cursor);
		if (options?.page !== undefined) params.set("page", String(options.page));
		if (options?.includeUsage === true) params.set("includeUsage", "1");
		if (options?.folderId === null) {
			params.set("folderId", "unfiled");
		} else if (options?.folderId !== undefined) {
			params.set("folderId", options.folderId);
		}

		const qs = params.toString();
		return this.request<ListResult<MediaItem> & { totalCount?: number }>(
			"GET",
			`/media${qs ? `?${qs}` : ""}`,
		);
	}

	async mediaGet(id: string, options?: { includeUsage?: boolean }): Promise<MediaItem> {
		const params = new URLSearchParams();
		if (options?.includeUsage === true) params.set("includeUsage", "1");

		const qs = params.toString();
		const data = await this.request<{ item: MediaItem }>(
			"GET",
			`/media/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`,
		);
		return data.item;
	}

	async mediaFolderList(
		options: { limit?: number; cursor?: string; q?: string } = {},
	): Promise<ListResult<MediaFolder>> {
		const params = new URLSearchParams();
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		if (options.cursor !== undefined) params.set("cursor", options.cursor);
		if (options.q !== undefined) params.set("q", options.q);
		const qs = params.toString();
		return this.request<ListResult<MediaFolder>>("GET", `/media/folders${qs ? `?${qs}` : ""}`);
	}

	async mediaFolderGet(id: string): Promise<MediaFolder> {
		const data = await this.request<{ item: MediaFolder }>(
			"GET",
			`/media/folders/${encodeURIComponent(id)}`,
		);
		return data.item;
	}

	async mediaFolderCreate(name: string): Promise<MediaFolder> {
		const data = await this.request<{ item: MediaFolder }>("POST", "/media/folders", { name });
		return data.item;
	}

	async mediaFolderUpdate(id: string, name: string): Promise<MediaFolder> {
		const data = await this.request<{ item: MediaFolder }>(
			"PUT",
			`/media/folders/${encodeURIComponent(id)}`,
			{ name },
		);
		return data.item;
	}

	async mediaFolderDelete(id: string): Promise<void> {
		await this.request<unknown>("DELETE", `/media/folders/${encodeURIComponent(id)}`);
	}

	async mediaSetFolder(id: string, folderId: string | null): Promise<MediaFolderAssignment> {
		const data = await this.request<{ item: MediaFolderAssignment }>(
			"PUT",
			`/media/${encodeURIComponent(id)}`,
			{ folderId },
		);
		return { id: data.item.id, folderId: data.item.folderId };
	}

	async mediaGetUsage(
		id: string,
		options?: { limit?: number; cursor?: string },
	): Promise<MediaUsageDetailsResponse> {
		const params = new URLSearchParams();
		if (options?.limit !== undefined) params.set("limit", String(options.limit));
		if (options?.cursor !== undefined) params.set("cursor", options.cursor);

		const qs = params.toString();
		return this.request<MediaUsageDetailsResponse>(
			"GET",
			`/media/${encodeURIComponent(id)}/usage${qs ? `?${qs}` : ""}`,
		);
	}

	async mediaUpload(
		file: Uint8Array | Blob,
		filename: string,
		options?: { alt?: string; caption?: string; contentType?: string },
	): Promise<MediaItem> {
		const formData = new FormData();

		if (file instanceof Blob) {
			formData.append("file", file, filename);
		} else {
			const mimeType = options?.contentType ?? mimeFromFilename(filename);
			formData.append("file", new Blob([file as BlobPart], { type: mimeType }), filename);
		}

		if (options?.alt) formData.append("alt", options.alt);
		if (options?.caption) formData.append("caption", options.caption);

		const url = `${this.baseUrl}/_emdash/api/media`;
		const request = new Request(url, {
			method: "POST",
			body: formData,
		});

		const response = await this.transport.fetch(request);
		await this.assertOk(response);

		const raw = (await response.json()) as { data: { item: MediaItem } };
		return raw.data.item;
	}

	async mediaDelete(id: string): Promise<void> {
		await this.request<unknown>("DELETE", `/media/${encodeURIComponent(id)}`);
	}

	async mediaRepairUsage(input: MediaUsageRepairInput): Promise<MediaUsageRepairResponse> {
		return this.request<MediaUsageRepairResponse>("POST", "/admin/media-usage/repair", input);
	}

	async mediaGetUsageProgress(): Promise<MediaUsageProgress> {
		return this.request<MediaUsageProgress>("GET", "/admin/media-usage/progress");
	}

	async mediaAdvanceUsageProgress(): Promise<MediaUsageProgressAdvanceResponse> {
		return this.request<MediaUsageProgressAdvanceResponse>("POST", "/admin/media-usage/progress");
	}

	async mediaGetUsageActivation(): Promise<MediaUsageActivationStatus> {
		return this.request<MediaUsageActivationStatus>("GET", "/admin/media-usage/activation");
	}

	async mediaAdvanceUsageActivation(
		input: MediaUsageActivationAdvanceInput,
	): Promise<MediaUsageActivationAdvanceResponse> {
		return this.request<MediaUsageActivationAdvanceResponse>(
			"POST",
			"/admin/media-usage/activation",
			input,
		);
	}

	async mediaListUsageWork(
		options: MediaUsageWorkListOptions,
	): Promise<MediaUsageWorkListResponse> {
		const params = new URLSearchParams({ collection: options.collection });
		if (options.state) params.set("state", options.state);
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		if (options.cursor) params.set("cursor", options.cursor);
		return this.request<MediaUsageWorkListResponse>("GET", `/admin/media-usage/work?${params}`);
	}

	async mediaRetryUsageWork(input: MediaUsageWorkRetryInput): Promise<MediaUsageWorkRetryResponse> {
		return this.request<MediaUsageWorkRetryResponse>(
			"POST",
			"/admin/media-usage/work/retry",
			input,
		);
	}

	async mediaListCollectionDeletions(
		options: {
			state?: MediaUsageCollectionDeletionState;
			limit?: number;
			cursor?: string;
		} = {},
	): Promise<MediaUsageCollectionDeletionListResponse> {
		const params = new URLSearchParams();
		if (options.state) params.set("state", options.state);
		if (options.limit !== undefined) params.set("limit", String(options.limit));
		if (options.cursor) params.set("cursor", options.cursor);
		return this.request("GET", `/admin/media-usage/collection-deletions?${params}`);
	}

	async mediaRetryCollectionDeletion(collectionId: string): Promise<{
		changed: boolean;
		item: MediaUsageCollectionDeletionItem;
	}> {
		return this.request("POST", "/admin/media-usage/collection-deletions/retry", {
			collectionId,
		});
	}

	async search(
		query: string,
		options?: { collection?: string; locale?: string; limit?: number },
	): Promise<SearchResult[]> {
		const params = new URLSearchParams({ q: query });
		if (options?.collection) params.set("collections", options.collection);
		if (options?.locale) params.set("locale", options.locale);
		if (options?.limit) params.set("limit", String(options.limit));

		const data = await this.request<{ items: SearchResult[] }>("GET", `/search?${params}`);
		return data.items;
	}

	async taxonomies(): Promise<Taxonomy[]> {
		const data = await this.request<{ taxonomies: Taxonomy[] }>("GET", "/taxonomies");
		return data.taxonomies;
	}

	async terms(
		taxonomy: string,
		options?: { limit?: number; cursor?: string },
	): Promise<ListResult<Term>> {
		const params = new URLSearchParams();
		if (options?.limit) params.set("limit", String(options.limit));
		if (options?.cursor) params.set("cursor", options.cursor);

		const qs = params.toString();
		const data = await this.request<{ terms: Term[] }>(
			"GET",
			`/taxonomies/${encodeURIComponent(taxonomy)}/terms${qs ? `?${qs}` : ""}`,
		);
		return { items: data.terms };
	}

	async createTerm(
		taxonomy: string,
		input: { slug: string; label: string; parentId?: string; description?: string },
	): Promise<Term> {
		return this.request<Term>("POST", `/taxonomies/${encodeURIComponent(taxonomy)}/terms`, input);
	}

	async menus(): Promise<Menu[]> {
		return this.request<Menu[]>("GET", "/menus");
	}

	async menu(name: string): Promise<MenuWithItems> {
		return this.request<MenuWithItems>("GET", `/menus/${encodeURIComponent(name)}`);
	}

	private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await this.requestRaw(method, path, body);
		await this.assertOk(response);
		const json = (await response.json()) as { data: T };
		return json.data;
	}

	private async requestRaw(method: string, path: string, body?: unknown): Promise<Response> {
		const url = `${this.baseUrl}/_emdash/api${path}`;
		const headers: Record<string, string> = {
			Accept: "application/json",
		};

		let requestBody: string | undefined;
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			requestBody = JSON.stringify(body);
		}

		const request = new Request(url, {
			method,
			headers,
			body: requestBody,
		});

		return this.transport.fetch(request);
	}

	private async assertOk(response: Response): Promise<void> {
		if (response.ok) return;

		let code = "UNKNOWN_ERROR";
		let message = `HTTP ${response.status}`;
		let details: Record<string, unknown> | undefined;

		try {
			const json = (await response.json()) as {
				error?: { code?: string; message?: string; details?: Record<string, unknown> };
			};
			if (json.error) {
				code = json.error.code ?? code;
				message = json.error.message ?? message;
				details = json.error.details;
			}
		} catch {
			message = response.statusText || message;
		}

		throw new EmDashApiError(response.status, code, message, details);
	}

	private async getFieldSchemas(collection: string): Promise<FieldSchema[]> {
		let cached = this.fieldSchemaCache.get(collection);
		if (cached) return cached;

		try {
			const col = await this.collection(collection);
			cached = col.fields.map((f) => ({ slug: f.slug, type: f.type }));
			this.fieldSchemaCache.set(collection, cached);
			return cached;
		} catch {
			return [];
		}
	}
}

type _AssertTrue<T extends true> = T;
type _MediaRepairUsageRequiresExplicitInput = _AssertTrue<
	Parameters<EmDashClient["mediaRepairUsage"]> extends [MediaUsageRepairInput] ? true : false
>;

export type { Interceptor } from "./transport.js";
export {
	createTransport,
	csrfInterceptor,
	tokenInterceptor,
	devBypassInterceptor,
} from "./transport.js";
export { portableTextToMarkdown, markdownToPortableText } from "./portable-text.js";
export type { PortableTextBlock } from "./portable-text.js";
