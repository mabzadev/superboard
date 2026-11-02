export { definePlugin } from "./define-plugin.js";

export { adaptSandboxEntry } from "./adapt-sandbox-entry.js";

export { pluginManifestSchema, PLUGIN_CAPABILITIES, HOOK_NAMES } from "./manifest-schema.js";
export type { ValidatedPluginManifest } from "./manifest-schema.js";

export { extractRequestMeta, sanitizeHeadersForSandbox } from "./request-meta.js";

export {
	PluginContextFactory,
	createPluginContext,
	createKVAccess,
	createStorageAccess,
	createContentAccess,
	createContentAccessWithWrite,
	createMediaAccess,
	createMediaAccessWithWrite,
	createHttpAccess,
	createUnrestrictedHttpAccess,
	createBlockedHttpAccess,
	createLogAccess,
	createUserAccess,
	createUrlHelper,
	createSiteInfo,
} from "./context.js";
export type { PluginContextFactoryOptions } from "./context.js";

export { HookPipeline, createHookPipeline } from "./hooks.js";
export type { HookResult } from "./hooks.js";

export { EmailPipeline, EmailNotConfiguredError, EmailRecursionError } from "./email.js";
export { DEV_CONSOLE_EMAIL_PLUGIN_ID, getDevEmails, clearDevEmails } from "./email-console.js";
export type { StoredEmail } from "./email-console.js";

export {
	PluginRouteHandler,
	PluginRouteRegistry,
	PluginRouteError,
	createRouteRegistry,
} from "./routes.js";
export type { RouteResult, InvokeRouteOptions } from "./routes.js";

export { PluginManager, createPluginManager } from "./manager.js";
export type { PluginManagerOptions, PluginState } from "./manager.js";

export { NodeCronScheduler } from "./scheduler/node.js";
export type { CronScheduler, SystemCleanupFn } from "./scheduler/types.js";

export {
	NoopSandboxRunner,
	SandboxNotAvailableError,
	SandboxUnavailableError,
	createSandboxRouteError,
	createSandboxRouteErrorEnvelope,
	getSandboxRouteErrorDetails,
	getSandboxRouteErrorEnvelope,
	createNoopSandboxRunner,
} from "./sandbox/index.js";
export type {
	SandboxRunner,
	SandboxedPluginInstance,
	SandboxRunnerFactory,
	SandboxOptions,
	SandboxEmailMessage,
	SandboxEmailSendCallback,
	ResourceLimits,
	PluginCodeStorage,
	SerializedRequest,
	SandboxRouteErrorCode,
	SandboxRouteErrorDetails,
	SandboxRouteErrorEnvelope,
} from "./sandbox/index.js";

export type {
	PluginCapability,
	PluginStorageConfig,
	StorageCollectionConfig,
	PaginatedResult,
	QueryOptions,
	WhereClause,
	WhereValue,
	RangeFilter,
	InFilter,
	StartsWithFilter,
	PluginContext,
	StorageCollection,
	KVAccess,
	ContentAccess,
	ContentAccessWithWrite,
	MediaAccess,
	MediaAccessWithWrite,
	HttpAccess,
	LogAccess,
	SiteInfo,
	UserInfo,
	UserAccess,
	ContentItem,
	ContentCreateOptions,
	ContentWriteInput,
	MediaItem,
	ContentListOptions,
	MediaListOptions,
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
	MediaAfterUploadEvent,
	LifecycleEvent,
	UninstallEvent,
	EmailAccess,
	EmailMessage,
	EmailBeforeSendEvent,
	EmailDeliverEvent,
	EmailAfterSendEvent,
	EmailBeforeSendHandler,
	EmailDeliverHandler,
	EmailAfterSendHandler,
	ContentBeforeSaveHandler,
	ContentAfterSaveHandler,
	ContentBeforeDeleteHandler,
	ContentAfterDeleteHandler,
	ContentAfterRestoreHandler,
	ContentAfterScheduleHandler,
	ContentAfterUnscheduleHandler,
	MediaBeforeUploadHandler,
	MediaAfterUploadHandler,
	LifecycleHandler,
	UninstallHandler,
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
	RequestMeta,
	GeoInfo,
	PluginRoute,
	RouteContext,
	PluginAdminConfig,
	PluginAdminPage,
	PluginDashboardWidget,
	PluginAdminExports,
	FieldWidgetConfig,
	PortableTextBlockConfig,
	PortableTextBlockField,
	SettingField,
	SettingFieldType,
	PluginDefinition,
	ResolvedPlugin,
	PluginManifest,
} from "./types.js";

export {
	CAPABILITY_RENAMES,
	isDeprecatedCapability,
	normalizeCapability,
	normalizeCapabilities,
} from "./types.js";
export type { CurrentPluginCapability, DeprecatedPluginCapability } from "./types.js";
