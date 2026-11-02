export {
	EmDashDatabaseError,
	getMigrationStatus,
	getExactMigrationStatus,
	MIGRATION_NAMES,
} from "./database/index.js";
export type {
	DatabaseConfig,
	MigrationStatus,
	ExactMigrationStatus,
	Database,
	UserTable,
	MediaTable,
} from "./database/index.js";

export {
	ContentRepository,
	MediaRepository,
	PluginStorageRepository,
	UserRepository,
	OptionsRepository,
	EmDashValidationError,
	InvalidCursorError,
} from "./database/repositories/index.js";
export type {
	ContentItem,
	ContentSeo,
	ContentSeoInput,
	CreateContentInput,
	UpdateContentInput,
	FindManyOptions,
	FindManyResult,
} from "./database/repositories/index.js";
export type {
	ContentFieldFilterScalar,
	ContentFieldFilterValue,
	ContentFieldFilters,
	ContentFieldInFilter,
	ContentFieldRangeFilter,
} from "./content-list-query.js";
export type { MediaItem, CreateMediaInput } from "./database/repositories/media.js";
export type { CompoundSelectLimitedAdapter } from "./database/dialect-helpers.js";

export { portableText, image, file, reference } from "./fields/index.js";
export { normalizeMediaValue } from "./media/normalize.js";
export { generatePlaceholder } from "./media/placeholder.js";
export type { PlaceholderData } from "./media/placeholder.js";
export type {
	FieldDefinition,
	FieldUIHints,
	PortableTextBlock,
	MediaValue,
	ImageValue,
	FileValue,
} from "./fields/index.js";

export {
	handleContentList,
	handleContentAuthors,
	handleContentGet,
	handleContentGetIncludingTrashed,
	handleContentCreate,
	handleContentUpdate,
	handleContentDelete,
	handleContentDuplicate,
	handleContentRestore,
	handleContentPermanentDelete,
	handleContentListTrashed,
	handleContentCountTrashed,
	handleContentPublish,
	handleContentUnpublish,
	handleContentSchedule,
	handleContentUnschedule,
	handleContentCountScheduled,
	handleContentDiscardDraft,
	handleContentCompare,
	handleContentTranslations,
	handleMediaList,
	handleMediaGet,
	handleMediaCreate,
	handleMediaUpdate,
	handleMediaDelete,
	handleRevisionList,
	handleRevisionGet,
	handleRevisionRestore,
	generateManifest,
} from "./api/index.js";
export type {
	ListResponse,
	ContentListResponse,
	ContentResponse,
	MediaListResponse,
	MediaResponse,
	RevisionListResponse,
	RevisionResponse,
	ManifestResponse,
	FieldDescriptor,
	ApiContext,
} from "./api/index.js";

export { prosemirrorToPortableText, portableTextToProsemirror } from "./content/index.js";
export type {
	PortableTextSpan,
	PortableTextMarkDef,
	PortableTextLinkMark,
	PortableTextTextBlock,
	PortableTextImageBlock,
	PortableTextCodeBlock,
	PortableTextHtmlBlock,
	PortableTextUnknownBlock,
	ProseMirrorMark,
	ProseMirrorNode,
	ProseMirrorDocument,
} from "./content/index.js";

export { ulid } from "ulidx";
export { computeContentHash, hashString } from "./utils/hash.js";
export { sanitizeHref, isSafeHref } from "./utils/url.js";
export { decodeSlug, slugify } from "./utils/slugify.js";

export {
	getEmDashCollection,
	getEmDashEntry,
	getEditMeta,
	getTranslations,
	resolveEmDashPath,
} from "./query.js";
export type {
	CacheHint,
	CollectionFilter,
	CollectionResult,
	ContentEntry,
	EditFieldMeta,
	EntryResult,
	EmDashCollections,
	InferCollectionData,
	ResolvePathResult,
	TranslationSummary,
	TranslationsResult,
	WhereRange,
	WhereValue,
} from "./query.js";

export { getRequestContext, runWithContext } from "./request-context.js";
export type { EmDashRequestContext } from "./request-context.js";

export { after } from "./after.js";
export type { WaitUntilFn } from "./after.js";

export {
	getI18nConfig,
	isI18nEnabled,
	getFallbackChain,
	resolveContentCreateLocale,
} from "./i18n/config.js";
export type { I18nConfig } from "./i18n/config.js";

export {
	createEditable,
	createNoop,
	type CMSAnnotation,
	type EditProxy,
	type FieldAnnotation,
} from "./visual-editing/editable.js";

export type {
	EntryData,
	EntryFilter,
	CollectionFilter as LoaderCollectionFilter,
} from "./loader.js";

export { parseWxr, parseWxrString } from "./cli/wxr/parser.js";
export type {
	WxrData,
	WxrSite,
	WxrPost,
	WxrAttachment,
	WxrCategory,
	WxrTag,
	WxrTerm,
	WxrAuthor,
} from "./cli/wxr/parser.js";

