import type { Element } from "@emdash-cms/blocks";
import type { Kysely } from "kysely";

import type { ContentFieldFilters } from "../content-list-query.js";
import type { RouteCallerInput, RouteMeta } from "../plugins/routes.js";

export type {
	ContentItem,
	MediaItem,
	ContentListResponse,
	ContentResponse,
	MediaListResponse,
	MediaResponse,
	Storage,
	Database,
} from "../index.js";

export interface ManifestCollection {
	label: string;
	labelSingular: string;
	supports: string[];
	hasSeo: boolean;
	urlPattern?: string;
	routable?: boolean;
	titleField?: string;
	dateField?: string;
	hidden?: boolean;
	listColumns?: string[];
	fields: Record<
		string,
		{
			kind: string;
			label?: string;
			required?: boolean;
			widget?: string;
			options?: Array<{ value: string; label: string }> | Record<string, unknown>;
			id?: string;
			validation?: Record<string, unknown>;
		}
	>;
}

export interface ManifestPlugin {
	version?: string;
	package?: string;
	enabled?: boolean;
	adminMode?: "react" | "blocks" | "none";
	adminPages?: Array<{
		path: string;
		label?: string;
		icon?: string;
	}>;
	dashboardWidgets?: Array<{
		id: string;
		title?: string;
		size?: string;
	}>;
	fieldWidgets?: Array<{
		name: string;
		label: string;
		fieldTypes: string[];
		elements?: Element[];
	}>;
	portableTextBlocks?: Array<{
		type: string;
		label: string;
		icon?: string;
		description?: string;
		placeholder?: string;
		fields?: Element[];
	}>;
}

export type ManifestAuthMode = string;

export interface EmDashManifest {
	version: string;
	commit?: string;
	hash: string;
	astroVersion?: string;
	collections: Record<string, ManifestCollection>;
	plugins: Record<string, ManifestPlugin>;
	authMode: ManifestAuthMode;
	signupEnabled?: boolean;
	i18n?: {
		defaultLocale: string;
		locales: string[];
		prefixDefaultLocale?: boolean;
	};
	contentLocale?: {
		defaultLocale: string;
		implicit: boolean;
	};
	taxonomies: Array<{
		id: string;
		name: string;
		label: string;
		labelSingular?: string;
		hierarchical: boolean;
		collections: string[];
		locale: string;
		translationGroup: string;
	}>;
	marketplace?: boolean;
	registry?: {
		aggregatorUrl: string;
		acceptLabelers?: string;
		policy?: {
			minimumReleaseAgeSeconds?: number;
			minimumReleaseAgeExclude?: string[];
		};
	};
	admin?: {
		logo?: string;
		siteName?: string;
		favicon?: string;
	};
}

export interface HandlerResponse<T = unknown> {
	success: boolean;
	data?: T;
	liveContentChanged?: boolean;
	error?: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
}

export interface EmDashHandlers {
	handleContentList: (
		collection: string,
		params: {
			cursor?: string;
			limit?: number;
			status?: string;
			orderBy?: string;
			order?: "asc" | "desc";
			locale?: string;
			q?: string;
			authorId?: string;
			dateField?: "createdAt" | "updatedAt" | "publishedAt";
			dateFrom?: string;
			dateTo?: string;
			bylines?: string[];
			bylinesNone?: boolean;
			includeInferredBylines?: boolean;
			fieldFilters?: ContentFieldFilters;
		},
	) => Promise<HandlerResponse>;

	handleContentAuthors: (collection: string) => Promise<HandlerResponse>;

	handleContentGet: (
		collection: string,
		id: string,
		locale?: string,
	) => Promise<
		HandlerResponse<{
			item: {
				id: string;
				authorId: string | null;
				[key: string]: unknown;
			};
			_rev?: string;
		}>
	>;

	handleContentCreate: (
		collection: string,
		body: {
			data: Record<string, unknown>;
			slug?: string | null;
			status?: string;
			authorId?: string;
			bylines?: Array<{ bylineId: string; roleLabel?: string | null }>;
			locale?: string;
			translationOf?: string;
			taxonomies?: Record<string, string[]>;
			createdAt?: string | null;
			publishedAt?: string | null;
		},
	) => Promise<HandlerResponse>;

	handleContentUpdate: (
		collection: string,
		id: string,
		body: {
			data?: Record<string, unknown>;
			slug?: string | null;
			status?: string;
			authorId?: string | null;
			bylines?: Array<{ bylineId: string; roleLabel?: string | null }>;
			locale?: string;
			seo?: {
				title?: string | null;
				description?: string | null;
				image?: string | null;
				canonical?: string | null;
				noIndex?: boolean;
			};
			taxonomies?: Record<string, string[]>;
			publishedAt?: string | null;
			_rev?: string;
		},
	) => Promise<HandlerResponse>;

	handleContentDelete: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentListTrashed: (
		collection: string,
		params?: { cursor?: string; limit?: number },
	) => Promise<HandlerResponse>;

	handleContentRestore: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentPermanentDelete: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentCountTrashed: (collection: string) => Promise<HandlerResponse>;

	handleContentGetIncludingTrashed: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentDuplicate: (
		collection: string,
		id: string,
		authorId?: string,
	) => Promise<HandlerResponse>;

	handleContentPublish: (
		collection: string,
		id: string,
		options?: { publishedAt?: string; requireScheduledDue?: boolean },
	) => Promise<HandlerResponse>;

