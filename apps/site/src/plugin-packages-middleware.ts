import { pluginPackage, componentSettingKey } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { createFrontI18n } from "@superboard/front-ui/i18n";
import type { MiddlewareHandler } from "astro";

import { resolveLocale } from "../../../packages/admin/src/locales/config.js";
import { createConfiguredSuperBoardPlugin } from "./lib/configured-plugin.js";
import {
	runManagedPluginLifecycleAction,
	recoverExpiredManagedPluginOperation,
} from "./lib/managed-plugin-lifecycle-action.js";
import { canAccessOperatorConsole } from "./lib/operator-access.js";
import { requireActiveSuperBoardPlugin } from "./lib/plugin-availability.js";
import { packageFeatureBlocks } from "./lib/plugin-package-blocks.js";
import { migratePluginPackages, syncPluginPackageRuntime } from "./lib/plugin-package-state.js";
import { dispatchSettingsPluginApi } from "./lib/settings-plugin-api.js";
import { getSiteEnv } from "./lib/site-env.js";
import {
	resolveSuperBoardPluginTarget,
	resolveSuperBoardTargetPluginIds,
} from "./lib/superboard-plugin-catalog.js";

const messages = {
	en: {
		features: "Functions",
		enabled: "Enabled",
		disabled: "Disabled",
		enable: "Enable",
		disable: "Disable",
		required: "Required",
		settings: "Plugin settings",
		description:
			"Functions share one installation and update. Their settings and activation preferences are preserved.",
		unavailable: "This function is not included in the deployment configuration.",
	},
	fr: {
		features: "Fonctions",
		enabled: "Activée",
		disabled: "Désactivée",
		enable: "Activer",
		disable: "Désactiver",
		required: "Obligatoire",
		settings: "Réglages du plugin",
		description:
			"Les fonctions partagent une installation et une mise à jour. Leurs réglages et leurs préférences d’activation sont conservés.",
		unavailable: "Cette fonction ne figure pas dans la configuration du déploiement.",
	},
	ar: {
		features: "الوظائف",
		enabled: "مفعّلة",
		disabled: "معطّلة",
		enable: "تفعيل",
		disable: "تعطيل",
		required: "مطلوبة",
		settings: "إعدادات الإضافة",
		description: "تشترك الوظائف في تثبيت وتحديث واحد مع الاحتفاظ بإعداداتها وتفضيلات تفعيلها.",
		unavailable: "هذه الوظيفة غير مدرجة في إعدادات النشر.",
	},
};
const settingPathPattern = /^\/_emdash\/api\/admin\/plugins\/([^/]+)\/(settings|enable|disable)$/u;
const apiPathPattern =
	/^\/_emdash\/api\/plugins\/([^/]+)\/(admin|contract|health|settings\/effective|commands\/catalog|data-sources\/catalog)$/u;
const pagePathPattern = /^\/_emdash\/admin\/plugins\/([^/]+)(\/.*)?$/u;

