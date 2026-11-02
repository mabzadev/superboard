import type { Permission } from "@emdash-cms/auth";
import type { Element } from "@emdash-cms/blocks";
import {
	CAPABILITY_RENAMES,
	capabilitiesToDeclaredAccess,
	declaredAccessToCapabilities,
	isDeprecatedCapability,
	normalizeCapabilities,
	normalizeCapability,
	type CurrentPluginCapability,
	type DeclaredAccess,
	type DeprecatedPluginCapability,
	type ManifestHookEntry,
	type ManifestMcpTool,
	type ManifestRouteEntry,
	type PluginMcpManifestConfig,
	type PluginCapability,
	type PluginStorageConfig,
	type StorageCollectionConfig,
} from "@emdash-cms/plugin-types";
import type { JSX } from "astro/jsx-runtime";
import type { z } from "astro/zod";

import type { ContentFieldFilters } from "../content-list-query.js";
import type { FieldType } from "../schema/types.js";

export type {
	ContentFieldFilterScalar,
	ContentFieldFilterValue,
	ContentFieldFilters,
	ContentFieldInFilter,
	ContentFieldRangeFilter,
} from "../content-list-query.js";

export {
	CAPABILITY_RENAMES,
	capabilitiesToDeclaredAccess,
	declaredAccessToCapabilities,
	isDeprecatedCapability,
	normalizeCapabilities,
	normalizeCapability,
	type CurrentPluginCapability,
	type DeclaredAccess,
	type DeprecatedPluginCapability,
	type ManifestHookEntry,
	type ManifestMcpTool,
	type ManifestRouteEntry,
	type PluginMcpManifestConfig,
	type PluginCapability,
	type PluginStorageConfig,
	type StorageCollectionConfig,
};

export interface RangeFilter {
	gt?: number | string;
	gte?: number | string;
	lt?: number | string;
	lte?: number | string;
}

export interface InFilter {
	in: Array<string | number>;
}

export interface StartsWithFilter {
	startsWith: string;
}

export type WhereValue =
	| string
	| number
	| boolean
	| null
	| RangeFilter
	| InFilter
	| StartsWithFilter;

export type WhereClause = Record<string, WhereValue>;

export interface QueryOptions {
	where?: WhereClause;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	cursor?: string;
}

export interface PaginatedResult<T> {
	items: T[];
	cursor?: string;
	hasMore: boolean;
}

export interface StorageCollection<T = unknown> {
	get(id: string): Promise<T | null>;
	put(id: string, data: T): Promise<void>;
	delete(id: string): Promise<boolean>;
	exists(id: string): Promise<boolean>;

	getMany(ids: string[]): Promise<Map<string, T>>;
	putMany(items: Array<{ id: string; data: T }>): Promise<void>;
	deleteMany(ids: string[]): Promise<number>;

	query(options?: QueryOptions): Promise<PaginatedResult<{ id: string; data: T }>>;
	count(where?: WhereClause): Promise<number>;
}

export type PluginStorage<T extends PluginStorageConfig> = {
	[K in keyof T]: StorageCollection;
};

export interface KVAccess {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<boolean>;
	list(prefix?: string): Promise<Array<{ key: string; value: unknown }>>;
}

export interface ContentItemSeo {
	title: string | null;
	description: string | null;
	image: string | null;
	canonical: string | null;
	noIndex: boolean;
}

export interface ContentItemSeoInput {
	title?: string | null;
	description?: string | null;
	image?: string | null;
	canonical?: string | null;
	noIndex?: boolean;
}

export interface ContentItem {
	id: string;
	type: string;
	slug: string | null;
	status: string;
	locale: string | null;
	data: Record<string, unknown>;
	seo?: ContentItemSeo;
	createdAt: string;
	updatedAt: string;
	publishedAt: string | null;
	scheduledAt?: string | null;
}

export interface ContentListWhere {
	status?: string;
	locale?: string;
	fieldFilters?: ContentFieldFilters;
}

export interface ContentListOptions {
	limit?: number;
	cursor?: string;
	orderBy?: Record<string, "asc" | "desc">;
	where?: ContentListWhere;
}

export type ContentWriteInput = Record<string, unknown> & {
	seo?: ContentItemSeoInput;
};

export interface ContentCreateOptions {
	locale?: string;
}

export interface TaxonomyDefInfo {
	name: string;
	label: string;
	labelSingular: string | null;
	hierarchical: boolean;
	collections: string[];
	locale: string;
}