	handleContentUnpublish: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentSchedule: (
		collection: string,
		id: string,
		scheduledAt: string,
	) => Promise<HandlerResponse>;

	handleContentUnschedule: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentCountScheduled: (collection: string) => Promise<HandlerResponse>;

	handleContentDiscardDraft: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentCompare: (collection: string, id: string) => Promise<HandlerResponse>;

	handleContentTranslations: (collection: string, id: string) => Promise<HandlerResponse>;

	handleMediaList: (params: {
		cursor?: string;
		page?: number;
		limit?: number;
		mimeType?: string | readonly string[];
		folderId?: string | null;
	}) => Promise<HandlerResponse>;

	handleMediaGet: (id: string) => Promise<HandlerResponse>;

	handleMediaCreate: (input: {
		filename: string;
		mimeType: string;
		size?: number;
		width?: number;
		height?: number;
		storageKey: string;
		contentHash?: string;
		blurhash?: string;
		dominantColor?: string;
		authorId?: string;
	}) => Promise<HandlerResponse>;

	handleMediaUpdate: (
		id: string,
		input: {
			alt?: string;
			caption?: string;
			width?: number;
			height?: number;
			folderId?: string | null;
			focalX?: number | null;
			focalY?: number | null;
		},
	) => Promise<HandlerResponse>;

	handleMediaDelete: (id: string) => Promise<HandlerResponse>;

	handleRevisionList: (
		collection: string,
		entryId: string,
		params?: { limit?: number },
	) => Promise<HandlerResponse>;

	handleRevisionGet: (revisionId: string) => Promise<
		HandlerResponse<{
			item: {
				id: string;
				collection: string;
				entryId: string;
				authorId: string | null;
				[key: string]: unknown;
			};
		}>
	>;

	handleRevisionRestore: (revisionId: string, callerUserId: string) => Promise<HandlerResponse>;

	inspectPluginHealth: (
		pluginId: string,
		request: Request,
		user?: RouteCallerInput | null,
	) => Promise<HandlerResponse>;

	handlePluginApiRoute: (
		pluginId: string,
		method: string,
		path: string,
		request: Request,
		user?: RouteCallerInput | null,
	) => Promise<HandlerResponse>;

	handlePublicPluginApiRoute: (
		pluginId: string,
		method: string,
		path: string,
		request: Request,
	) => Promise<HandlerResponse>;

	getPluginRouteMeta: (pluginId: string, path: string) => RouteMeta | null;
	getEnabledPluginMcpTools: () => Promise<
		Array<{
			pluginId: string;
			name: string;
			description: string;
			route: string;
			permission: string;
			destructive: boolean;
			inputSchema: import("zod").ZodType;
			outputSchema?: import("zod").ZodType;
		}>
	>;
	getPluginMcpTools: (pluginId?: string) => Promise<
		Array<{
			pluginId: string;
			name: string;
			description: string;
			route: string;
			permission: string;
			destructive: boolean;
			inputSchema: import("zod").ZodType;
			outputSchema?: import("zod").ZodType;
		}>
	>;
	serializePluginMcpConsent: (
		tools: Awaited<ReturnType<EmDashHandlers["getPluginMcpTools"]>>,
		pluginId: string,
	) => string;
	handlePluginMcpTool: (
		pluginId: string,
		toolName: string,
		route: string,
		input: unknown,
		actorId: string,
		request: Request,
		caller?: RouteCallerInput | null,
	) => Promise<HandlerResponse>;
	handlePluginMcpDenied: (
		pluginId: string,
		toolName: string,
		route: string,
		actorId: string,
		request: Request,
		reason: string,
	) => Promise<void>;

	getMediaProvider: (providerId: string) => import("../media/types.js").MediaProvider | undefined;
	getMediaProviderList: () => Array<{
		id: string;
		name: string;
		icon?: string;
		capabilities: import("../media/types.js").MediaProviderCapabilities;
	}>;

	storage: import("../index.js").Storage | null;
	db: Kysely<import("../index.js").Database>;
	getPublicMediaUrl?: (storageKey: string) => string;

	hooks: import("../plugins/hooks.js").HookPipeline;

	email: import("../plugins/email.js").EmailPipeline | null;

	configuredPlugins: import("../plugins/types.js").ResolvedPlugin[];

	sandboxedPluginEntries: import("../emdash-runtime.js").SandboxedPluginEntry[];

	config: import("./integration/runtime.js").EmDashConfig;

	getManifest: () => Promise<EmDashManifest>;

	invalidateUrlPatternCache: () => void;

	getSandboxRunner: () => import("../plugins/sandbox/types.js").SandboxRunner | null;

	isSandboxBypassed: () => boolean;

	syncMarketplacePlugins: () => Promise<void>;

	syncRegistryPlugins: () => Promise<void>;

	setPluginStatus: (pluginId: string, status: "active" | "inactive") => Promise<void>;

	collectPageMetadata: (
		page: import("../plugins/types.js").PublicPageContext,
	) => Promise<import("../plugins/types.js").PageMetadataContribution[]>;
	collectPageFragments: (
		page: import("../plugins/types.js").PublicPageContext,
	) => Promise<import("../plugins/types.js").PageFragmentContribution[]>;

	ensureSearchHealthy?: () => Promise<void>;
}
