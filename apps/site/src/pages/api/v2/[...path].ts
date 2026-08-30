import { hasPermission } from "@emdash-cms/auth";

import { proxyOperatorApiRequest } from "../../../lib/operator-api-proxy.js";
import { getSiteEnv } from "../../../lib/site-env.js";

export const prerender = false;

export const ALL = async ({ request, locals }: { request: Request; locals: App.Locals }) => {
	if (!hasPermission(locals.user, "settings:manage") || !locals.user?.email) {
		return Response.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, { status: 401 });
	}
	return proxyOperatorApiRequest({
		request,
		operator_email: locals.user.email,
		env: getSiteEnv(),
	});
};