export interface TaxonomyTermInfo {
	id: string;
	taxonomy: string;
	slug: string;
	label: string;
	parentId: string | null;
	data: Record<string, unknown> | null;
	locale: string;
	translationGroup: string | null;
}

export interface TaxonomyReadOptions {
	locale?: string;
}

export interface ContentAccess {
	get(collection: string, id: string): Promise<ContentItem | null>;
	list(collection: string, options?: ContentListOptions): Promise<PaginatedResult<ContentItem>>;

	create?(
		collection: string,
		data: ContentWriteInput,
		options?: ContentCreateOptions,
	): Promise<ContentItem>;
	update?(collection: string, id: string, data: ContentWriteInput): Promise<ContentItem>;
	delete?(collection: string, id: string): Promise<boolean>;
}

export interface TaxonomyAccess {
	getAll(options?: TaxonomyReadOptions): Promise<TaxonomyDefInfo[]>;
	getTerms(taxonomy: string, options?: TaxonomyReadOptions): Promise<TaxonomyTermInfo[]>;
	getEntryTerms(
		collection: string,
		entryId: string,
		options?: TaxonomyReadOptions & { taxonomy?: string },
	): Promise<TaxonomyTermInfo[]>;
}

export interface ContentAccessWithWrite extends ContentAccess {
	create(
		collection: string,
		data: ContentWriteInput,
		options?: ContentCreateOptions,
	): Promise<ContentItem>;
	update(collection: string, id: string, data: ContentWriteInput): Promise<ContentItem>;
	delete(collection: string, id: string): Promise<boolean>;
}

export interface MediaItem {
	id: string;
	filename: string;
	mimeType: string;
	size: number | null;
	url: string;
	createdAt: string;
}

export interface MediaListOptions {
	limit?: number;
	cursor?: string;
	mimeType?: string;
}

export interface MediaAccess {
	get(id: string): Promise<MediaItem | null>;
	list(options?: MediaListOptions): Promise<PaginatedResult<MediaItem>>;

	getUploadUrl?(
		filename: string,
		contentType: string,
	): Promise<{ uploadUrl: string; mediaId: string }>;
	upload?(
		filename: string,
		contentType: string,
		bytes: ArrayBuffer,
	): Promise<{ mediaId: string; storageKey: string; url: string }>;
	delete?(id: string): Promise<boolean>;
}

export interface MediaAccessWithWrite extends MediaAccess {
	getUploadUrl(
		filename: string,
		contentType: string,
	): Promise<{ uploadUrl: string; mediaId: string }>;
	upload(
		filename: string,
		contentType: string,
		bytes: ArrayBuffer,
	): Promise<{ mediaId: string; storageKey: string; url: string }>;
	delete(id: string): Promise<boolean>;
}

export interface HttpAccess {
	fetch(url: string, init?: RequestInit): Promise<Response>;
}

export interface LogAccess {
	debug(message: string, data?: unknown): void;
	info(message: string, data?: unknown): void;
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}

export interface SiteInfo {
	name: string;
	url: string;
	locale: string;
	trailingSlash?: "always" | "never" | "ignore";
}

export interface UserInfo {
	id: string;
	email: string;
	name: string | null;
	role: number;
	createdAt: string;
}

export interface UserAccess {
	get(id: string): Promise<UserInfo | null>;
	getByEmail(email: string): Promise<UserInfo | null>;
	list(opts?: { role?: number; limit?: number; cursor?: string }): Promise<{
		items: UserInfo[];
		nextCursor?: string;
	}>;
}

export interface PluginContext<TStorage extends PluginStorageConfig = PluginStorageConfig> {
	plugin: {
		id: string;
		version: string;
	};

	storage: PluginStorage<TStorage>;

	kv: KVAccess;

	content?: ContentAccess | ContentAccessWithWrite;

	taxonomies?: TaxonomyAccess;

	media?: MediaAccess | MediaAccessWithWrite;

	http?: HttpAccess;

	log: LogAccess;

	site: SiteInfo;

	url(path: string): string;

	users?: UserAccess;

	cron?: CronAccess;

	email?: EmailAccess;
}

export interface CronAccess {
	schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }): Promise<void>;
	cancel(name: string): Promise<void>;
	list(): Promise<CronTaskInfo[]>;
}

export interface CronTaskInfo {
	name: string;
	schedule: string;
	nextRunAt: string;
	lastRunAt: string | null;
}

export interface CronEvent {
	name: string;
	data?: Record<string, unknown>;
	scheduledAt: string;
}

