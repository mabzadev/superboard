import { z } from "zod";

import { capabilitiesToDeclaredAccess, declaredAccessToCapabilities } from "./index.js";
import type { PluginManifest } from "./index.js";

export const CURRENT_PLUGIN_CAPABILITIES = [
	"network:request",
	"network:request:unrestricted",
	"content:read",
	"content:write",
	"taxonomies:read",
	"media:read",
	"media:write",
	"users:read",
	"email:send",
	"hooks.email-transport:register",
	"hooks.email-events:register",
	"hooks.page-fragments:register",
] as const;

export const DEPRECATED_PLUGIN_CAPABILITIES = [
	"network:fetch",
	"network:fetch:any",
	"read:content",
	"write:content",
	"read:media",
	"write:media",
	"read:users",
	"email:provide",
	"email:intercept",
	"page:inject",
] as const;

export const PLUGIN_CAPABILITIES = [
	...CURRENT_PLUGIN_CAPABILITIES,
	...DEPRECATED_PLUGIN_CAPABILITIES,
] as const;

const FIELD_TYPES = [
	"string",
	"text",
	"number",
	"integer",
	"boolean",
	"datetime",
	"select",
	"multiSelect",
	"portableText",
	"image",
	"file",
	"reference",
	"json",
	"slug",
	"repeater",
] as const;

export const HOOK_NAMES = [
	"plugin:install",
	"plugin:activate",
	"plugin:deactivate",
	"plugin:uninstall",
	"content:beforeSave",
	"content:afterSave",
	"content:beforeDelete",
	"content:afterDelete",
	"content:afterPublish",
	"content:afterUnpublish",
	"content:afterRestore",
	"content:afterSchedule",
	"content:afterUnschedule",
	"media:beforeUpload",
	"media:afterUpload",
	"cron",
	"email:beforeSend",
	"email:deliver",
	"email:afterSend",
	"comment:beforeCreate",
	"comment:moderate",
	"comment:afterCreate",
	"comment:afterModerate",
	"page:metadata",
	"page:fragments",
] as const;

const manifestHookEntrySchema = z.object({
	name: z.enum(HOOK_NAMES),
	exclusive: z.boolean().optional(),
	priority: z.number().int().optional(),
	timeout: z.number().int().positive().optional(),
});

const routeNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_\-/]*$/;

const manifestRouteEntrySchema = z.object({
	name: z.string().min(1).regex(routeNamePattern, "Route name must be a safe path segment"),
	public: z.boolean().optional(),
});

const indexFieldName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/);

const storageCollectionSchema = z.object({
	indexes: z.array(z.union([indexFieldName, z.array(indexFieldName)])),
	uniqueIndexes: z.array(z.union([indexFieldName, z.array(indexFieldName)])).optional(),
});

const baseSettingFields = {
	label: z.string(),
	description: z.string().optional(),
};

const settingFieldSchema = z.discriminatedUnion("type", [
	z.object({
		...baseSettingFields,
		type: z.literal("string"),
		default: z.string().optional(),
		multiline: z.boolean().optional(),
	}),
	z.object({
		...baseSettingFields,
		type: z.literal("number"),
		default: z.number().optional(),
		min: z.number().optional(),
		max: z.number().optional(),
	}),
	z.object({ ...baseSettingFields, type: z.literal("boolean"), default: z.boolean().optional() }),
	z.object({
		...baseSettingFields,
		type: z.literal("select"),
		options: z.array(z.object({ value: z.string(), label: z.string() })),
		default: z.string().optional(),
	}),
	z.object({ ...baseSettingFields, type: z.literal("secret") }),
	z.object({
		...baseSettingFields,
		type: z.literal("url"),
		default: z.string().optional(),
		placeholder: z.string().optional(),
	}),
	z.object({
		...baseSettingFields,
		type: z.literal("email"),
		default: z.string().optional(),
		placeholder: z.string().optional(),
	}),
]);

const adminPageSchema = z.object({
	path: z.string(),
	label: z.string(),
	icon: z.string().optional(),
});

const dashboardWidgetSchema = z.object({
	id: z.string(),
	size: z.enum(["full", "half", "third"]).optional(),
	title: z.string().optional(),
});

const pluginAdminConfigSchema = z.object({
	entry: z.string().optional(),
	settingsSchema: z.record(z.string(), settingFieldSchema).optional(),
	pages: z.array(adminPageSchema).optional(),
	widgets: z.array(dashboardWidgetSchema).optional(),
	fieldWidgets: z
		.array(
			z.object({
				name: z.string().min(1),
				label: z.string().min(1),
				fieldTypes: z.array(z.enum(FIELD_TYPES)),
				elements: z
					.array(
						z
							.object({
								type: z.string(),
								action_id: z.string(),
								label: z.string().optional(),
							})
							.passthrough(),
					)
					.optional(),
			}),
		)
		.optional(),
});

const accessConstraints = z.record(z.string(), z.unknown());

const declaredAccessSchema = z.object({
	content: z
		.object({ read: accessConstraints.optional(), write: accessConstraints.optional() })
		.optional(),
	taxonomies: z.object({ read: accessConstraints.optional() }).optional(),
	media: z
		.object({ read: accessConstraints.optional(), write: accessConstraints.optional() })
		.optional(),
	network: z
		.object({
			request: z.object({ allowedHosts: z.array(z.string()).min(1).optional() }).optional(),
		})
		.optional(),
	email: z
		.object({
			send: accessConstraints.optional(),
			events: accessConstraints.optional(),
			transport: accessConstraints.optional(),
		})
		.optional(),
	page: z.object({ fragments: accessConstraints.optional() }).optional(),
	users: z.object({ read: accessConstraints.optional() }).optional(),
});

export const pluginManifestSchema = z.object({
	id: z.string().min(1),
	version: z.string().min(1),
	declaredAccess: declaredAccessSchema.optional(),
	capabilities: z.array(z.enum(PLUGIN_CAPABILITIES)),
	allowedHosts: z.array(z.string()),
	storage: z.record(z.string(), storageCollectionSchema),
	hooks: z.array(z.union([z.enum(HOOK_NAMES), manifestHookEntrySchema])),
	routes: z.array(
		z.union([
			z.string().min(1).regex(routeNamePattern, "Route name must be a safe path segment"),
			manifestRouteEntrySchema,
		]),
	),
	admin: pluginAdminConfigSchema,
});

export type ValidatedPluginManifest = z.infer<typeof pluginManifestSchema>;

export function reconcileManifestAccess(manifest: ValidatedPluginManifest): PluginManifest {
	const reconciled: ValidatedPluginManifest = manifest.declaredAccess
		? { ...manifest, ...declaredAccessToCapabilities(manifest.declaredAccess) }
		: {
				...manifest,
				declaredAccess: capabilitiesToDeclaredAccess(manifest.capabilities, manifest.allowedHosts),
			};
	return reconciled;
}

export function normalizeManifestHook(
	entry: string | { name: string; exclusive?: boolean; priority?: number; timeout?: number },
): { name: string; exclusive?: boolean; priority?: number; timeout?: number } {
	if (typeof entry === "string") {
		return { name: entry };
	}
	return entry;
}

export function normalizeManifestRoute(entry: string | { name: string; public?: boolean }): {
	name: string;
	public?: boolean;
} {
	if (typeof entry === "string") {
		return { name: entry };
	}
	return entry;
}
