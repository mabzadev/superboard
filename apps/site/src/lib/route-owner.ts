import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import {
	INTERNAL_ROUTE_OWNER_PATH,
	RouteReferenceError,
} from "@superboard/contracts/route-reference";
import { signSiteOperatorRequest } from "@superboard/contracts/site-operator";

import type { OperatorApiProxyEnv } from "./operator-api-proxy.js";

export async function resolveApiRouteOwner(
	env: OperatorApiProxyEnv,
	operator: { id: string; role: number },
	request: Request,
): Promise<string> {
	if (!env.API_SERVICE || !env.SITE_OPERATOR_BRIDGE_TOKEN || !env.SUPERBOARD_INSTANCE_ID)
		throw new RouteReferenceError("ROUTE_OWNER_UNAVAILABLE");
	const lookup = new Request(`https://api.internal${INTERNAL_ROUTE_OWNER_PATH}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			method: request.method,
			path: new URL(request.url).pathname,
			project_ref:
				request.headers.get("X-Project-Ref") ?? request.headers.get("X-Project-Id") ?? undefined,
		}),
	});
	const headers = await signSiteOperatorRequest(
		lookup,
		{ operator_id: operator.id, instance_id: env.SUPERBOARD_INSTANCE_ID, role: operator.role },
		env.SITE_OPERATOR_BRIDGE_TOKEN,
	);
	headers.set("Content-Type", "application/json");
	const response = await env.API_SERVICE.fetch(
		new Request(lookup, { headers, signal: AbortSignal.timeout(5000) }),
	);
	if (!response.ok) {
		await response.body?.cancel();
		throw new RouteReferenceError("ROUTE_OWNER_UNAVAILABLE");
	}
	const payload = await readJsonObjectLimited(response, 16384);
	if (
		typeof payload.pluginId !== "string" ||
		!payload.pluginId.trim() ||
		typeof payload.routeId !== "string" ||
		!payload.routeId.trim()
	)
		throw new RouteReferenceError("ROUTE_OWNER_INVALID");
	return payload.pluginId;
}
