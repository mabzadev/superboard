export const prerender = false;

import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import type { APIRoute } from "astro";

import { requirePluginOperator } from "../../../lib/operator-guard.js";
import {
	initializeOperatorProjectScope,
	OperatorProjectScopeError,
} from "../../../lib/operator-project-scope.js";
import { getSiteEnv } from "../../../lib/site-env.js";

export const POST: APIRoute = async (context) => {
	const denied = requirePluginOperator(context, { mutation: true });
	if (denied) return denied;
	const key = context.request.headers.get("Idempotency-Key")?.trim();
	if (!key || key.length > 255)
		return Response.json({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } }, { status: 400 });
	try {
		const body = context.request.body ? await readJsonObjectLimited(context.request, 1024) : {};
		const legacyId = body.legacy_instance_id;
		if (
			Object.keys(body).some((field) => field !== "legacy_instance_id") ||
			(legacyId !== undefined &&
				(typeof legacyId !== "number" || !Number.isSafeInteger(legacyId) || legacyId <= 0))
		)
			return Response.json({ error: { code: "OPERATOR_INSTANCE_SCOPE_INVALID" } }, { status: 400 });
		const scope = await initializeOperatorProjectScope(getSiteEnv(), context.locals.user!, key, {
			legacy_instance_id: typeof legacyId === "number" ? legacyId : undefined,
		});
		return Response.json(scope, { headers: { "Cache-Control": "private, no-store" } });
	} catch (error) {
		if (error instanceof RequestBodyError)
			return Response.json({ error: { code: error.code } }, { status: error.status });
		if (error instanceof OperatorProjectScopeError)
			return Response.json({ error: { code: error.code } }, { status: error.status });
		return Response.json(
			{ error: { code: "OPERATOR_PROJECT_SCOPE_UNAVAILABLE" } },
			{ status: 503, headers: { "Cache-Control": "private, no-store" } },
		);
	}
};
