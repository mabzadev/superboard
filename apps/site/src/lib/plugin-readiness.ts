import { pluginPackageOwner } from "@superboard/contracts/plugin-packages";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";
import { sha256Canonical } from "@superboard/supbrd-core";
import type { APIContext } from "astro";

import packageCatalog from "../../../../scripts/config/superboard-plugin-catalog.json";
import type { SuperBoardSiteEnv } from "./site-env.js";
import { superBoardRuntimePluginCatalog } from "./superboard-plugin-catalog.js";

export async function verifySuperBoardPluginResources(
	context: APIContext,
	pluginIds: readonly string[],
) {
	const { getSiteEnv } = await import("./site-env.js");
	const env = getSiteEnv();
	await env.DB.prepare("SELECT entity_id FROM superboard_plugin_store_records LIMIT 1").all();
	await env.RELEASE_CACHE.get(`last_verified_release:${env.SUPERBOARD_INSTANCE_ID}`);
	const evidence = new Map<string, string>();
	const manifests = new Map(
		superBoardRuntimePluginCatalog().plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	const packageManifests = new Map(
		packageCatalog.plugins.map(({ manifest }) => [manifest.plugin_id, manifest]),
	);
	const inspected = new Map<
		string,
		Awaited<ReturnType<typeof context.locals.emdash.inspectPluginHealth>>
	>();
	if (!context.locals.user || !env.API_SERVICE || !env.SITE_OPERATOR_BRIDGE_TOKEN)
		throw new Error("PLUGIN_WORKER_HEALTH_BINDING_UNAVAILABLE");
	for (const pluginId of pluginIds) {
		const manifest = manifests.get(pluginId);
		if (!manifest) throw new Error(`PLUGIN_NOT_FOUND:${pluginId}`);
		if (pluginId === "supbrd-plug-audit")
			await env.DB.prepare("SELECT sequence FROM superboard_audit_heads LIMIT 1").all();
		const ownerId = pluginPackageOwner(pluginId);
		const runtimeManifest = packageManifests.get(ownerId) ?? manifest;
		const result =
			inspected.get(ownerId) ??
			(await context.locals.emdash.inspectPluginHealth(
				ownerId,
				context.request,
				context.locals.user,
			));
		inspected.set(ownerId, result);
		if (
			!result.success ||
			!result.data ||
			typeof result.data !== "object" ||
			!("status" in result.data) ||
			result.data.status !== "ready" ||
			!("plugin_id" in result.data) ||
			result.data.plugin_id !== ownerId ||
			!("artifact_checksum" in result.data) ||
			result.data.artifact_checksum !== runtimeManifest.artifact_checksum ||
			!("plugin_version" in result.data) ||
			result.data.plugin_version !== runtimeManifest.plugin_version
		) {
			throw new Error(`PLUGIN_RUNTIME_HEALTH_FAILED:${pluginId}`);
		}

		const workerHealth = await probeSuperBoardPluginWorker(env, pluginId, {
			operator_id: context.locals.user.id,
			instance_id: env.SUPERBOARD_INSTANCE_ID,
			role: context.locals.user.role,
		});
		evidence.set(
			pluginId,
			await sha256Canonical({
				plugin: result.data,
				component: { plugin_id: pluginId, artifact_checksum: manifest.artifact_checksum },
				worker: workerHealth,
				checked_at: new Date().toISOString(),
			}),
		);
	}
	return evidence;
}

export async function probeSuperBoardPluginWorker(
	env: SuperBoardSiteEnv,
	pluginId: string,
	operator: Parameters<typeof signSiteOperatorRequest>[1],
) {
	if (!env.API_SERVICE || !env.SITE_OPERATOR_BRIDGE_TOKEN)
		throw new Error("PLUGIN_WORKER_HEALTH_BINDING_UNAVAILABLE");
	const unsigned = new Request(
		`https://api.internal/internal/site/plugin-health/${encodeURIComponent(pluginId)}`,
	);
	const headers = await signSiteOperatorRequest(unsigned, operator, env.SITE_OPERATOR_BRIDGE_TOKEN);
	const response = await env.API_SERVICE.fetch(
		new Request(unsigned, { headers, signal: AbortSignal.timeout(10000) }),
	);
	const health = await readJsonObjectLimited(response, 65536);
	if (!response.ok || health.status !== "ready" || health.plugin_id !== pluginId)
		throw new Error(`PLUGIN_WORKER_HEALTH_FAILED:${pluginId}`);
	return health;
}