export type {
	Storage,
	SignedUploadUrl,
	SignedUploadOptions,
	UploadResult,
	DownloadResult,
	ListResult,
	ListOptions,
	FileInfo,
	S3StorageConfig,
	LocalStorageConfig,
	StorageDescriptor,
	CreateStorageFn,
} from "./storage/types.js";
export { EmDashStorageError } from "./storage/types.js";

export {
	cachedQuery,
	invalidateObjectCache,
	invalidateCollectionCache,
	invalidateTaxonomyObjectCache,
	invalidateBylineObjectCache,
	invalidateMenuObjectCache,
	invalidateSchemaObjectCache,
	invalidateCommentObjectCache,
	contentNamespace,
	contentNamespaces,
	CacheNamespace,
} from "./object-cache/index.js";
export type { CachedQueryOptions } from "./object-cache/index.js";
export type {
	ObjectCacheBackend,
	ObjectCacheDescriptor,
	ObjectCacheRuntimeConfig,
	CreateObjectCacheBackendFn,
} from "./object-cache/types.js";

export {
	definePlugin,
	adaptSandboxEntry,
	pluginManifestSchema,
	createHookPipeline,
	HookPipeline,
	PluginManager,
	createPluginManager,
	PluginRouteError,
	NodeCronScheduler,
	NoopSandboxRunner,
	SandboxNotAvailableError,
	SandboxUnavailableError,
	createSandboxRouteError,
	createSandboxRouteErrorEnvelope,
	getSandboxRouteErrorDetails,
	getSandboxRouteErrorEnvelope,
	createNoopSandboxRunner,
	createHttpAccess,
	createUnrestrictedHttpAccess,
} from "./plugins/index.js";
export type {
	PluginDefinition,
	ResolvedPlugin,
	PluginCapability,
	PluginContext,
	PluginStorageConfig,
	StorageCollection,
	KVAccess,
	ContentAccess,
	ContentCreateOptions,
	MediaAccess,
	HttpAccess,
	LogAccess,
	TaxonomyAccess,
	TaxonomyDefInfo,
	TaxonomyTermInfo,
	TaxonomyReadOptions,
	PluginHooks,
	HookConfig,
	HookName,
	ResolvedHook,
	ResolvedPluginHooks,
	ContentHookEvent,
	ContentDeleteEvent,
	ContentPublishStateChangeEvent,
	ContentRestoreStateChangeEvent,
	ContentScheduleStateChangeEvent,
	ContentStateChangeEvent,
	MediaUploadEvent,
	HookResult,
	PluginRoute,
	RouteContext,
	PluginAdminConfig,
	PluginAdminPage,
	PluginAdminExports,
	FieldWidgetConfig,
	PortableTextBlockConfig,
	PortableTextBlockField,
	CommentBeforeCreateEvent,
	CommentModerateEvent,
	CommentAfterCreateEvent,
	CommentAfterModerateEvent,
	CommentBeforeCreateHandler,
	CommentModerateHandler,
	CommentAfterCreateHandler,
	CommentAfterModerateHandler,
	ModerationDecision,
	CollectionCommentSettings,
	StoredComment,
	CronScheduler,
	SystemCleanupFn,
	SandboxRunner,
	SandboxedPluginInstance,
	SandboxRunnerFactory,
	SandboxOptions,
	SandboxEmailMessage,
	SandboxEmailSendCallback,
	PluginManifest,
	ValidatedPluginManifest,
	SerializedRequest,
	SandboxRouteErrorCode,
	SandboxRouteErrorDetails,
	SandboxRouteErrorEnvelope,
} from "./plugins/index.js";

export {
	CAPABILITY_RENAMES,
	isDeprecatedCapability,
	normalizeCapability,
	normalizeCapabilities,
} from "./plugins/index.js";
export type { CurrentPluginCapability, DeprecatedPluginCapability } from "./plugins/index.js";

export type { PluginDescriptor } from "./astro/integration/runtime.js";

export { SchemaRegistry, SchemaError, getCollectionInfo } from "./schema/index.js";
export type {
	FieldType,
	ColumnType,
	CollectionSupport,
	CollectionSource,
	FieldValidation,
	FieldWidgetOptions,
	Collection,
	Field,
	CreateCollectionInput,
	UpdateCollectionInput,
	CreateFieldInput,
	UpdateFieldInput,
	CollectionWithFields,
} from "./schema/index.js";
export {
	FIELD_TYPE_TO_COLUMN,
	RESERVED_FIELD_SLUGS,
	RESERVED_COLLECTION_SLUGS,
} from "./schema/index.js";

