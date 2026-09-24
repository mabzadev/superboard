import { pluginPackage, componentSettingKey } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import type { MiddlewareHandler } from "astro";
import { GET as getPlugin } from "emdash/routes/api/admin/plugins/_id_/index";

import { resolveLocale } from "../../../packages/admin/src/locales/config.js";
import {
	createConfiguredSuperBoardPlugin,
	resolveConfiguredPluginSettingKey,
} from "./lib/configured-plugin.js";
import {
	runManagedPluginLifecycleAction,
	recoverExpiredManagedPluginOperation,
} from "./lib/managed-plugin-lifecycle-action.js";
import { canAccessOperatorConsole } from "./lib/operator-access.js";
import { requireActiveSuperBoardPlugin } from "./lib/plugin-availability.js";
import { migratePluginPackages, syncPluginPackageRuntime } from "./lib/plugin-package-state.js";
import { dispatchSettingsPluginApi } from "./lib/settings-plugin-api.js";
import { getSiteEnv } from "./lib/site-env.js";
import {
	resolveSuperBoardPluginTarget,
	resolveSuperBoardTargetPluginIds,
} from "./lib/superboard-plugin-catalog.js";

const detailPathPattern = /^\/_emdash\/api\/admin\/plugins\/([^/]+)$/u;
const managerSettingsPattern =
	/^\/_emdash\/admin\/plugins-manager\/([^/]+)\/(settings|configuration)$/u;
const settingPathPattern = /^\/_emdash\/api\/admin\/plugins\/([^/]+)\/(settings|enable|disable)$/u;
const apiPathPattern =
	/^\/_emdash\/api\/plugins\/([^/]+)\/(admin|contract|health|settings\/effective|commands\/catalog|data-sources\/catalog)$/u;
const pagePathPattern = /^\/_emdash\/admin\/plugins\/([^/]+)(\/.*)?$/u;

export const onRequest = (async (context, next) => {
	const path = context.url.pathname;
	const setting = path.match(settingPathPattern);
	const detail = path.match(detailPathPattern);
	const managerSettings = path.match(managerSettingsPattern);
	const api = path.match(apiPathPattern);
	const page = path.match(pagePathPattern);
	const adminPage = path.startsWith("/_emdash/admin");
	const list = path === "/_emdash/api/admin/plugins" && context.request.method === "GET";
	if (!setting && !detail && !api && !adminPage && !list) return next();
	if (!canAccessOperatorConsole(context.locals.user)) return next();
	const requestedPackage = pluginPackage(
		setting?.[1] ?? detail?.[1] ?? api?.[1] ?? page?.[1] ?? managerSettings?.[1] ?? "",
	);
	if (
		managerSettings &&
		requestedPackage &&
		(managerSettings[2] === "settings" || managerSettings[1] !== requestedPackage.directory)
	) {
		const destination = new URL(
			`/_emdash/admin/plugins-manager/${requestedPackage.directory}/configuration`,
			context.url,
		);
		destination.search = context.url.search;
		return Response.redirect(destination, 302);
	}
	if (requestedPackage && requestedPackage.kind !== "application") {
		if (page && context.request.method === "GET" && (!page[2] || page[2] === "/")) {
			const destination = new URL("/_emdash/admin/plugins-manager", context.url);
			destination.search = context.url.search;
			return Response.redirect(destination, 302);
		}
		if (api?.[2] === "admin" && context.request.method === "POST") {
			const body = await readJsonObjectLimited(context.request.clone(), 65536);
			const configurationLoad = body.type === "page_load" && body.page === "/configuration";
			const configurationAction =
				body.type === "block_action" &&
				(body.action_id === "deployment-refresh" || body.action_id === "deployment-routes-page");
			if (requestedPackage.kind !== "core" || (!configurationLoad && !configurationAction))
				return Response.json({ error: { code: "PLUGIN_ADMIN_PAGE_NOT_FOUND" } }, { status: 404 });
		}
	}
	const env = getSiteEnv();
	const scope = {
		instance_id: env.SUPERBOARD_INSTANCE_ID,
		target: resolveSuperBoardPluginTarget(env.SUPERBOARD_ENVIRONMENT),
	};
	const targetComponents = resolveSuperBoardTargetPluginIds(env.SUPERBOARD_PLUGIN_IDS);

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
	if (list || (detail && requestedPackage && context.request.method === "GET")) {
		const response =
			detail && requestedPackage
				? await getPlugin({ ...context, params: { ...context.params, id: requestedPackage.id } })
				: await next();
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
				return [managerPlugin(item, locale)];
			});
		}
		if (body.data && typeof body.data === "object" && "item" in body.data)
			body.data.item = managerPlugin(body.data.item, locale);
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
	const requestedId = api.at(1) ?? "";
	const owner = pluginPackage(requestedId);
	if (!owner) return next();
	const id = requestedId === owner.directory ? owner.id : requestedId;
	if (api[2] === "admin") return next();
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
	const component = createConfiguredSuperBoardPlugin(
		requestedId === owner.directory ? requestedId : id,
	);
	const storageKey = (key: string) => {
		const legacyKey = resolveConfiguredPluginSettingKey(owner.id, key);
		const location = owner.id === id ? componentSettingKey(owner.id, legacyKey) : null;
		return `plugin:${location?.component ?? id}:settings:${location?.key ?? legacyKey}`;
	};
	const kv = {
		list: async (prefix = "") => {
			const keys = Object.keys(component.admin.settingsSchema)
				.map((key) => ({ key: `settings:${key}`, storage: storageKey(key) }))
				.filter((entry) => entry.key.startsWith(prefix));
			if (!keys.length) return [];
			const rows = await env.DB.prepare(
				`SELECT name,value FROM options WHERE name IN (${keys.map(() => "?").join(",")})`,
			)
				.bind(...keys.map((entry) => entry.storage))
				.all<{ name: string; value: string }>();
			const values = new Map(rows.results.map((row) => [row.name, row.value]));
			return keys.flatMap((entry) => {
				const value = values.get(entry.storage);
				return value === undefined ? [] : [{ key: entry.key, value: JSON.parse(value) }];
			});
		},
		get: async (key: string): Promise<unknown> => {
			if (!key.startsWith("settings:")) return null;
			const value = await env.DB.prepare("SELECT value FROM options WHERE name=?")
				.bind(storageKey(key.slice(9)))
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

function managerPlugin(item: unknown, locale: string): unknown {
	if (!item || typeof item !== "object" || !("id" in item) || typeof item.id !== "string")
		return item;
	const owner = pluginPackage(item.id);
	if (!owner) return item;
	return {
		...item,
		id: owner.directory,
		name: locale === "fr" ? owner.label_fr : owner.label,
		configurationId: owner.directory,
		packageKind: owner.kind,
		configurationWhileDisabled: true,
		lifecycleLocked: owner.kind === "core",
		lifecycleEnablePath: `/_emdash/api/admin/plugins/${owner.directory}/enable`,
		lifecycleDisablePath: `/_emdash/api/admin/plugins/${owner.directory}/disable`,
	};
}
