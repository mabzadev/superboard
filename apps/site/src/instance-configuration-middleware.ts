import { readJsonObjectLimited, RequestBodyError } from "@superboard/contracts/request-body";
import type { MiddlewareHandler } from "astro";

import { configurationBlocks, instanceConfiguration } from "./lib/instance-configuration.js";
import { canAccessOperatorConsole } from "./lib/operator-access.js";
import { getSiteEnv } from "./lib/site-env.js";

export const onRequest = (async (context, next) => {
	const direct =
		context.url.pathname === "/_emdash/api/superboard/deployment-configuration" &&
		context.request.method === "GET";
	const plugin =
		[
			"/_emdash/api/plugins/supbrd-plug-settings/admin",
			"/_emdash/api/plugins/supbrd-core/admin",
		].includes(context.url.pathname) && context.request.method === "POST";
	if (!direct && !plugin) return next();
	if (!canAccessOperatorConsole(context.locals.user))
		return Response.json(
			{ error: { code: "OPERATOR_REQUIRED" } },
			{ status: context.locals.user ? 403 : 401 },
		);
	try {
		let cursor = 0;
		if (plugin) {
			const body = await readJsonObjectLimited(context.request.clone(), 65536);
			if (
				body.page !== "/configuration" &&
				body.action_id !== "deployment-refresh" &&
				body.action_id !== "deployment-routes-page"
			)
				return next();
			const value = body.value;
			cursor = Number(
				value && typeof value === "object" && "cursor" in value
					? value.cursor
					: (body.cursor ?? value ?? 0),
			);
		}
		const data = await instanceConfiguration(getSiteEnv(), context.locals.user, context.request);
		return Response.json(
			plugin ? { data: configurationBlocks(data, context.request, cursor) } : data,
			{ headers: { "Cache-Control": "private, no-store" } },
		);
	} catch (error) {
		if (error instanceof RequestBodyError)
			return Response.json({ error: { code: error.code } }, { status: error.status });
		console.error("[instance-configuration] configuration unavailable");
		return Response.json(
			{ error: { code: "DEPLOYMENT_CONFIGURATION_UNAVAILABLE" } },
			{ status: 503 },
		);
	}
}) satisfies MiddlewareHandler;