export {
	registerSource,
	getSource,
	getAllSources,
	getFileSources,
	getUrlSources,
	probeUrl,
	clearSources,
	wxrSource,
	parseWxrDate,
	wordpressRestSource,
	importReusableBlocksAsSections,
} from "./import/index.js";
export type {
	ImportSource,
	ImportAnalysis,
	ImportContext,
	SourceInput,
	FileInput,
	UrlInput,
	OAuthInput,
	SourceProbeResult,
	ProbeResult,
	SourceAuth,
	SourceCapabilities,
	SuggestedAction,
	PostTypeAnalysis,
	ImportFieldDef,
	FieldCompatibility,
	CollectionSchemaStatus,
	AttachmentInfo,
	NormalizedItem,
	ImportConfig,
	ImportResult,
	FetchOptions,
	PostTypeMapping,
} from "./import/index.js";

export {
	generatePreviewToken,
	verifyPreviewToken,
	parseContentId,
	getPreviewUrl,
	buildPreviewUrl,
	isPreviewRequest,
	getPreviewToken,
} from "./preview/index.js";
export type {
	PreviewTokenPayload,
	GeneratePreviewTokenOptions,
	VerifyPreviewTokenResult,
	VerifyPreviewTokenOptions,
	GetPreviewUrlOptions,
} from "./preview/index.js";
export {
	getPluginSetting,
	getPluginSettings,
	getSiteSetting,
	getSiteSettings,
	setSiteSettings,
} from "./settings/index.js";
export type {
	SiteSettings,
	SiteSettingKey,
	MediaReference,
	SeoSettings,
} from "./settings/types.js";

export { getSeoMeta, getContentSeo, getHreflangAlternates } from "./seo/index.js";
export type { SeoMeta, SeoMetaOptions, HreflangAlternate, HreflangOptions } from "./seo/index.js";

export type {
	PagePlacement,
	PublicPageContext,
	BreadcrumbItem,
	PageMetadataEvent,
	PageMetadataContribution,
	PageMetadataHandler,
	PageFragmentEvent,
	PageFragmentContribution,
	PageFragmentHandler,
} from "./plugins/types.js";

export { getComments, getCommentCount } from "./comments/query.js";
export type { GetCommentsOptions, GetCommentsResult } from "./comments/query.js";

export { getMenu, getMenus } from "./menus/index.js";
export type {
	Menu,
	MenuItem,
	MenuItemType,
	CreateMenuInput,
	UpdateMenuInput,
	CreateMenuItemInput,
	UpdateMenuItemInput,
	ReorderMenuItemsInput,
} from "./menus/types.js";

export { getByline, getBylineBySlug, getEntriesByByline } from "./bylines/index.js";
export type { BylineSummary, ContentBylineCredit } from "./database/repositories/types.js";

export {
	getTaxonomyDefs,
	getTaxonomyDef,
	getTaxonomyTerms,
	getTerm,
	getEntryTerms,
	getTermsForEntries,
	getAllTermsForEntries,
	getEntriesByTerm,
	invalidateTermCache,
} from "./taxonomies/index.js";
export type {
	TaxonomyDef,
	TaxonomyTerm,
	TaxonomyTermRow,
	CreateTermInput,
	UpdateTermInput,
} from "./taxonomies/types.js";

export { getWidgetArea, getWidgetAreas, getWidgetComponents } from "./widgets/index.js";
export type {
	Widget,
	WidgetArea,
	WidgetType,
	WidgetComponentDef,
	PropDef,
	CreateWidgetAreaInput,
	CreateWidgetInput,
	UpdateWidgetInput,
	ReorderWidgetsInput,
} from "./widgets/index.js";

export { getSection, getSections } from "./sections/index.js";
export type {
	Section,
	SectionSource,
	CreateSectionInput,
	UpdateSectionInput,
	GetSectionsOptions,
} from "./sections/index.js";

export { applySeed, validateSeed } from "./seed/index.js";
export type {
	SeedFile,
	SeedCollection,
	SeedField,
	SeedTaxonomy,
	SeedTaxonomyTerm,
	SeedMenu,
	SeedMenuItem,
	SeedWidgetArea,
	SeedWidget,
	SeedContentEntry,
	SeedApplyOptions,
	SeedApplyResult,
	ValidationResult,
} from "./seed/index.js";

export {
	SEARCH_TOKENIZERS,
	FTSManager,
	search,
	searchWithDb,
	searchCollection,
	getSuggestions,
	getSearchStats,
	extractPlainText,
	extractSearchableFields,
} from "./search/index.js";
export type {
	SearchConfig,
	SearchTokenizer,
	SearchOptions,
	CollectionSearchOptions,
	SearchResult,
	SearchResponse,
	SuggestOptions,
	Suggestion,
	SearchStats,
} from "./search/index.js";

export type {
	AuthDescriptor,
	AuthProviderDescriptor,
	AuthProviderAdminExports,
	AuthProviderModule,
	AuthResult,
	AuthRouteDescriptor,
	ExternalAuthConfig,
} from "./auth/types.js";

export type {
	DatabaseDescriptor,
	DatabaseDialectType,
	SqliteConfig,
	LibsqlConfig,
	PostgresConfig,
	CollectionDeletionGuardInput,
	CollectionDeletionGuardResult,
	ExecuteCollectionDeletionGuard,
} from "./db/adapters.js";
