import type { Permission } from "@emdash-cms/auth";
import type { ZodType } from "zod";

import type {
	CommentAfterCreateEvent,
	CommentAfterCreateHandler,
	CommentAfterModerateEvent,
	CommentAfterModerateHandler,
	CommentBeforeCreateEvent,
	CommentBeforeCreateHandler,
	CommentModerateEvent,
	CommentModerateHandler,
	ContentAfterDeleteHandler,
	ContentAfterPublishHandler,
	ContentAfterRestoreHandler,
	ContentAfterSaveHandler,
	ContentAfterScheduleHandler,
	ContentAfterUnpublishHandler,
	ContentAfterUnscheduleHandler,
	ContentBeforeDeleteHandler,
	ContentBeforeSaveHandler,
	ContentDeleteEvent,
	ContentHookEvent,
	ContentPublishStateChangeEvent,
	ContentRestoreStateChangeEvent,
	ContentScheduleStateChangeEvent,
	ContentStateChangeEvent,
	CronEvent,
	CronHandler,
	EmailAfterSendEvent,
	EmailAfterSendHandler,
	EmailBeforeSendEvent,
	EmailBeforeSendHandler,
	EmailDeliverEvent,
	EmailDeliverHandler,
	LifecycleEvent,
	LifecycleHandler,
	MediaAfterUploadEvent,
	MediaAfterUploadHandler,
	MediaBeforeUploadHandler,
	MediaUploadEvent,
	PageFragmentEvent,
	PageFragmentHandler,
	PageMetadataEvent,
	PageMetadataHandler,
	PluginContext,
	UninstallEvent,
	UninstallHandler,
	UserInfo,
} from "./plugins/types.js";

export interface HookHandlers {
	"plugin:install": LifecycleHandler;
	"plugin:activate": LifecycleHandler;
	"plugin:deactivate": LifecycleHandler;
	"plugin:uninstall": UninstallHandler;
	"content:beforeSave": ContentBeforeSaveHandler;
	"content:afterSave": ContentAfterSaveHandler;
	"content:beforeDelete": ContentBeforeDeleteHandler;
	"content:afterDelete": ContentAfterDeleteHandler;
	"content:afterPublish": ContentAfterPublishHandler;
	"content:afterUnpublish": ContentAfterUnpublishHandler;
	"content:afterRestore": ContentAfterRestoreHandler;
	"content:afterSchedule": ContentAfterScheduleHandler;
	"content:afterUnschedule": ContentAfterUnscheduleHandler;
	"media:beforeUpload": MediaBeforeUploadHandler;
	"media:afterUpload": MediaAfterUploadHandler;
	cron: CronHandler;
	"email:beforeSend": EmailBeforeSendHandler;
	"email:deliver": EmailDeliverHandler;
	"email:afterSend": EmailAfterSendHandler;
	"comment:beforeCreate": CommentBeforeCreateHandler;
	"comment:moderate": CommentModerateHandler;
	"comment:afterCreate": CommentAfterCreateHandler;
	"comment:afterModerate": CommentAfterModerateHandler;
	"page:metadata": PageMetadataHandler;
	"page:fragments": PageFragmentHandler;
}

export interface HookConfig<K extends keyof HookHandlers> {
	handler: HookHandlers[K];
	priority?: number;
	timeout?: number;
	dependencies?: string[];
	errorPolicy?: "continue" | "abort";
	exclusive?: boolean;
}

export type HookEntry<K extends keyof HookHandlers> = HookHandlers[K] | HookConfig<K>;

export interface SandboxedRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
}

export interface SandboxedRouteContext {
	input: unknown;
	request: SandboxedRequest;
	requestMeta?: unknown;
	user?: UserInfo;
}

export type RouteHandler = (
	routeCtx: SandboxedRouteContext,
	ctx: PluginContext,
) => Promise<unknown>;

export type RouteEntry =
	| RouteHandler
	| {
			handler: RouteHandler;
			public?: boolean;
			cacheControl?: string;
			input?: unknown;
			permission?: Permission;
	  };

export interface SandboxedMcpTool {
	description: string;
	route: string;
	input: ZodType;
	output?: ZodType;
	destructive?: boolean;
}

export interface SandboxedPlugin {
	hooks?: {
		[K in keyof HookHandlers]?: HookEntry<K>;
	};
	routes?: Record<string, RouteEntry>;
	mcp?: { tools: Record<string, SandboxedMcpTool> };
}

export type {
	CommentAfterCreateEvent,
	CommentAfterModerateEvent,
	CommentBeforeCreateEvent,
	CommentModerateEvent,
	ContentDeleteEvent,
	ContentHookEvent,
	ContentPublishStateChangeEvent,
	ContentRestoreStateChangeEvent,
	ContentScheduleStateChangeEvent,
	ContentStateChangeEvent,
	CronEvent,
	EmailAfterSendEvent,
	EmailBeforeSendEvent,
	EmailDeliverEvent,
	LifecycleEvent,
	MediaAfterUploadEvent,
	MediaUploadEvent,
	PageFragmentEvent,
	PageMetadataEvent,
	PluginContext,
	UninstallEvent,
};