export type CronHandler = (event: CronEvent, ctx: PluginContext) => Promise<void>;

export interface EmailAccess {
	send(message: EmailMessage): Promise<void>;
}

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
}

export interface EmailBeforeSendEvent {
	message: EmailMessage;
	source: string;
}

export interface EmailDeliverEvent {
	message: EmailMessage;
	source: string;
}

export interface EmailAfterSendEvent {
	message: EmailMessage;
	source: string;
}

export type EmailBeforeSendHandler = (
	event: EmailBeforeSendEvent,
	ctx: PluginContext,
) => Promise<EmailMessage | false>;

export type EmailDeliverHandler = (event: EmailDeliverEvent, ctx: PluginContext) => Promise<void>;

export type EmailAfterSendHandler = (
	event: EmailAfterSendEvent,
	ctx: PluginContext,
) => Promise<void>;

export interface CollectionCommentSettings {
	commentsEnabled: boolean;
	commentsModeration: "all" | "first_time" | "none";
	commentsClosedAfterDays: number;
	commentsAutoApproveUsers: boolean;
}

export interface CommentBeforeCreateEvent {
	comment: {
		collection: string;
		contentId: string;
		parentId: string | null;
		authorName: string;
		authorEmail: string;
		authorUserId: string | null;
		body: string;
		ipHash: string | null;
		userAgent: string | null;
	};
	metadata: Record<string, unknown>;
}

export interface CommentModerateEvent {
	comment: CommentBeforeCreateEvent["comment"];
	metadata: Record<string, unknown>;
	collectionSettings: CollectionCommentSettings;
	priorApprovedCount: number;
}

export interface ModerationDecision {
	status: "approved" | "pending" | "spam";
	reason?: string;
}

export interface StoredComment {
	id: string;
	collection: string;
	contentId: string;
	parentId: string | null;
	authorName: string;
	authorEmail: string;
	authorUserId: string | null;
	body: string;
	status: string;
	moderationMetadata: Record<string, unknown> | null;
	createdAt: string;
	updatedAt: string;
}

export interface CommentAfterCreateEvent {
	comment: StoredComment;
	metadata: Record<string, unknown>;
	content: { id: string; collection: string; slug: string; title?: string };
	contentAuthor?: { id: string; name: string | null; email: string };
}

export interface CommentAfterModerateEvent {
	comment: StoredComment;
	previousStatus: string;
	newStatus: string;
	moderator: { id: string; name: string | null };
}

export type CommentBeforeCreateHandler = (
	event: CommentBeforeCreateEvent,
	ctx: PluginContext,
) => Promise<CommentBeforeCreateEvent | false | void>;

export type CommentModerateHandler = (
	event: CommentModerateEvent,
	ctx: PluginContext,
) => Promise<ModerationDecision>;

export type CommentAfterCreateHandler = (
	event: CommentAfterCreateEvent,
	ctx: PluginContext,
) => Promise<void>;

export type CommentAfterModerateHandler = (
	event: CommentAfterModerateEvent,
	ctx: PluginContext,
) => Promise<void>;

export interface HookConfig<THandler> {
	priority?: number;
	timeout?: number;
	dependencies?: string[];
	errorPolicy?: "continue" | "abort";
	exclusive?: boolean;
	handler: THandler;
}

export interface ContentHookEvent {
	content: Record<string, unknown>;
	collection: string;
	isNew: boolean;
}

export interface ContentDeleteEvent {
	id: string;
	collection: string;
	permanent: boolean;
}

export interface ContentStateChangeEvent {
	content: Record<string, unknown>;
	collection: string;
}

export type ContentPublishStateChangeEvent = ContentStateChangeEvent;

export type ContentRestoreStateChangeEvent = ContentStateChangeEvent;

export type ContentScheduleStateChangeEvent = ContentStateChangeEvent;

export interface MediaUploadEvent {
	file: { name: string; type: string; size: number };
}

export interface MediaAfterUploadEvent {
	media: MediaItem;
}

export interface LifecycleEvent {}

export interface UninstallEvent {
	deleteData: boolean;
}

export type ContentBeforeSaveHandler = (
	event: ContentHookEvent,
	ctx: PluginContext,
) => Promise<Record<string, unknown> | void>;

