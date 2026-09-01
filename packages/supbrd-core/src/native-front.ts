import type {
	FrontAuthPolicy,
	FrontAudience,
	FrontState,
	RendererDescriptor,
} from "./contracts.js";

export interface NativeFrontNavigationContribution {
	group_id: string;
	group_label: string;
	group_order: number;
	item_label: string;
	item_order: number;
	item_href: string | null;
}

export interface NativeFrontSurfaceContribution {
	route_id: string;
	path_pattern: string;
	page_id: string;
	title: string;
	renderer_id: string;
	audience: FrontAudience;
	auth_policy: FrontAuthPolicy;
	permission_expression: string;
	priority: number;
	navigation: NativeFrontNavigationContribution | null;
	transition: "login" | "authenticated_home" | null;
}

export interface NativeFrontSurfaceInput {
	path_pattern: string;
	title: string;
	renderer_id?: string;
	route_id?: string;
	page_id?: string;
	auth_policy?: NativeFrontSurfaceContribution["auth_policy"];
	permission_expression?: string;
	navigation?: NativeFrontNavigationContribution | null;
	transition?: NativeFrontSurfaceContribution["transition"];
	actions?: readonly { label: string; href: string }[];
}

export interface NativeFrontPluginModule {
	plugin_id: string;
	renderer_ids: readonly string[];
	renderer_builds: Readonly<Record<string, string>>;
	surfaces: readonly NativeFrontSurfaceContribution[];
	mount_renderer(input: NativeRendererMountInput): NativeRendererDocument | null;
}

export interface NativeFrontOperator {
	id: string;
	email: string;
	name: string | null;
	role: number;
	disabled: boolean;
}

export interface NativeRendererMountInput {
	renderer: RendererDescriptor;
	route_id: string | null;
	path: string;
	page_title: string | null;
	parameters: Readonly<Record<string, string>>;
	operator: NativeFrontOperator | null;
}

export type NativeRendererDocument =
	| {
			kind: "layout";
			title: string;
			description: string;
			home_href: string;
			navigation_label: string;
			actions: readonly { label: string; href: string }[];
	  }
	| {
			kind: "state";
			state: FrontState;
			title: string;
			description: string;
	  }
	| {
			kind: "surface";
			eyebrow: string;
			title: string;
			description: string;
			details: readonly { label: string; value: string }[];
			actions: readonly { label: string; href: string }[];
	  };

export interface FrontNavigationItem {
	route_id: string;
	label: string;
	permission: string;
	order: number;
	href: string;
}

export interface FrontNavigationGroup {
	group_id: string;
	label: string;
	order: number;
	items: FrontNavigationItem[];
}

export function navigationGroup(input: {
	group_id: string;
	group_label: string;
	group_order: number;
}) {
	return (
		itemLabel: string,
		itemOrder: number,
		itemHref: string | null = null,
	): NativeFrontNavigationContribution => ({
		...input,
		item_label: itemLabel,
		item_order: itemOrder,
		item_href: itemHref,
	});
}

