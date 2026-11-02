import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { ContentCreateOptions } from "emdash";

export interface CloudflareSandboxEnv {
	LOADER?: WorkerLoader;
	DB: D1Database;
	PLUGINS?: R2Bucket;
}

export interface WorkerLoader {
	get(name: string, config: () => WorkerLoaderConfig | Promise<WorkerLoaderConfig>): WorkerStub;
}

export interface WorkerLoaderConfig {
	compatibilityDate?: string;
	mainModule: string;
	modules: Record<string, string | { js: string }>;
	env?: Record<string, unknown>;
	globalOutbound?: null | object;
	limits?: WorkerLoaderLimits;
}

export interface WorkerLoaderLimits {
	cpuMs?: number;
	subRequests?: number;
}

export interface WorkerStub {
	fetch(request: Request): Promise<Response>;

	getEntrypoint<T = unknown>(name?: string): T;
}

export interface LoadedPluginManifest {
	id: string;
	version: string;
	capabilities: string[];
	allowedHosts: string[];
	storage: Record<string, { indexes: Array<string | string[]> }>;
	hooks: string[];
	routes: string[];
}

interface BridgeContentItem {
	id: string;
	type: string;
	data: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
	locale: string;
}

interface BridgeTaxonomyDef {
	name: string;
	label: string;
	labelSingular: string | null;
	hierarchical: boolean;
	collections: string[];
	locale: string;
}

interface BridgeTaxonomyTerm {
	id: string;
	taxonomy: string;
	slug: string;
	label: string;
	parentId: string | null;
	data: Record<string, unknown> | null;
	locale: string;
	translationGroup: string | null;
}

interface BridgeMediaItem {
	id: string;
	filename: string;
	mimeType: string;
	size: number | null;
	url: string;
	createdAt: string;
}

export interface PluginBridgeBinding {
	kvGet(key: string): Promise<unknown>;
	kvSet(key: string, value: unknown): Promise<void>;
	kvDelete(key: string): Promise<boolean>;
	kvList(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
	storageGet(collection: string, id: string): Promise<unknown>;
	storagePut(collection: string, id: string, data: unknown): Promise<void>;
	storageDelete(collection: string, id: string): Promise<boolean>;
	storageQuery(
		collection: string,
		opts?: { limit?: number; cursor?: string },
	): Promise<{ items: Array<{ id: string; data: unknown }>; hasMore: boolean; cursor?: string }>;
	storageCount(collection: string): Promise<number>;
	storageGetMany(collection: string, ids: string[]): Promise<Map<string, unknown>>;
	storagePutMany(collection: string, items: Array<{ id: string; data: unknown }>): Promise<void>;
	storageDeleteMany(collection: string, ids: string[]): Promise<number>;
	contentGet(collection: string, id: string): Promise<BridgeContentItem | null>;
	contentList(
		collection: string,
		opts?: { limit?: number; cursor?: string },
	): Promise<{ items: BridgeContentItem[]; cursor?: string; hasMore: boolean }>;
	contentCreate(
		collection: string,
		data: Record<string, unknown>,
		options?: ContentCreateOptions,
	): Promise<BridgeContentItem>;
	contentUpdate(
		collection: string,
		id: string,
		data: Record<string, unknown>,
	): Promise<BridgeContentItem>;
	contentDelete(collection: string, id: string): Promise<boolean>;
	taxonomyList(opts?: { locale?: string }): Promise<BridgeTaxonomyDef[]>;
	taxonomyTerms(taxonomy: string, opts?: { locale?: string }): Promise<BridgeTaxonomyTerm[]>;
	taxonomyEntryTerms(
		collection: string,
		entryId: string,
		opts?: { taxonomy?: string; locale?: string },
	): Promise<BridgeTaxonomyTerm[]>;
	mediaGet(id: string): Promise<BridgeMediaItem | null>;
	mediaList(opts?: {
		limit?: number;
		cursor?: string;
		mimeType?: string;
	}): Promise<{ items: BridgeMediaItem[]; cursor?: string; hasMore: boolean }>;
	mediaUpload(
		filename: string,
		contentType: string,
		bytes: ArrayBuffer,
	): Promise<{ mediaId: string; storageKey: string; url: string }>;
	mediaDelete(id: string): Promise<boolean>;
	httpFetch(
		url: string,
		init?: RequestInit,
	): Promise<{ status: number; headers: Record<string, string>; text: string }>;
	emailSend(message: { to: string; subject: string; text: string; html?: string }): Promise<void>;
	log(level: "debug" | "info" | "warn" | "error", msg: string, data?: unknown): void;
}
