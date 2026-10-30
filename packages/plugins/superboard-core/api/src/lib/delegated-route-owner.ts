import { signPluginTaskRequest, PluginTaskUnavailable } from "@superboard/contracts/plugin-task";
import { parseRouteManifest, ROUTE_MANIFEST_PATH } from "@superboard/contracts/route-manifest";
import { resolveManifestRoute } from "@superboard/contracts/route-registry";
import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { extractDomainRoute } from "./domain-modules.js";
import type { Env } from "../types.js";

export async function delegatedAppOwner(request: Request, env: Env): Promise<string> {
	const target = extractDomainRoute(request, "app");
	if (!target.ok) throw new PluginTaskUnavailable(target.code, target.status);
	if (!env.APP_MODULE || !env.MODULE_INTERNAL_TOKEN) throw new PluginTaskUnavailable("ROUTE_OWNER_UNAVAILABLE", 503);
	try {
		const query = new Request(`https://app.internal${ROUTE_MANIFEST_PATH}`);
		const headers = await signPluginTaskRequest(query, env.MODULE_INTERNAL_TOKEN);
		const response = await env.APP_MODULE.fetch(new Request(query, { headers, signal: AbortSignal.timeout(5000) }));
		if (!response.ok) { await response.body?.cancel(); throw new Error("MANIFEST_UNAVAILABLE"); }
		const manifest = parseRouteManifest(await readJsonObjectLimited(response, 2 * 1024 * 1024));
		if (manifest.service !== "app" || manifest.instanceId !== env.SUPERBOARD_INSTANCE_ID || manifest.environment !== env.ENVIRONMENT) throw new Error("MANIFEST_CONTEXT_MISMATCH");
		const matched = resolveManifestRoute(manifest.routes, request.method, "internal", target.internalPath);
		if (!matched) throw new PluginTaskUnavailable("ROUTE_NOT_FOUND", 404);
		return matched.route.pluginId;
	} catch (error) {
		if (error instanceof PluginTaskUnavailable) throw error;
		throw new PluginTaskUnavailable("ROUTE_OWNER_UNAVAILABLE", 503);
	}
}
