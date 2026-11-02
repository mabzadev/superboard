export { AdminApp, default as App } from "./App";

export { createAdminRouter, Link, useNavigate, useParams } from "./router";

export * from "./components";

export * from "./lib/api";

export { cn } from "./lib/utils";

export {
	type ContentEditorPanelContext,
	type ContentEditorPanelExtension,
} from "./lib/content-editor-panels";

export {
	PluginAdminProvider,
	usePluginAdmins,
	usePluginWidget,
	usePluginPage,
	usePluginField,
	usePluginHasPages,
	usePluginHasWidgets,
	type PluginAdminModule,
	type PluginAdmins,
} from "./lib/plugin-context";

export type {
	ContentListColumnHeaderContext,
	ContentListColumnCellContext,
	ContentListColumnExtension,
} from "./lib/content-list-columns.js";

export {
	AuthProviderProvider,
	useAuthProviders,
	useAuthProviderList,
	type AuthProviderModule,
	type AuthProviders,
} from "./lib/auth-provider-context";

export type { AdminBranding } from "./lib/admin-branding-context";

export {
	useLocale,
	SUPPORTED_LOCALES,
	SUPPORTED_LOCALE_CODES,
	DEFAULT_LOCALE,
	resolveLocale,
} from "./locales/index.js";
export type { SupportedLocale } from "./locales/index.js";
