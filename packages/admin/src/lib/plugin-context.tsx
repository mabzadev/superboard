import * as React from "react";
import { createContext, useContext } from "react";

import type { ContentEditorPanelExtension } from "./content-editor-panels";
import type { ContentListColumnExtension } from "./content-list-columns.js";

export interface PluginAdminModule {
	widgets?: Record<string, React.ComponentType>;
	pages?: Record<string, React.ComponentType>;
	fields?: Record<string, React.ComponentType>;
	contentEditorPanels?: readonly ContentEditorPanelExtension[];
	contentListColumns?: readonly ContentListColumnExtension[];
}

export type PluginAdmins = Record<string, PluginAdminModule>;

const PluginAdminContext = createContext<PluginAdmins>({});

export interface PluginAdminProviderProps {
	children: React.ReactNode;
	pluginAdmins: PluginAdmins;
}

export function PluginAdminProvider({ children, pluginAdmins }: PluginAdminProviderProps) {
	return <PluginAdminContext.Provider value={pluginAdmins}>{children}</PluginAdminContext.Provider>;
}

export function usePluginAdmins(): PluginAdmins {
	return useContext(PluginAdminContext);
}

export function usePluginWidget(pluginId: string, widgetId: string): React.ComponentType | null {
	const admins = useContext(PluginAdminContext);
	return admins[pluginId]?.widgets?.[widgetId] ?? null;
}

function togglePagePathTrailingSlash(path: string): string {
	if (path === "/") return path;
	return path.endsWith("/") ? path.slice(0, -1) : `${path}/`;
}

export function resolvePluginPagePath(
	pages: Record<string, React.ComponentType> | undefined,
	path: string,
): React.ComponentType | null {
	if (!pages) return null;
	const match = pages[path] ?? pages[togglePagePathTrailingSlash(path)];
	if (match) return match;
	if (path === "/") return Object.values(pages)[0] ?? null;
	return null;
}

export function usePluginPage(pluginId: string, path: string): React.ComponentType | null {
	const admins = useContext(PluginAdminContext);
	return resolvePluginPagePath(admins[pluginId]?.pages, path);
}

export function usePluginField(pluginId: string, fieldType: string): React.ComponentType | null {
	const admins = useContext(PluginAdminContext);
	return admins[pluginId]?.fields?.[fieldType] ?? null;
}

export function usePluginHasPages(pluginId: string): boolean {
	const admins = useContext(PluginAdminContext);
	const pages = admins[pluginId]?.pages;
	return pages !== undefined && Object.keys(pages).length > 0;
}

export function usePluginHasWidgets(pluginId: string): boolean {
	const admins = useContext(PluginAdminContext);
	const widgets = admins[pluginId]?.widgets;
	return widgets !== undefined && Object.keys(widgets).length > 0;
}
