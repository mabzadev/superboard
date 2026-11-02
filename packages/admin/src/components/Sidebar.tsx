import { Sidebar as KumoSidebar, useSidebar } from "@cloudflare/kumo";
import { useLingui } from "@lingui/react/macro";
import { Gear, Palette, Storefront, Users } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import * as React from "react";

import { fetchCommentCounts } from "../lib/api/comments";
import { useCurrentUser } from "../lib/api/current-user";
import { resolvePluginPagePath, usePluginAdmins } from "../lib/plugin-context";
import {
	resolveTaxonomyDefinitions,
	type LocalizedTaxonomyDefinition,
} from "../lib/taxonomy-definitions.js";
import {
	ADMIN_NAV_ICONS,
	getCollectionNavIcon,
	getTaxonomyNavIcon,
	resolveNavIcon,
	toPhosphorIconName,
} from "./admin-navigation-icons.js";
import { BrandIcon } from "./Logo.js";

export { KumoSidebar as Sidebar, useSidebar };
export { resolveNavIcon, toPhosphorIconName };

const ROLE_ADMIN = 50;
const ROLE_EDITOR = 40;

export const BYLINE_SCHEMA_NAV_ITEM = {
	to: "/byline-schema" as const,
	minRole: ROLE_ADMIN,
	icon: ADMIN_NAV_ICONS.bylineSchema,
} as const;

export function filterNavItemsByRole<T extends { minRole?: number }>(
	items: T[],
	userRole: number,
): T[] {
	return items.filter((item) => !item.minRole || userRole >= item.minRole);
}

export function visibleCollectionEntries<T extends { hidden?: boolean }>(
	collections: Record<string, T>,
): Array<[string, T]> {
	return Object.entries(collections).filter(([, config]) => !config.hidden);
}

export interface SidebarNavProps {
	manifest: {
		collections: Record<string, { label: string; hidden?: boolean }>;
		plugins: Record<
			string,
			{
				package?: string;
				enabled?: boolean;
				adminMode?: "react" | "blocks" | "none";
				adminPages?: Array<{
					path: string;
					label?: string;
					icon?: string;
				}>;
				dashboardWidgets?: Array<{ id: string; title?: string }>;
				version?: string;
			}
		>;
		taxonomies: Array<{
			id?: string;
			name: string;
			label: string;
			locale?: string;
			translationGroup?: string | null;
		}>;
		i18n?: { defaultLocale: string; locales: string[] };
		version?: string;
		commit?: string;
		marketplace?: string;
		registry?: {
			aggregatorUrl: string;
		};
		admin?: {
			logo?: string;
			siteName?: string;
			favicon?: string;
		};
	};
}

export function getSidebarTaxonomies<T extends LocalizedTaxonomyDefinition>(
	taxonomies: readonly T[],
	activeLocale?: string,
	defaultLocale?: string,
): T[] {
	return resolveTaxonomyDefinitions(taxonomies, activeLocale, defaultLocale);
}

interface NavItem {
	to: string;
	label: string;
	icon: React.ElementType;
	params?: Record<string, string>;
	search?: Record<string, string>;
	minRole?: number;
	badge?: number;
}

function NavMenuLink({ item, isActive }: { item: NavItem; isActive: boolean }) {
	const { state } = useSidebar();
	const Icon = item.icon;
	function IconComponent({ className }: { className?: string }) {
		return <NavIcon icon={Icon} className={className} />;
	}

	return (
		<KumoSidebar.MenuButton
			href={resolveItemPath(item)}
			active={isActive}
			tooltip={state === "collapsed" ? item.label : undefined}
			icon={IconComponent}
		>
			{item.label}
			{item.badge != null && item.badge > 0 && (
				<KumoSidebar.MenuBadge>{item.badge}</KumoSidebar.MenuBadge>
			)}
		</KumoSidebar.MenuButton>
	);
}

function NavIcon({ icon: Icon, className }: { icon: React.ElementType; className?: string }) {
	return (
		<React.Suspense fallback={<ADMIN_NAV_ICONS.plugins className={className} aria-hidden="true" />}>
			<Icon className={className} aria-hidden="true" />
		</React.Suspense>
	);
}