export const onRequest = (async (context, next) => {
	const path = context.url.pathname;
	const setting = path.match(settingPathPattern);
	const api = path.match(apiPathPattern);
	const page = path.match(pagePathPattern);
	const adminPage = path.startsWith("/_emdash/admin");
	const list = path === "/_emdash/api/admin/plugins" && context.request.method === "GET";
	if (!setting && !api && !adminPage && !list) return next();
	if (!canAccessOperatorConsole(context.locals.user)) return next();
	const env = getSiteEnv();
	const scope = {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
	};
	const targetComponents = resolveSuperBoardTargetPluginIds(env.SUPERBOARD_PLUGIN_IDS);
	const requestedPackage = pluginPackage(setting?.[1] ?? api?.[1] ?? page?.[1] ?? "");
	if (
		requestedPackage?.kind === "application" &&
		!requestedPackage.components.some((id) => targetComponents.includes(id))
	)
		return Response.json({ error: { code: "PLUGIN_NOT_IN_TARGET" } }, { status: 404 });
	try {
		if (!(await recoverExpiredManagedPluginOperation(context)))
			return Response.json({ error: { code: "PLUGIN_RECOVERY_REQUIRED" } }, { status: 503 });
		if (await migratePluginPackages(env.DB, scope, targetComponents))
			await syncPluginPackageRuntime(env.DB, scope, context.locals.emdash);
	} catch (error) {
		if (error instanceof Error && error.message === "PLUGIN_OPERATION_IN_PROGRESS")
			return Response.json({ error: { code: error.message } }, { status: 409 });
		throw error;
	}
	if (list) {
		const response = await next();
		if (!response.ok) return response;
		const body = await readJsonObjectLimited(response, 2_000_000);
		const locale = resolveLocale(context.request);
		if (
			body.data &&
			typeof body.data === "object" &&
			"items" in body.data &&
			Array.isArray(body.data.items)
		) {
			body.data.items = body.data.items.flatMap((item: unknown) => {
				if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string")
					return [item];
				const owner = pluginPackage(item.id);
				if (!owner) return [item];
				if (
					owner.kind === "application" &&
					!owner.components.some((id) => targetComponents.includes(id))
				)
					return [];
				return [
					{
						...item,
						name: locale === "fr" ? owner.label_fr : owner.label,
						packageKind: owner.kind,
						configurationWhileDisabled: true,
						lifecycleLocked: owner.kind === "core",
					},
				];
			});
		}
		return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
	}
	if (page && context.request.method === "GET") {
		const owner = pluginPackage(page.at(1) ?? "");
		if (owner && owner.id !== page[1])
			return Response.redirect(
				new URL(`/_emdash/admin/plugins/${owner.id}${page[2] ?? ""}`, context.url),
				302,
			);
	}
	if (setting) {
		const id = setting.at(1) ?? "";
		const owner = pluginPackage(id);
		if (!owner) return next();
		if (setting[2] === "settings") return dispatchSettingsPluginApi(context, context.request, id);
		if ((setting[2] === "enable" || setting[2] === "disable") && context.request.method === "POST")
			return runManagedPluginLifecycleAction(
				{ ...context, params: { ...context.params, pluginId: id } },
				setting[2],
			);
	}
	if (!api) return next();
	const id = api.at(1) ?? "";
	const owner = pluginPackage(id);
	if (!owner) return next();
	if (api[2] === "admin") {
		if (context.request.method !== "POST") return next();
		const body = await readJsonObjectLimited(context.request.clone(), 65536);
		if (
			body.page === "/configuration" ||
			body.action_id === "deployment-refresh" ||
			body.action_id === "deployment-routes-page"
		)
			return next();
		if (typeof body.action_id === "string" && body.action_id.startsWith("package-feature:")) {
			const [, featureId, action] = body.action_id.split(":");
			if (
				!featureId ||
				!owner.components.includes(featureId) ||
				(action !== "enable" && action !== "disable")
			)
				return Response.json({ error: { code: "PLUGIN_FEATURE_NOT_FOUND" } }, { status: 404 });
			const result = await runManagedPluginLifecycleAction(
				{ ...context, params: { pluginId: owner.id, featureId } },
				action,
			);
			if (!result.ok) return result;
			await result.body?.cancel();
		}
		const requestedLocale = resolveLocale(context.request);
		const locale = requestedLocale === "fr" || requestedLocale === "ar" ? requestedLocale : "en";
		const i18n = createFrontI18n({ locale, messages: { [locale]: messages[locale] } });
		const t = (key: string) => i18n._(key);
		const states = await env.DB.prepare(
			"SELECT plugin_id,state FROM superboard_plugin_lifecycle WHERE instance_id=? AND target=?",
		)
			.bind(scope.instance_id, scope.target)
			.all<{ plugin_id: string; state: string }>();
		const active = new Set(
			states.results.filter((row) => row.state === "active").map((row) => row.plugin_id),
		);
		const data = packageFeatureBlocks({
			owner,
			active,
			available: targetComponents,
			labels: {
				title: locale === "fr" ? owner.label_fr : owner.label,
				description: t("description"),
				enabled: t("enabled"),
				disabled: t("disabled"),
				required: t("required"),
				unavailable: t("unavailable"),
				enable: t("enable"),
				disable: t("disable"),
			},
		});
		return Response.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
	}
	if (owner.id === id) {
		const state = await env.DB.prepare(
			"SELECT enabled FROM superboard_plugin_packages WHERE instance_id=? AND target=? AND package_id=?",
		)
			.bind(scope.instance_id, scope.target, id)
			.first<{ enabled: number }>();
		if (!state?.enabled)
			return Response.json({ error: { code: "PLUGIN_NOT_ACTIVE" } }, { status: 404 });
	} else {
		const denied = await requireActiveSuperBoardPlugin(env.DB, { ...scope, plugin_id: id });
		if (denied) return denied;
	}
	const component = createConfiguredSuperBoardPlugin(id);
	const kv = {
		get: async (key: string): Promise<unknown> => {
			if (!key.startsWith("settings:")) return null;
			const location = owner.id === id ? componentSettingKey(owner.id, key.slice(9)) : null;
			const value = await env.DB.prepare("SELECT value FROM options WHERE name=?")
				.bind(`plugin:${location?.component ?? id}:settings:${location?.key ?? key.slice(9)}`)
				.first<string>("value");
			return value === null ? null : JSON.parse(value);
		},
	};
	const result =
		api[2] === "contract"
			? await component.routes.contract.handler()
			: api[2] === "health"
				? await component.routes.health.handler({ kv })
				: api[2] === "settings/effective"
					? await component.routes["settings/effective"].handler({ kv })
					: api[2] === "commands/catalog"
						? await component.routes["commands/catalog"].handler()
						: await component.routes["data-sources/catalog"].handler();
	return Response.json({ data: result }, { headers: { "Cache-Control": "private, no-store" } });
}) satisfies MiddlewareHandler;