export function defineNativeFrontPlugin(input: {
	plugin_id: string;
	plugin_label: string;
	description: string;
	permission_expression?: string;
	surfaces: readonly NativeFrontSurfaceInput[];
}): NativeFrontPluginModule {
	const defaultRendererId = `${input.plugin_id}.renderer.admin_surface`;
	const surfaceActions = new Map<string, readonly { label: string; href: string }[]>();
	const surfaces = input.surfaces.map((surface) => {
		const name = surfaceName(surface.path_pattern);
		const routeId = surface.route_id ?? `superboard.${name}`;
		surfaceActions.set(routeId, surface.actions ?? []);
		return {
			route_id: routeId,
			path_pattern: surface.path_pattern,
			page_id: surface.page_id ?? `page.superboard_${name}`,
			title: surface.title,
			renderer_id: surface.renderer_id ?? defaultRendererId,
			audience: "superboard_front" as const,
			auth_policy: surface.auth_policy ?? ("authenticated" as const),
			permission_expression:
				surface.permission_expression ?? input.permission_expression ?? `${input.plugin_id}.read`,
			priority: hasParameters(surface.path_pattern) ? 100 : 200,
			navigation: surface.navigation ?? null,
			transition: surface.transition ?? null,
		};
	});
	const rendererIds = [...new Set(surfaces.map(({ renderer_id }) => renderer_id))].toSorted();

	return {
		plugin_id: input.plugin_id,
		renderer_ids: rendererIds,
		renderer_builds: {},
		surfaces,
		mount_renderer(mountInput: NativeRendererMountInput): NativeRendererDocument | null {
			if (!rendererIds.includes(mountInput.renderer.renderer_id)) return null;
			const details = [
				{ label: "Plugin", value: input.plugin_id },
				{ label: "Route", value: mountInput.route_id ?? "—" },
				{ label: "Path", value: mountInput.path },
				...Object.entries(mountInput.parameters).map(([label, value]) => ({ label, value })),
			];
			if (mountInput.operator) {
				details.push({ label: "Operator", value: mountInput.operator.email });
			}
			return {
				kind: "surface",
				eyebrow: input.plugin_label,
				title: mountInput.page_title ?? input.plugin_label,
				description: input.description,
				details,
				actions: surfaceActions.get(mountInput.route_id ?? "") ?? [],
			};
		},
	};
}

export function parseFrontNavigation(
	value: readonly unknown[],
	routes: readonly { route_id: string; path_pattern: string }[] = [],
): FrontNavigationGroup[] {
	if (value.length > 0 && value.every(isLegacyNavigationItem)) {
		const hrefByRoute = new Map(routes.map((route) => [route.route_id, route.path_pattern]));
		return [
			{
				group_id: "legacy",
				label: "Navigation",
				order: 0,
				items: value.map((entry, order) => {
					const href = hrefByRoute.get(entry.route_id);
					if (!href) throw new TypeError(`Front navigation route is missing: ${entry.route_id}`);
					return { ...entry, order, href };
				}),
			},
		];
	}
	return value.map((entry) => {
		if (!isRecord(entry) || !hasExactKeys(entry, ["group_id", "items", "label", "order"])) {
			throw new TypeError("Front navigation group is not closed");
		}
		if (
			typeof entry.group_id !== "string" ||
			typeof entry.label !== "string" ||
			!Number.isSafeInteger(entry.order) ||
			!Array.isArray(entry.items)
		) {
			throw new TypeError("Front navigation group is invalid");
		}
		return {
			group_id: entry.group_id,
			label: entry.label,
			order: entry.order as number,
			items: entry.items.map((item) => parseNavigationItem(item)),
		};
	});
}

function isLegacyNavigationItem(
	value: unknown,
): value is { route_id: string; label: string; permission: string } {
	return (
		isRecord(value) &&
		hasExactKeys(value, ["label", "permission", "route_id"]) &&
		typeof value.route_id === "string" &&
		typeof value.label === "string" &&
		typeof value.permission === "string"
	);
}

function parseNavigationItem(value: unknown): FrontNavigationItem {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["href", "label", "order", "permission", "route_id"])
	) {
		throw new TypeError("Front navigation item is not closed");
	}
	if (
		typeof value.route_id !== "string" ||
		typeof value.href !== "string" ||
		!value.href.startsWith("/") ||
		typeof value.label !== "string" ||
		typeof value.permission !== "string" ||
		!Number.isSafeInteger(value.order)
	) {
		throw new TypeError("Front navigation item is invalid");
	}
	return {
		route_id: value.route_id,
		href: value.href,
		label: value.label,
		permission: value.permission,
		order: value.order as number,
	};
}

function hasParameters(path: string): boolean {
	return /(?:^|\/)(?::|\*)/u.test(path);
}

function surfaceName(path: string): string {
	if (path === "/") return "home";
	return path
		.slice(1)
		.replaceAll(/[:*]/gu, "by_")
		.replaceAll(/[^a-zA-Z0-9]+/gu, "_")
		.replaceAll(/^_+|_+$/gu, "")
		.toLowerCase();
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return JSON.stringify(Object.keys(value).toSorted()) === JSON.stringify(keys.toSorted());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