export function resolvePluginPageLabel(
	label: string | undefined,
	pluginId: string,
	translate: (id: string) => string,
): string {
	if (label) return translate(label);
	return pluginId
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

export function resolveItemPath(item: NavItem): string {
	let path = item.to;
	if (item.params) {
		for (const [key, value] of Object.entries(item.params)) {
			path = path.replace(`$${key}`, value);
		}
	}
	if (item.search && Object.keys(item.search).length > 0) {
		path += `?${new URLSearchParams(item.search).toString()}`;
	}
	return path;
}

export function isItemActive(itemPath: string, currentPath: string): boolean {
	const queryIndex = itemPath.indexOf("?");
	const path = queryIndex === -1 ? itemPath : itemPath.slice(0, queryIndex);
	return path === "/"
		? currentPath === "/"
		: currentPath === path || currentPath.startsWith(`${path}/`);
}

export function SidebarNav({ manifest }: SidebarNavProps) {
	const { t, i18n } = useLingui();
	const location = useLocation();
	const currentPath = location.pathname;
	const routeLocale =
		new URL(location.href, "http://emdash.local").searchParams.get("locale") ?? undefined;
	const pluginAdmins = usePluginAdmins();

	const { data: user } = useCurrentUser();
	const userRole = user?.role ?? 0;

	const { data: commentCounts } = useQuery({
		queryKey: ["commentCounts"],
		queryFn: fetchCommentCounts,
		staleTime: 60 * 1000,
		retry: false,
		enabled: userRole >= ROLE_EDITOR,
	});

	const contentItems: NavItem[] = [
		{ to: "/", label: t`Dashboard`, icon: ADMIN_NAV_ICONS.dashboard },
	];
	for (const [name, config] of visibleCollectionEntries(manifest.collections)) {
		contentItems.push({
			to: "/content/$collection",
			label: config.label,
			icon: getCollectionNavIcon(name),
			params: { collection: name },
		});
	}
	contentItems.push({ to: "/media", label: t`Media`, icon: ADMIN_NAV_ICONS.media });

	const manageItems: NavItem[] = [
		{
			to: "/comments",
			label: t`Comments`,
			icon: ADMIN_NAV_ICONS.comments,
			minRole: ROLE_EDITOR,
			badge: commentCounts?.pending,
		},
		{ to: "/menus", label: t`Menus`, icon: ADMIN_NAV_ICONS.menus, minRole: ROLE_EDITOR },
		{
			to: "/redirects",
			label: t`Redirects`,
			icon: ADMIN_NAV_ICONS.redirects,
			minRole: ROLE_ADMIN,
		},
		{ to: "/widgets", label: t`Widgets`, icon: ADMIN_NAV_ICONS.widgets, minRole: ROLE_EDITOR },
		{ to: "/sections", label: t`Sections`, icon: ADMIN_NAV_ICONS.sections, minRole: ROLE_EDITOR },
		...getSidebarTaxonomies(manifest.taxonomies, routeLocale, manifest.i18n?.defaultLocale).map(
			(tax) => ({
				to: "/taxonomies/$taxonomy" as const,
				label: tax.label,
				icon: getTaxonomyNavIcon(tax.name),
				params: { taxonomy: tax.name },
				search: routeLocale ? { locale: routeLocale } : undefined,
				minRole: ROLE_EDITOR,
			}),
		),
		{ to: "/bylines", label: t`Bylines`, icon: ADMIN_NAV_ICONS.bylines, minRole: ROLE_EDITOR },
	];

	const adminItems: NavItem[] = [
		{
			to: "/content-types",
			label: t`Content Types`,
			icon: ADMIN_NAV_ICONS.contentTypes,
			minRole: ROLE_ADMIN,
		},
		{ ...BYLINE_SCHEMA_NAV_ITEM, label: t`Byline Schema` },
		{ to: "/users", label: t`Users`, icon: Users, minRole: ROLE_ADMIN },
		{
			to: "/plugins-manager",
			label: t`Plugins`,
			icon: ADMIN_NAV_ICONS.plugins,
			minRole: ROLE_ADMIN,
		},
	];

	if (manifest.registry) {
		adminItems.push({
			to: "/plugins/marketplace",
			label: t`Registry`,
			icon: Storefront,
			minRole: ROLE_ADMIN,
		});
	} else if (manifest.marketplace) {
		adminItems.push({
			to: "/plugins/marketplace",
			label: t`Marketplace`,
			icon: Storefront,
			minRole: ROLE_ADMIN,
		});
	}

	if (manifest.marketplace) {
		adminItems.push({
			to: "/themes/marketplace",
			label: t`Themes`,
			icon: Palette,
			minRole: ROLE_ADMIN,
		});
	}

	adminItems.push(
		{
			to: "/import/wordpress",
			label: t`Import`,
			icon: ADMIN_NAV_ICONS.import,
			minRole: ROLE_ADMIN,
		},
		{ to: "/settings", label: t`Settings`, icon: Gear, minRole: ROLE_ADMIN },
	);

	const pluginItems: NavItem[] = [];
	for (const [pluginId, config] of Object.entries(manifest.plugins)) {
		if (config.enabled === false) continue;
		if (config.adminPages && config.adminPages.length > 0) {
			const pluginPages = pluginAdmins[pluginId]?.pages;
			const isBlocksMode = config.adminMode === "blocks";
			for (const page of config.adminPages) {
				if (!isBlocksMode && !resolvePluginPagePath(pluginPages, page.path)) continue;
				const label = resolvePluginPageLabel(page.label, pluginId, (id) => i18n._(id));
				pluginItems.push({
					to: `/plugins/${pluginId}${page.path}`,
					label,
					icon: resolveNavIcon(page.icon),
				});
			}
		}
	}

	const visibleContent = filterNavItemsByRole(contentItems, userRole);
	const visibleManage = filterNavItemsByRole(manageItems, userRole);
	const visibleAdmin = filterNavItemsByRole(adminItems, userRole);
	const visiblePlugins = filterNavItemsByRole(pluginItems, userRole);

	function renderNavItems(items: NavItem[]) {
		return items.map((item, index) => {
			const itemPath = resolveItemPath(item);
			const active = isItemActive(itemPath, currentPath);
			return <NavMenuLink key={`${item.to}-${index}`} item={item} isActive={active} />;
		});
	}

	return (
		<KumoSidebar className="emdash-sidebar" aria-label={t`Admin navigation`}>
			<KumoSidebar.Header className="px-[11px] transition-[padding] duration-(--sidebar-animation-duration) motion-reduce:transition-none group-not-data-[state=collapsed]/sidebar:px-3.5">
				<Link
					to="/"
					className="flex w-[calc(var(--sidebar-width)-1.75rem)] shrink-0 items-center gap-2 overflow-hidden py-1 ps-2.5 group-data-[state=collapsed]/sidebar:-translate-x-[3px] rtl:group-data-[state=collapsed]/sidebar:translate-x-[3px]"
				>
					<BrandIcon
						logoUrl={manifest.admin?.logo}
						siteName={manifest.admin?.siteName}
						className="size-5 shrink-0"
						aria-hidden="true"
					/>
					<span className="grid min-w-0 flex-1 grid-cols-[1fr] transition-[grid-template-columns] duration-(--sidebar-animation-duration) ease-(--sidebar-easing) motion-reduce:transition-none group-data-[state=collapsed]/sidebar:grid-cols-[0fr]">
						<span className="min-w-0 overflow-hidden">
							<span className="block w-[calc(var(--sidebar-width)-4.5rem)] truncate font-semibold">
								{manifest.admin?.siteName || "EmDash"}
							</span>
						</span>
					</span>
				</Link>
			</KumoSidebar.Header>

			<KumoSidebar.Content>
				<KumoSidebar.Group className="mt-2 md:mt-1.5">
					<KumoSidebar.Menu>
						<NavMenuLink
							item={{ to: "/", label: t`Dashboard`, icon: ADMIN_NAV_ICONS.dashboard }}
							isActive={isItemActive("/", currentPath)}
						/>
					</KumoSidebar.Menu>
				</KumoSidebar.Group>

				{visibleContent.length > 1 && (
					<KumoSidebar.Group>
						<KumoSidebar.GroupLabel>{t`Content`}</KumoSidebar.GroupLabel>
						<KumoSidebar.Menu>
							{renderNavItems(visibleContent.filter((i) => i.to !== "/"))}
						</KumoSidebar.Menu>
					</KumoSidebar.Group>
				)}

				{visibleManage.length > 0 && (
					<KumoSidebar.Group>
						<KumoSidebar.GroupLabel>{t`Manage`}</KumoSidebar.GroupLabel>
						<KumoSidebar.Menu>{renderNavItems(visibleManage)}</KumoSidebar.Menu>
					</KumoSidebar.Group>
				)}

				{visibleAdmin.length > 0 && (
					<KumoSidebar.Group>
						<KumoSidebar.GroupLabel>{t`Admin`}</KumoSidebar.GroupLabel>
						<KumoSidebar.Menu>{renderNavItems(visibleAdmin)}</KumoSidebar.Menu>
					</KumoSidebar.Group>
				)}

				{visiblePlugins.length > 0 && (
					<KumoSidebar.Group>
						<KumoSidebar.GroupLabel>{t`Plugins`}</KumoSidebar.GroupLabel>
						<KumoSidebar.Menu>{renderNavItems(visiblePlugins)}</KumoSidebar.Menu>
					</KumoSidebar.Group>
				)}
			</KumoSidebar.Content>

			<KumoSidebar.Footer className="gap-0">
				<KumoSidebar.Trigger className="rtl:rotate-180" />
				<div className="min-w-0 flex-1 overflow-hidden">
					<p
						data-testid="admin-version"
						className="w-40 overflow-hidden truncate ps-2 text-[11px] text-kumo-subtle"
					>
						{manifest.admin?.siteName || "EmDash CMS"} v{manifest.version || "0.0.0"}
						{manifest.commit && ` (${manifest.commit})`}
					</p>
				</div>
			</KumoSidebar.Footer>
		</KumoSidebar>
	);
}