export type ContentAfterSaveHandler = (
	event: ContentHookEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentBeforeDeleteHandler = (
	event: ContentDeleteEvent,
	ctx: PluginContext,
) => Promise<boolean | void>;

export type ContentAfterDeleteHandler = (
	event: ContentDeleteEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentAfterPublishHandler = (
	event: ContentPublishStateChangeEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentAfterUnpublishHandler = (
	event: ContentPublishStateChangeEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentAfterRestoreHandler = (
	event: ContentRestoreStateChangeEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentAfterScheduleHandler = (
	event: ContentScheduleStateChangeEvent,
	ctx: PluginContext,
) => Promise<void>;

export type ContentAfterUnscheduleHandler = (
	event: ContentScheduleStateChangeEvent,
	ctx: PluginContext,
) => Promise<void>;

export type MediaBeforeUploadHandler = (
	event: MediaUploadEvent,
	ctx: PluginContext,
) => Promise<{ name: string; type: string; size: number } | void>;

export type MediaAfterUploadHandler = (
	event: MediaAfterUploadEvent,
	ctx: PluginContext,
) => Promise<void>;

export type LifecycleHandler = (event: LifecycleEvent, ctx: PluginContext) => Promise<void>;

export type UninstallHandler = (event: UninstallEvent, ctx: PluginContext) => Promise<void>;

export type PagePlacement = "head" | "body:start" | "body:end";

export interface BreadcrumbItem {
	name: string;
	url: string;
}

export interface PublicPageContext {
	url: string;
	path: string;
	locale: string | null;
	kind: "content" | "custom";
	pageType: string;
	title: string | null;
	pageTitle?: string | null;
	description: string | null;
	canonical: string | null;
	image: string | null;
	content?: {
		collection: string;
		id: string;
		slug: string | null;
	};
	seo?: {
		ogTitle?: string | null;
		ogDescription?: string | null;
		ogImage?: string | null;
		robots?: string | null;
	};
	articleMeta?: {
		publishedTime?: string | null;
		modifiedTime?: string | null;
		author?: string | null;
	};
	siteName?: string;
	breadcrumbs?: BreadcrumbItem[];
	siteUrl?: string;
}

export interface PageMetadataEvent {
	page: PublicPageContext;
}

export type PageMetadataLinkRel =
	| "canonical"
	| "alternate"
	| "author"
	| "license"
	| "nlweb"
	| "site.standard.document";

export type PageMetadataContribution =
	| { kind: "meta"; name: string; content: string; key?: string }
	| { kind: "property"; property: string; content: string; key?: string }
	| { kind: "link"; rel: PageMetadataLinkRel; href: string; hreflang?: string; key?: string }
	| {
			kind: "jsonld";
			id?: string;
			graph: Record<string, unknown> | Array<Record<string, unknown>>;
	  };

export type PageMetadataHandler = (
	event: PageMetadataEvent,
	ctx: PluginContext,
) =>
	| PageMetadataContribution
	| PageMetadataContribution[]
	| null
	| Promise<PageMetadataContribution | PageMetadataContribution[] | null>;

export interface PageFragmentEvent {
	page: PublicPageContext;
}

export type PageFragmentContribution =
	| {
			kind: "external-script";
			placement: PagePlacement;
			src: string;
			async?: boolean;
			defer?: boolean;
			attributes?: Record<string, string>;
			key?: string;
	  }
	| {
			kind: "inline-script";
			placement: PagePlacement;
			code: string;
			attributes?: Record<string, string>;
			key?: string;
	  }
	| {
			kind: "html";
			placement: PagePlacement;
			html: string;
			key?: string;
	  };

export type PageFragmentHandler = (
	event: PageFragmentEvent,
	ctx: PluginContext,
) =>
	| PageFragmentContribution
	| PageFragmentContribution[]
	| null
	| Promise<PageFragmentContribution | PageFragmentContribution[] | null>;

export interface PluginHooks {
	"plugin:install"?: HookConfig<LifecycleHandler> | LifecycleHandler;
	"plugin:activate"?: HookConfig<LifecycleHandler> | LifecycleHandler;
	"plugin:deactivate"?: HookConfig<LifecycleHandler> | LifecycleHandler;
	"plugin:uninstall"?: HookConfig<UninstallHandler> | UninstallHandler;

	"content:beforeSave"?: HookConfig<ContentBeforeSaveHandler> | ContentBeforeSaveHandler;
	"content:afterSave"?: HookConfig<ContentAfterSaveHandler> | ContentAfterSaveHandler;
	"content:beforeDelete"?: HookConfig<ContentBeforeDeleteHandler> | ContentBeforeDeleteHandler;
	"content:afterDelete"?: HookConfig<ContentAfterDeleteHandler> | ContentAfterDeleteHandler;
	"content:afterPublish"?: HookConfig<ContentAfterPublishHandler> | ContentAfterPublishHandler;
	"content:afterUnpublish"?:
		| HookConfig<ContentAfterUnpublishHandler>
		| ContentAfterUnpublishHandler;
	"content:afterRestore"?: HookConfig<ContentAfterRestoreHandler> | ContentAfterRestoreHandler;
	"content:afterSchedule"?: HookConfig<ContentAfterScheduleHandler> | ContentAfterScheduleHandler;
	"content:afterUnschedule"?:
		| HookConfig<ContentAfterUnscheduleHandler>
		| ContentAfterUnscheduleHandler;

	"media:beforeUpload"?: HookConfig<MediaBeforeUploadHandler> | MediaBeforeUploadHandler;
	"media:afterUpload"?: HookConfig<MediaAfterUploadHandler> | MediaAfterUploadHandler;

	cron?: HookConfig<CronHandler> | CronHandler;

	"email:beforeSend"?: HookConfig<EmailBeforeSendHandler> | EmailBeforeSendHandler;
	"email:deliver"?: HookConfig<EmailDeliverHandler> | EmailDeliverHandler;
	"email:afterSend"?: HookConfig<EmailAfterSendHandler> | EmailAfterSendHandler;

	"comment:beforeCreate"?: HookConfig<CommentBeforeCreateHandler> | CommentBeforeCreateHandler;
	"comment:moderate"?: HookConfig<CommentModerateHandler> | CommentModerateHandler;
	"comment:afterCreate"?: HookConfig<CommentAfterCreateHandler> | CommentAfterCreateHandler;
	"comment:afterModerate"?: HookConfig<CommentAfterModerateHandler> | CommentAfterModerateHandler;

	"page:metadata"?: HookConfig<PageMetadataHandler> | PageMetadataHandler;
	"page:fragments"?: HookConfig<PageFragmentHandler> | PageFragmentHandler;
}

export type HookName = keyof PluginHooks;

export interface ResolvedHook<THandler> {
	priority: number;
	timeout: number;
	dependencies: string[];
	errorPolicy: "continue" | "abort";
	exclusive: boolean;
	handler: THandler;
	pluginId: string;
}

export interface GeoInfo {
	country: string | null;
	region: string | null;
	city: string | null;
}

export interface RequestMeta {
	ip: string | null;
	userAgent: string | null;
	referer: string | null;
	geo: GeoInfo | null;
}

export interface RouteContext<TInput = unknown> extends PluginContext {
	input: TInput;
	request: Request;
	requestMeta: RequestMeta;
	user?: UserInfo;
}

export interface PluginRoute<TInput = unknown> {
	input?: z.ZodType<TInput>;
	public?: boolean;
	permission?: Permission;
	cacheControl?: string;
	handler: (ctx: RouteContext<TInput>) => Promise<unknown>;
}

export interface PluginMcpToolDefinition {
	description: string;
	route: string;
	input: z.ZodType;
	output?: z.ZodType;
	destructive?: boolean;
}

export interface PluginMcpConfig {
	tools: Record<string, PluginMcpToolDefinition>;
}

export interface PluginAdminPage {
	path: string;
	label: string;
	icon?: string;
}

export interface PluginDashboardWidget {
	id: string;
	size?: "full" | "half" | "third";
	title?: string;
}

export type SettingFieldType =
	| "string"
	| "number"
	| "boolean"
	| "select"
	| "secret"
	| "url"
	| "email";

export interface BaseSettingField {
	type: SettingFieldType;
	label: string;
	description?: string;
}

export interface StringSettingField extends BaseSettingField {
	type: "string";
	default?: string;
	multiline?: boolean;
}

export interface NumberSettingField extends BaseSettingField {
	type: "number";
	default?: number;
	min?: number;
	max?: number;
}

export interface BooleanSettingField extends BaseSettingField {
	type: "boolean";
	default?: boolean;
}

export interface SelectSettingField extends BaseSettingField {
	type: "select";
	options: Array<{ value: string; label: string }>;
	default?: string;
}

export interface SecretSettingField extends BaseSettingField {
	type: "secret";
}

export interface UrlSettingField extends BaseSettingField {
	type: "url";
	default?: string;
	placeholder?: string;
}

export interface EmailSettingField extends BaseSettingField {
	type: "email";
	default?: string;
	placeholder?: string;
}

export type SettingField =
	| StringSettingField
	| NumberSettingField
	| BooleanSettingField
	| SelectSettingField
	| SecretSettingField
	| UrlSettingField
	| EmailSettingField;

export type PortableTextBlockField = Element;

export interface PortableTextBlockConfig {
	type: string;
	label: string;
	icon?: string;
	description?: string;
	placeholder?: string;
	fields?: PortableTextBlockField[];
	category?: string;
}

export interface FieldWidgetConfig {
	name: string;
	label: string;
	fieldTypes: FieldType[];
	elements?: Element[];
}

export interface PluginAdminConfig {
	entry?: string;
	settingsSchema?: Record<string, SettingField>;
	pages?: PluginAdminPage[];
	widgets?: PluginDashboardWidget[];
	portableTextBlocks?: PortableTextBlockConfig[];
	fieldWidgets?: FieldWidgetConfig[];
}

export interface PluginDefinition<TStorage extends PluginStorageConfig = PluginStorageConfig> {
	id: string;
	version: string;

	capabilities?: PluginCapability[];

	allowedHosts?: string[];

	storage?: TStorage;

	hooks?: PluginHooks;

	routes?: Record<string, PluginRoute>;

	mcp?: PluginMcpConfig;

	admin?: PluginAdminConfig;
}

export interface ResolvedPlugin<TStorage extends PluginStorageConfig = PluginStorageConfig> {
	id: string;
	version: string;
	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: TStorage;
	hooks: ResolvedPluginHooks;
	routes: Record<string, PluginRoute>;
	mcp?: PluginMcpConfig;
	admin: PluginAdminConfig;
}

export interface ResolvedPluginHooks {
	"plugin:install"?: ResolvedHook<LifecycleHandler>;
	"plugin:activate"?: ResolvedHook<LifecycleHandler>;
	"plugin:deactivate"?: ResolvedHook<LifecycleHandler>;
	"plugin:uninstall"?: ResolvedHook<UninstallHandler>;
	"content:beforeSave"?: ResolvedHook<ContentBeforeSaveHandler>;
	"content:afterSave"?: ResolvedHook<ContentAfterSaveHandler>;
	"content:beforeDelete"?: ResolvedHook<ContentBeforeDeleteHandler>;
	"content:afterDelete"?: ResolvedHook<ContentAfterDeleteHandler>;
	"content:afterPublish"?: ResolvedHook<ContentAfterPublishHandler>;
	"content:afterUnpublish"?: ResolvedHook<ContentAfterUnpublishHandler>;
	"content:afterRestore"?: ResolvedHook<ContentAfterRestoreHandler>;
	"content:afterSchedule"?: ResolvedHook<ContentAfterScheduleHandler>;
	"content:afterUnschedule"?: ResolvedHook<ContentAfterUnscheduleHandler>;
	"media:beforeUpload"?: ResolvedHook<MediaBeforeUploadHandler>;
	"media:afterUpload"?: ResolvedHook<MediaAfterUploadHandler>;
	cron?: ResolvedHook<CronHandler>;
	"email:beforeSend"?: ResolvedHook<EmailBeforeSendHandler>;
	"email:deliver"?: ResolvedHook<EmailDeliverHandler>;
	"email:afterSend"?: ResolvedHook<EmailAfterSendHandler>;
	"comment:beforeCreate"?: ResolvedHook<CommentBeforeCreateHandler>;
	"comment:moderate"?: ResolvedHook<CommentModerateHandler>;
	"comment:afterCreate"?: ResolvedHook<CommentAfterCreateHandler>;
	"comment:afterModerate"?: ResolvedHook<CommentAfterModerateHandler>;
	"page:metadata"?: ResolvedHook<PageMetadataHandler>;
	"page:fragments"?: ResolvedHook<PageFragmentHandler>;
}

export interface PluginAdminExports {
	widgets?: Record<string, JSX.Element>;
	pages?: Record<string, JSX.Element>;
	fields?: Record<string, JSX.Element>;
}

export interface PluginManifest {
	id: string;
	version: string;
	declaredAccess?: DeclaredAccess;
	capabilities: PluginCapability[];
	allowedHosts: string[];
	storage: PluginStorageConfig;
	hooks: Array<ManifestHookEntry | HookName>;
	routes: Array<ManifestRouteEntry | string>;
	mcp?: PluginMcpManifestConfig;
	admin: PluginAdminConfig;
}

type _AssertManifestCompat =
	PluginManifest extends import("@emdash-cms/plugin-types").PluginManifest ? true : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _MANIFEST_COMPAT: _AssertManifestCompat = true;
