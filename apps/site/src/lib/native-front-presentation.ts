import {
	parseFrontNavigation,
	type FrontNavigationGroup,
	type NativeRendererMountInput,
	type PluginLockEntry,
} from "@superboard/supbrd-core";

import {
	CORE_FRONT_RENDERER_DESCRIPTORS,
	CORE_STATE_RENDERER_IDS,
	SUPBRD_CORE_ARTIFACT_CHECKSUM,
} from "./core-front-contract.js";
import type { FrontPageModel } from "./front-page.js";
import { USER_FRONT_CATALOGS, type UserFrontLocale } from "./user-front-i18n.js";

export type NativeFrontNavigationGroup = FrontNavigationGroup;

export interface NativeFrontPresentationProjection {
	instance_id: string;
	release_id: string | null;
	path: string;
	plugin_lock: PluginLockEntry[];
	navigation: NativeFrontNavigationGroup[];
	layout_mounts: NativeRendererMountInput[];
	content_mounts: NativeRendererMountInput[];
	state_mount: NativeRendererMountInput | null;
	theme: Record<string, string>;
	locale: UserFrontLocale;
	messages: Record<string, string>;
}

export function projectNativeFrontPresentation(
	model: FrontPageModel,
	locale: UserFrontLocale = "en",
): NativeFrontPresentationProjection {
	const payload = model.release?.release.payload;
	const fallbackPluginLock: PluginLockEntry[] = [
		{
			plugin_id: "supbrd-core",
			version: "0.1.0",
			artifact_checksum: SUPBRD_CORE_ARTIFACT_CHECKSUM,
			native: true,
		},
	];
	if (!payload) {
		const renderer = CORE_FRONT_RENDERER_DESCRIPTORS.find(
			({ renderer_id: rendererId }) => rendererId === CORE_STATE_RENDERER_IDS.maintenance,
		)!;
		return {
			instance_id: model.instance_id,
			release_id: null,
			path: model.requested_path,
			plugin_lock: fallbackPluginLock,
			navigation: [],
			layout_mounts: [],
			content_mounts: [],
			state_mount: mountInput(model, renderer, null, null, {}),
			theme: {},
			locale,
			messages: { ...USER_FRONT_CATALOGS[locale] },
		};
	}
	const renderers = new Map(
		[...CORE_FRONT_RENDERER_DESCRIPTORS, ...payload.renderers].map((renderer) => [
			renderer.renderer_id,
			renderer,
		]),
	);
	const routes = new Map(
		payload.front_route_manifest.routes.map((route) => [route.route_id, route]),
	);
	const defaultStatePolicies = payload.front_route_manifest.routes[0]?.state_policies;
	const route =
		"route_id" in model.resolution && model.resolution.route_id
			? routes.get(model.resolution.route_id)
			: undefined;
	const visibleNavigation = parseFrontNavigation(
		payload.presentation.navigation,
		payload.front_route_manifest.routes,
	)
		.map((group) => ({
			...group,
			items: group.items.flatMap((item) => {
				const itemRoute = routes.get(item.route_id);
				if (
					!itemRoute ||
					(item.permission !== "allow" && !model.permissions.includes(item.permission))
				) {
					return [];
				}
				return [item];
			}),
		}))
		.filter(({ items }) => items.length > 0);
	const theme = Object.fromEntries(
		Object.entries(payload.presentation.theme.tokens).flatMap(([key, value]) =>
			typeof value === "string" ? [[key, value]] : [],
		),
	);
	const messages = releaseMessages(payload.presentation.translations, locale);
	if (model.resolution.result !== "rendered") {
		const stateRendererId =
			model.resolution.result === "maintenance"
				? CORE_STATE_RENDERER_IDS.maintenance
				: "state_renderer_id" in model.resolution && model.resolution.state_renderer_id
					? model.resolution.state_renderer_id
					: (route?.state_policies.not_found ??
						defaultStatePolicies?.not_found ??
						CORE_STATE_RENDERER_IDS.not_found);
		const stateRenderer =
			renderers.get(stateRendererId) ??
			CORE_FRONT_RENDERER_DESCRIPTORS.find(
				({ renderer_id: rendererId }) => rendererId === stateRendererId,
			);
		if (!stateRenderer) throw new Error(`State renderer is missing: ${stateRendererId}`);
		return {
			instance_id: model.instance_id,
			release_id: payload.release_id,
			path: model.requested_path,
			plugin_lock: payload.plugin_lock,
			navigation: visibleNavigation,
			layout_mounts: [],
			content_mounts: [],
			state_mount: mountInput(model, stateRenderer, route?.route_id ?? null, null, {}),
			theme,
			locale,
			messages,
		};
	}
	const resolution = model.resolution;
	const page = payload.presentation.pages.find(
		({ page_id: pageId }) => pageId === resolution.page_id,
	);
	if (!route || !page) throw new Error("Rendered Front presentation is incomplete");
	const parameters = resolution.parameters;
	const layoutMounts = resolution.layout_ids.map((layoutId) => {
		const layout = payload.presentation.layouts.find(
			({ layout_id: candidate }) => candidate === layoutId,
		);
		const renderer = layout && renderers.get(layout.root_renderer_id);
		if (!renderer) throw new Error(`Layout renderer is missing: ${layoutId}`);
		return mountInput(model, renderer, route.route_id, page.title, parameters);
	});
	const contentMounts = resolution.renderer_ids.map((rendererId) => {
		const renderer = renderers.get(rendererId);
		if (!renderer) throw new Error(`Page renderer is missing: ${rendererId}`);
		return mountInput(model, renderer, route.route_id, page.title, parameters);
	});
	return {
		instance_id: model.instance_id,
		release_id: payload.release_id,
		path: model.requested_path,
		plugin_lock: payload.plugin_lock,
		navigation: visibleNavigation,
		layout_mounts: layoutMounts,
		content_mounts: contentMounts,
		state_mount: null,
		theme,
		locale,
		messages,
	};
}

function releaseMessages(
	translations: readonly unknown[],
	locale: UserFrontLocale,
): Record<string, string> {
	const catalog = translations.find(
		(value) => isRecord(value) && value.locale === locale && isRecord(value.messages),
	);
	if (!isRecord(catalog) || !isRecord(catalog.messages)) return { ...USER_FRONT_CATALOGS[locale] };
	return Object.fromEntries(
		Object.entries(catalog.messages).flatMap(([id, message]) =>
			typeof message === "string" ? [[id, message]] : [],
		),
	);
}

function mountInput(
	model: FrontPageModel,
	renderer: NativeRendererMountInput["renderer"],
	routeId: string | null,
	pageTitle: string | null,
	parameters: Record<string, string>,
): NativeRendererMountInput {
	return {
		renderer,
		route_id: routeId,
		path: model.requested_path,
		page_title: pageTitle,
		parameters,
		operator: model.operator,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
