import { readJsonObjectLimited } from "@superboard/contracts/request-body";
import { Hono } from "hono";

import { getRequestAuthContext } from "../lib/auth.js";
import {
	initializeSiteOperatorProjectScope,
	readSiteOperatorProjectScope,
} from "../lib/site-operator-scope.js";
import type { Env } from "../types.js";

const routes = new Hono<{ Bindings: Env }>();
routes.all("/project-scope", async (c) => {
	if (c.req.method !== "GET" && c.req.method !== "POST")
		return c.json({ error: { code: "METHOD_NOT_ALLOWED" } }, 405);
	const auth = await getRequestAuthContext(c.env, c.req.raw.headers, { request: c.req.raw });
	if (!auth?.siteOperator) return c.json({ error: { code: "OPERATOR_SESSION_REQUIRED" } }, 401);
	if (c.req.method === "POST" && !c.req.header("Idempotency-Key")?.trim())
		return c.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } }, 400);
	try {
		const body =
			c.req.method === "POST" && c.req.raw.body ? await readJsonObjectLimited(c.req.raw, 1024) : {};
		const legacyId = body.legacy_instance_id;
		if (
			Object.keys(body).some((key) => key !== "legacy_instance_id") ||
			(legacyId !== undefined &&
				(typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0))
		)
			return c.json({ error: { code: "OPERATOR_INSTANCE_SCOPE_INVALID" } }, 400);
		const scope =
			c.req.method === "POST"
				? await initializeSiteOperatorProjectScope(
						c.env.DB,
						auth.siteOperator,
						legacyId as number | undefined,
					)
				: await readSiteOperatorProjectScope(c.env.DB, auth.siteOperator);
		if (!scope) return c.json({ error: { code: "OPERATOR_PROJECT_SCOPE_UNAVAILABLE" } }, 409);
		return c.json(scope, 200, { "Cache-Control": "private, no-store" });
	} catch (error) {
		if (error instanceof Error && error.message === "OPERATOR_INSTANCE_SCOPE_CONFLICT")
			return c.json({ error: { code: error.message } }, 409);
		throw error;
	}
});
export default routes;
