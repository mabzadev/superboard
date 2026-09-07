import { hasPermission } from "@emdash-cms/auth";

import { proxyOperatorApiRequest } from "../../../lib/operator-api-proxy.js";
import { getSiteEnv } from "../../../lib/site-env.js";

export const prerender = false;

export const ALL = async ({ request, locals }: { request: Request; locals: App.Locals }) => {
	if (!locals.user) {
		return Response.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, { status: 401 });
	}
	if (!hasPermission(locals.user, "settings:manage"))
		return Response.json({ error: { code: "OPERATOR_REQUIRED" } }, { status: 403 });
	return proxyOperatorApiRequest({
		request,
		operator: locals.user,
		env: getSiteEnv(),
	});
};
